#!/usr/bin/env node
/**
 * Browser smoke test of the Warehouse and partner screens against the LOCAL recette server
 * (scripts/warehouse/dev-server.sh). Uses Playwright's own headless Chromium — never a
 * personal browser profile. For every page: HTTP status, uncaught errors, console errors,
 * failed API calls, and a screenshot.
 *
 *   node scripts/warehouse/ui-smoke.mjs [--base http://localhost:3111] [--out /tmp/wh-ui] [--mobile]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const base = arg("--base", "http://localhost:3111");
const out = arg("--out", "/tmp/wh-ui");
const mobile = process.argv.includes("--mobile");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error("ui-smoke only runs against a local server.");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const browser = await chromium.launch({ headless: true });
const results = [];

async function session(name, login, pagesOf) {
  const ctx = await browser.newContext({ baseURL: base, viewport, locale: "fr-CH", timezoneId: "Europe/Zurich", deviceScaleFactor: mobile ? 2 : 1 });
  const res = await ctx.request.post(login.url, { data: login.body });
  if (!res.ok()) throw new Error(`${name}: login failed (${res.status()})`);
  const api = async (url) => (await (await ctx.request.get(url)).json()).data;
  const pages = await pagesOf(api);
  for (const [label, url, after] of pages) {
    const page = await ctx.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`);
    });
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && r.status() >= 400) problems.push(`api ${r.status()}: ${r.request().method()} ${u.pathname}`);
    });
    let status = 0;
    try {
      const nav = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      status = nav?.status() ?? 0;
      await page.waitForTimeout(400);
      if (after) await after(page, problems);
      const text = await page.locator("body").innerText();
      if (/Application error|Unhandled Runtime Error|This page could not be found/i.test(text)) problems.push("error page rendered");
      if (text.trim().length < 40) problems.push("page is almost empty");
    } catch (err) {
      problems.push(`navigation: ${String(err.message).slice(0, 200)}`);
    }
    const file = `${name}-${label}${mobile ? "-mobile" : ""}.png`;
    await page.screenshot({ path: path.join(out, file), fullPage: !mobile }).catch(() => undefined);
    results.push({ session: name, label, url, status, problems, screenshot: file });
    await page.close();
  }
  await ctx.close();
}

const openDialog = (button) => async (page, problems) => {
  const btn = page.getByRole("button", { name: button }).first();
  if (!(await btn.count())) return problems.push(`button « ${button} » not found`);
  await btn.click();
  await page.waitForTimeout(300);
  if (!(await page.getByRole("dialog").count())) problems.push(`dialog for « ${button} » did not open`);
};

await session("staff", { url: "/api/auth/login", body: { password: process.env.ADMIN_PASSWORD ?? "admin-local" } }, async (api) => {
  const unit = (await api("/api/warehouse/units?limit=1")).items[0];
  const batches = await api("/api/warehouse/batches?limit=20");
  const list = Array.isArray(batches) ? batches : batches.items;
  const open = list.find((b) => b.status === "OPEN") ?? list[0];
  const partner = (await api("/api/warehouse/partners"))[0];
  return [
    ["overview", "/warehouse"],
    ["locations", "/warehouse/locations"],
    ["receiving", "/warehouse/receiving"],
    ["batch", `/warehouse/receiving/${open.id}`],
    ["putaway", "/warehouse/putaway"],
    ["stock", "/warehouse/stock"],
    ["unit", `/warehouse/stock/${unit.id}`],
    ["unit-duplicate-label", `/warehouse/stock/${unit.id}`, openDialog("Étiquette en double")],
    ["stations", "/warehouse/stations"],
    ["exceptions", "/warehouse/exceptions"],
    ["partners", "/warehouse/partners"],
    ["partner", `/warehouse/partners/${partner.id}`],
  ];
});

await session("partner", { url: "/api/partners/auth/quick", body: { partnerKey: process.env.PARTNER_KEY ?? "TONY" } }, async (api) => {
  const unit = (await api("/api/partners/warehouse/units?limit=1")).items[0];
  return [
    ["home", "/partners/dashboard"],
    ["stock", "/partners/stock"],
    ["unit", `/partners/stock/${unit.id}`],
    ["shipments", "/partners/shipments"],
    ["prices", "/partners/prices"],
    ["sales", "/partners/sales"],
    ["requests", "/partners/requests"],
  ];
});

await browser.close();
writeFileSync(path.join(out, `report${mobile ? "-mobile" : ""}.json`), JSON.stringify(results, null, 2));
let bad = 0;
for (const r of results) {
  const ok = r.status === 200 && r.problems.length === 0;
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${r.session}/${r.label} ${r.status}${r.problems.length ? "\n     " + r.problems.join("\n     ") : ""}`);
}
console.log(`${results.length - bad}/${results.length} pages clean — screenshots in ${out}`);
process.exit(bad ? 1 : 0);
