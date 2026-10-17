// Records a script's screens on Sentinel (signed in through login.mjs),
// holding each scene for as long as its longer narration. Writes
// out/<video>/recording.webm and timeline.json (when each scene starts).
//   node tools/videos/record.mjs b11-review-case [--show]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { APP_URL, AUTH, BROWSER_CHANNEL, DEMO_CLIENT_ID, LEAD_IN_SECONDS, loadScript, sceneLengths, videoDir } from "./lib.mjs";

const script = loadScript(process.argv[2] ?? "");
if (!fs.existsSync(AUTH)) throw new Error("Sign in first: node tools/videos/login.mjs");
const lengths = sceneLengths(script);
const viewport = script.viewport ?? { width: 1920, height: 1080 };
const dir = videoDir(script, "raw");
for (const file of fs.readdirSync(dir)) fs.rmSync(path.join(dir, file));

// On-screen helpers: a pointer that glides to what is clicked, a highlight
// ring, and title cards with the DeepTrack logo.
const helpers = `(() => {
  const css = '#vh-ptr{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(124,58,237,.35);border:2px solid #7c3aed;pointer-events:none;transition:left .55s ease,top .55s ease,transform .15s}#vh-ptr.down{transform:scale(.7)}.vh-ring{outline:4px solid #7c3aed!important;outline-offset:6px!important;border-radius:10px;transition:outline-color .3s}#vh-card{position:fixed;inset:0;z-index:2147483646;background:#0b1020;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,Segoe UI,sans-serif;gap:18px}#vh-card img{height:56px;filter:invert(1)}#vh-card h1{font-size:64px;margin:24px 0 0;font-weight:700}#vh-card p{font-size:28px;margin:0;opacity:.75}' + (window.__vhInternal ? '' : 'a[href^="/internal-ops"]{display:none!important}');
  const ensure = () => { if (document.getElementById('vh-style') || !document.head) return; const s = document.createElement('style'); s.id = 'vh-style'; s.textContent = css; document.head.appendChild(s); const p = document.createElement('div'); p.id = 'vh-ptr'; p.style.left = '50%'; p.style.top = '60%'; document.body.appendChild(p); };
  window.__vh = {
    ensure,
    pointer(x, y, down) { ensure(); const p = document.getElementById('vh-ptr'); p.style.left = x + 'px'; p.style.top = y + 'px'; p.classList.toggle('down', !!down); },
    ring(el) { ensure(); document.querySelectorAll('.vh-ring').forEach((n) => n.classList.remove('vh-ring')); if (el) el.classList.add('vh-ring'); },
    card(title, subtitle, logo) { ensure(); this.clearCard(); const c = document.createElement('div'); c.id = 'vh-card'; c.innerHTML = '<img alt="">' + '<h1></h1><p></p>'; c.querySelector('img').src = logo; c.querySelector('h1').textContent = title; c.querySelector('p').textContent = subtitle || ''; document.body.appendChild(c); const p = document.getElementById('vh-ptr'); if (p) p.style.display = 'none'; },
    clearCard() { document.getElementById('vh-card')?.remove(); const p = document.getElementById('vh-ptr'); if (p) p.style.display = ''; },
  };
  document.addEventListener('DOMContentLoaded', ensure);
})();`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logo = `${APP_URL}/deeptrack-transparent.png`;
const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: !process.argv.includes("--show") });
const demoCookie = [{ name: "sentinel_client_id", value: DEMO_CLIENT_ID, url: APP_URL }];
let page;

// Off camera first: put Demo Bank back to the state the video starts from
// (e.g. release a case an earlier take assigned). Steps that don't apply
// are skipped.
if (script.prepare?.length) {
  const prep = await browser.newContext({ storageState: AUTH, viewport });
  await prep.addCookies(demoCookie);
  page = await prep.newPage();
  for (const action of script.prepare) await step(action, { quiet: true });
  await prep.close();
}

const context = await browser.newContext({ storageState: AUTH, viewport, deviceScaleFactor: 1, recordVideo: { dir, size: viewport } });
// Client videos hide the Back Office link (clients never see it); the
// Back Office videos ("internal": true) keep it.
if (script.internal) await context.addInitScript(() => { window.__vhInternal = true; });
await context.addInitScript(helpers);
// Open on Demo Bank Ltd, the organization every video shows.
await context.addCookies(demoCookie);
page = await context.newPage();
const t0 = Date.now();
const elapsed = () => (Date.now() - t0) / 1000;

// Sentinel keeps a live Convex connection, so "network idle" never comes:
// wait for the page to load and its data to render.
async function settle() {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.locator("main").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  await sleep(1500);
  await page.evaluate(() => window.__vh?.ensure());
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function target(spec) {
  const [kind, ...rest] = spec.split(":");
  const value = rest.join(":");
  switch (kind) {
    case "sidebar":
      return page.getByRole("link", { name: value, exact: true }).first();
    case "button":
      return page.getByRole("button", { name: value }).first();
    case "case":
      return page.getByRole("link", { name: value }).first().or(page.getByText(value).first()).first();
    case "card":
      // Matches a heading that starts with the text (brackets and dots taken literally).
      return page.getByRole("heading", { name: new RegExp("^\\s*" + escapeRegex(value)) }).first().locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
    case "heading":
      return page.getByRole("heading", { name: value }).first();
    case "text":
      // The box (card, tile) around a piece of text.
      return page.getByText(value).first().locator("xpath=ancestor-or-self::*[contains(@class,'rounded')][1]");
    case "field":
      return page.getByLabel(value).first();
    case "form":
      return page.getByRole("heading", { name: "Decision", exact: true }).first().locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
    case "queue-filter":
      return page.getByLabel("Queue").first();
    case "views":
      return page.getByRole("button", { name: /Assigned to me/ }).first().locator("xpath=..");
    default:
      return page.locator("main").first();
  }
}

async function pointAt(locator) {
  const box = await locator.boundingBox();
  if (!box) return null;
  await page.evaluate(([x, y]) => window.__vh?.pointer(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
  await sleep(650);
  return box;
}

async function step(action, { quiet = false } = {}) {
  try {
    if (action.goto) {
      await page.goto(`${APP_URL}${action.goto}`, { waitUntil: "load" });
      await settle();
      await page.evaluate(() => window.__vh?.ensure());
    } else if (action.card) {
      await page.evaluate(([title, subtitle, src]) => window.__vh?.card(title, subtitle, src), [action.card, action.subtitle ?? "", logo]);
    } else {
      await page.evaluate(() => window.__vh?.clearCard());
      const spec = action.click ?? action.highlight ?? action.zoom ?? action.scroll ?? action.select ?? action.type;
      const locator = target(spec);
      await locator.waitFor({ state: "visible", timeout: quiet ? 4000 : 8000 });
      await locator.scrollIntoViewIfNeeded();
      await sleep(300);
      await pointAt(locator);
      await locator.evaluate((el) => window.__vh?.ring(el));
      if (action.click) {
        await page.evaluate(() => window.__vh?.pointer(parseFloat(document.getElementById("vh-ptr").style.left), parseFloat(document.getElementById("vh-ptr").style.top), true));
        await locator.click();
        await settle();
        await page.evaluate(() => window.__vh?.ensure());
      } else if (action.select) {
        const isSelect = await locator.evaluate((el) => el.tagName === "SELECT");
        const option = action.select.split(":")[1];
        const label = action.option ?? (action.select.startsWith("queue-filter") ? option : undefined);
        if (isSelect) await locator.selectOption(label ? { label } : { index: 1 });
        else {
          await locator.click();
          await page.getByRole("option").nth(option ? 0 : 1).click();
        }
      } else if (action.type) {
        await locator.click();
        // Start from an empty field (the AI recommendation may have filled it).
        await locator.fill("");
        await locator.pressSequentially(action.text, { delay: 28 });
      }
    }
  } catch (error) {
    if (!quiet) console.warn(`  ! ${JSON.stringify(action)}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
}

const timeline = [];
await page.goto(`${APP_URL}/dashboard`, { waitUntil: "load" });
await settle();
await page.screenshot({ path: path.join(dir, "..", "start.png") });
await sleep(LEAD_IN_SECONDS * 1000);
for (const [index, scene] of script.scenes.entries()) {
  const start = elapsed();
  timeline.push({ id: scene.id, start });
  console.log(`Scene ${scene.id} at ${start.toFixed(1)}s (${lengths[index]}s)`);
  for (const action of scene.show ?? []) await step(action);
  const remaining = start + lengths[index] - elapsed();
  if (remaining > 0) await sleep(remaining * 1000);
}
const total = elapsed() + 0.5;
await sleep(500);
const video = page.video();
// Keep the renewed sign-in: Sentinel rotates its session, and the old one
// stops working once it has been refreshed.
await context.storageState({ path: AUTH });
await context.close();
await browser.close();
const recorded = await video.path();
const out = path.join(dir, "..", "recording.webm");
fs.copyFileSync(recorded, out);
fs.writeFileSync(path.join(dir, "..", "timeline.json"), JSON.stringify({ total, scenes: timeline }, null, 2));
console.log(`Recorded ${total.toFixed(1)}s → ${out}`);
