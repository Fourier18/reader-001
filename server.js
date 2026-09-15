const express = require('express');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const dns = require('dns').promises;
const net = require('net');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 4173;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Launch as a chromeless "app window" (no tabs/address bar) instead of a
// normal browser tab, so it reads as a standalone app. Falls back to the
// default browser if neither Edge nor Chrome is found at their usual paths.
function openReaderWindow(url) {
  if (process.platform !== 'win32') return;

  const candidates = [
    ['ProgramFiles(x86)', 'Microsoft\\Edge\\Application\\msedge.exe'],
    ['ProgramFiles', 'Microsoft\\Edge\\Application\\msedge.exe'],
    ['LOCALAPPDATA', 'Microsoft\\Edge\\Application\\msedge.exe'],
    ['ProgramFiles(x86)', 'Google\\Chrome\\Application\\chrome.exe'],
    ['ProgramFiles', 'Google\\Chrome\\Application\\chrome.exe'],
    ['LOCALAPPDATA', 'Google\\Chrome\\Application\\chrome.exe'],
  ]
    .filter(([envVar]) => process.env[envVar])
    .map(([envVar, rel]) => path.join(process.env[envVar], rel));

  const browserPath = candidates.find((p) => fs.existsSync(p));

  if (browserPath) {
    execFile(browserPath, [`--app=${url}`, '--window-size=1000,900']);
  } else {
    exec(`start "" "${url}"`);
  }
}

// Tags stripped from extracted article content: images, ads, embeds, scripts.
const STRIP_TAGS = [
  'img', 'picture', 'source', 'figure', 'figcaption', 'svg', 'iframe',
  'video', 'audio', 'canvas', 'script', 'style', 'noscript', 'object',
  'embed', 'form', 'button', 'input', 'ins', 'meta'
];

// Some sites inline "Image Credit: ..." text next to structured-data <meta>
// tags rather than in a captioned <figure>, so it survives tag-stripping.
const CREDIT_TEXT_PATTERN = /^(image\s+)?(credit|source)\s*:/i;

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
  }
  return false;
}

async function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported.');
  }
  if (url.hostname === 'localhost') {
    throw new Error('Local addresses are not allowed.');
  }
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('That address is not allowed.');
  }
  return url;
}

const CAPTION_PATTERN = /caption|credit|wp-image|attachment/i;

function sanitizeContent(rootEl, dom) {
  STRIP_TAGS.forEach((tag) => {
    rootEl.querySelectorAll(tag).forEach((el) => el.remove());
  });
  // Leftover image captions/credits often sit in their own <p>/<span> next to
  // the <img> we just removed, so they survive tag-stripping as plain text.
  rootEl.querySelectorAll('[class], [id]').forEach((el) => {
    if (CAPTION_PATTERN.test(el.className) || CAPTION_PATTERN.test(el.id)) {
      el.remove();
    }
  });
  rootEl.querySelectorAll('p, span, em').forEach((el) => {
    if (CREDIT_TEXT_PATTERN.test(el.textContent.trim())) {
      el.remove();
    }
  });
  // Strip every attribute except href on anchors - drops onclick handlers,
  // inline styles, tracking classes/ids, srcset leftovers, etc.
  rootEl.querySelectorAll('*').forEach((el) => {
    const keep = el.tagName === 'A' ? ['href'] : [];
    [...el.attributes].forEach((attr) => {
      if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
    });
  });
  return rootEl.innerHTML;
}

app.get('/api/extract', async (req, res) => {
  const target = req.query.url;
  if (!target) {
    return res.status(400).json({ error: 'Missing url parameter.' });
  }

  try {
    const url = await assertSafeUrl(target);

    const response = await fetch(url.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `The site responded with ${response.status} ${response.statusText}.` });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('html')) {
      return res.status(415).json({ error: 'That URL does not point to an HTML page.' });
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url: url.toString() });

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      return res.status(422).json({ error: 'Could not find readable article content on that page.' });
    }

    const contentDom = new JSDOM(`<div id="root">${article.content}</div>`);
    const root = contentDom.window.document.getElementById('root');
    const cleanContent = sanitizeContent(root, contentDom);

    res.json({
      title: article.title || '',
      byline: article.byline || '',
      siteName: article.siteName || url.hostname,
      length: article.length || 0,
      content: cleanContent,
    });
  } catch (err) {
    const message = err.name === 'TimeoutError' ? 'The request timed out.' : err.message || 'Failed to extract article.';
    res.status(500).json({ error: message });
  }
});

// The app window is a separate process from this server, so it can't be
// closed by killing a parent - the page tells us to quit via sendBeacon
// when it unloads (fires reliably even mid page-teardown, unlike fetch).
app.post('/api/quit', (req, res) => {
  res.sendStatus(204);
  setTimeout(() => process.exit(0), 50);
});

const url = `http://localhost:${PORT}`;
const server = app.listen(PORT, () => {
  console.log(`Reader running at ${url}`);
  console.log('This window is only shown when launching Reader.exe directly.');
  console.log('Use Reader.vbs to launch without a console window.');
  openReaderWindow(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Reader is likely already running from an earlier launch - just open it.
    console.log('Reader is already running - opening it.');
    openReaderWindow(url);
    setTimeout(() => process.exit(0), 500);
  } else {
    throw err;
  }
});
