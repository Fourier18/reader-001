const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { Jimp, ResizeStrategy } = require('jimp');
const { imagesToIco } = require('png-to-ico');

const SVG_PATH = path.join(__dirname, 'icon.svg');
const OUT_ICO = path.join(__dirname, '..', 'Reader.ico');
const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  const svg = fs.readFileSync(SVG_PATH, 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.setViewportSize({ width: 256, height: 256 });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  const basePng = await page.screenshot({ omitBackground: true });
  await browser.close();

  const base = await Jimp.read(basePng);
  const bitmaps = [];
  for (const size of SIZES) {
    const resized = base.clone().resize({ w: size, h: size, mode: ResizeStrategy.BICUBIC });
    bitmaps.push(resized.bitmap);
  }

  const ico = await imagesToIco(bitmaps);
  fs.writeFileSync(OUT_ICO, ico);
  console.log('Wrote', OUT_ICO);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
