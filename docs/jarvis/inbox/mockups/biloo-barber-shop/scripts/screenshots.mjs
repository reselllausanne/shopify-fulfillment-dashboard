// Usage: npm run build && (npm run serve &) && npm run screenshots
// CHROME_PATH pour utiliser un Chrome/Chromium local (sinon `npx playwright-core install chromium`).
import { chromium } from "playwright-core";

const url = process.env.URL ?? "http://localhost:3000/";
const executablePath = process.env.CHROME_PATH || undefined;
const browser = await chromium.launch({ executablePath, headless: true });

const shots = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
];

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: s.viewport,
    deviceScaleFactor: s.mobile ? 2 : 1,
    isMobile: s.mobile,
    hasTouch: s.mobile,
    locale: "fr-CH",
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `screenshots/${s.name}-fold.png` });
  // La barre CTA mobile est fixed : on la masque pour la capture pleine page (sinon elle flotte au milieu).
  await page.addStyleTag({ content: ".sticky-cta{display:none!important}" });
  await page.screenshot({ path: `screenshots/${s.name}-full.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
