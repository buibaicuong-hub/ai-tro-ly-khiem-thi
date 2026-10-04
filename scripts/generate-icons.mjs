// Tạo các biểu tượng PNG cho PWA từ file SVG (cần Playwright: `npm i -D playwright`).
// Chạy: npm run icons

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const targets = [
  { svg: "icon.svg", out: "icon-192.png", size: 192 },
  { svg: "icon.svg", out: "icon-512.png", size: 512 },
  { svg: "icon.svg", out: "apple-touch-icon.png", size: 180 },
  { svg: "icon-maskable.svg", out: "icon-maskable-512.png", size: 512 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { svg, out, size } of targets) {
  const markup = await readFile(path.join(root, svg), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:#000}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
  );
  await page.screenshot({ path: path.join(root, out), omitBackground: false });
  console.log("Đã tạo", out);
}
await browser.close();
