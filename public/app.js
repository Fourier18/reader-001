const form = document.getElementById('form');
const urlInput = document.getElementById('url');
const goBtn = document.getElementById('go');
const fontSizeSelect = document.getElementById('fontSize');
const saveFormatSelect = document.getElementById('saveFormat');
const saveAsBtn = document.getElementById('saveAs');
const view = document.getElementById('view');

let currentArticle = null;

// Server runs hidden with no console window - tell it to quit when this
// window closes, so nothing lingers in the background.
window.addEventListener('pagehide', () => {
  navigator.sendBeacon('/api/quit');
});

const savedSize = localStorage.getItem('reader-font-size');
if (savedSize) fontSizeSelect.value = savedSize;
applyFontSize();

const savedFormat = localStorage.getItem('reader-save-format');
if (savedFormat) saveFormatSelect.value = savedFormat;

fontSizeSelect.addEventListener('change', () => {
  localStorage.setItem('reader-font-size', fontSizeSelect.value);
  applyFontSize();
});

saveFormatSelect.addEventListener('change', () => {
  localStorage.setItem('reader-save-format', saveFormatSelect.value);
});

function applyFontSize() {
  view.style.fontSize = `${fontSizeSelect.value}px`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  goBtn.disabled = true;
  saveAsBtn.disabled = true;
  currentArticle = null;
  view.innerHTML = '<p class="spinner">Fetching article...</p>';

  try {
    const res = await fetch(`/api/extract?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    if (!res.ok) {
      view.innerHTML = `<p class="error">${escapeHtml(data.error || 'Something went wrong.')}</p>`;
      return;
    }

    const metaParts = [data.siteName, data.byline].filter(Boolean);
    view.innerHTML = `
      <article>
        <h1 class="title">${escapeHtml(data.title)}</h1>
        <div class="meta">${escapeHtml(metaParts.join(' · '))}</div>
        <div class="content">${data.content}</div>
      </article>
    `;
    currentArticle = { ...data, sourceUrl: url };
    saveAsBtn.disabled = false;
  } catch (err) {
    view.innerHTML = `<p class="error">${escapeHtml(err.message || 'Network error.')}</p>`;
  } finally {
    goBtn.disabled = false;
  }
});

saveAsBtn.addEventListener('click', async () => {
  if (!currentArticle) return;

  const format = saveFormatSelect.value;
  const { text, mime, ext } = buildExport(currentArticle, format);
  const filename = `${slugify(currentArticle.title) || 'article'}.${ext}`;

  saveAsBtn.disabled = true;
  try {
    await saveFile(text, filename, mime);
  } catch (err) {
    if (err.name !== 'AbortError') {
      view.insertAdjacentHTML('afterbegin', `<p class="error">Could not save file: ${escapeHtml(err.message)}</p>`);
    }
  } finally {
    saveAsBtn.disabled = false;
  }
});

async function saveFile(text, filename, mime) {
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: mime, accept: { [mime]: [`.${filename.split('.').pop()}`] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return;
  }

  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function buildExport(article, format) {
  const contentEl = document.createElement('div');
  contentEl.innerHTML = article.content;

  if (format === 'html') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(article.title)}</title>
</head>
<body>
<h1>${escapeHtml(article.title)}</h1>
<p><em>${escapeHtml([article.siteName, article.byline].filter(Boolean).join(' · '))}${article.sourceUrl ? ` — <a href="${escapeAttr(article.sourceUrl)}">${escapeHtml(article.sourceUrl)}</a>` : ''}</em></p>
${article.content}
</body>
</html>`;
    return { text: html, mime: 'text/html', ext: 'html' };
  }

  if (format === 'md') {
    const md = `# ${article.title}\n\n_${[article.siteName, article.byline].filter(Boolean).join(' · ')}${article.sourceUrl ? ` — ${article.sourceUrl}` : ''}_\n\n${htmlToMarkdown(contentEl)}`;
    return { text: md, mime: 'text/markdown', ext: 'md' };
  }

  const txt = `${article.title}\n${[article.siteName, article.byline].filter(Boolean).join(' · ')}${article.sourceUrl ? `\n${article.sourceUrl}` : ''}\n\n${htmlToText(contentEl)}`;
  return { text: txt, mime: 'text/plain', ext: 'txt' };
}

function htmlToText(root) {
  root.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
  const lines = [];
  root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote').forEach((el) => {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  });
  return lines.join('\n\n');
}

function htmlToMarkdown(root) {
  const blocks = [];
  root.childNodes.forEach((node) => blockToMarkdown(node, blocks));
  return blocks.filter(Boolean).join('\n\n');
}

function blockToMarkdown(node, blocks) {
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    blocks.push(`${'#'.repeat(Number(tag[1]))} ${inlineToMarkdown(node).trim()}`);
  } else if (tag === 'p') {
    const text = inlineToMarkdown(node).trim();
    if (text) blocks.push(text);
  } else if (tag === 'blockquote') {
    blocks.push(inlineToMarkdown(node).trim().split('\n').map((l) => `> ${l}`).join('\n'));
  } else if (tag === 'ul' || tag === 'ol') {
    const items = [...node.children].map((li, i) => {
      const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
      return `${prefix}${inlineToMarkdown(li).trim()}`;
    });
    blocks.push(items.join('\n'));
  } else if (tag === 'pre') {
    blocks.push('```\n' + node.textContent.trim() + '\n```');
  } else if (tag === 'hr') {
    blocks.push('---');
  } else {
    node.childNodes.forEach((child) => blockToMarkdown(child, blocks));
  }
}

function inlineToMarkdown(node) {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += child.textContent;
      return;
    }
    if (child.nodeType !== 1) return;
    const tag = child.tagName.toLowerCase();
    const inner = inlineToMarkdown(child);
    if (tag === 'strong' || tag === 'b') out += `**${inner}**`;
    else if (tag === 'em' || tag === 'i') out += `*${inner}*`;
    else if (tag === 'code') out += `\`${inner}\``;
    else if (tag === 'a') out += `[${inner}](${child.getAttribute('href') || ''})`;
    else if (tag === 'br') out += '\n';
    else out += inner;
  });
  return out;
}

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
