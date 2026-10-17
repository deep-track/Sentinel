// Captures the screenshots for the in-app manual (content/help) from Demo
// Bank Ltd in production, signed in through login.mjs. The list is
// tools/videos/shots.json; each image goes to public/help/shots/<name>.png,
// or, for Manual D (staff only), content/help/d/shots/<name>.png.
//   node tools/videos/shots.mjs              every shot in the list
//   node tools/videos/shots.mjs b11-queue a3-overview [--show]
//
// Shots only look: steps may open a record, switch a tab or filter, open a
// dialog and cancel it, or type without saving. Clicks on anything that
// saves, sends or decides are refused (see REFUSE).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { APP_URL, AUTH, BROWSER_CHANNEL, DEMO_CLIENT_ID, REPO, ROOT } from "./lib.mjs";

const list = JSON.parse(fs.readFileSync(path.join(ROOT, "shots.json"), "utf8"));
const OUT_DIR = path.join(REPO, "public", "help", "shots");
const RUNBOOK_DIR = path.join(REPO, "content", "help", "d", "shots");
const viewport = list.viewport ?? { width: 1440, height: 900 };
const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
// Shots that change Demo Bank (e.g. b13-upload-summary uploads a few invented
// transactions) run only when named and with --uploads.
const allowUploads = process.argv.includes("--uploads");
const shots = list.shots.filter((shot) => (!wanted.length || wanted.includes(shot.name)) && (!shot.uploads || (allowUploads && wanted.includes(shot.name))));
const SAVE_EVERY = 15;
if (!fs.existsSync(AUTH)) throw new Error("Sign in first: node tools/videos/login.mjs");
if (!shots.length) throw new Error(`No shots named ${wanted.join(", ")} in shots.json.`);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(RUNBOOK_DIR, { recursive: true });

// Buttons and links a shot must never press, whatever the list says. Cancel
// and Close are allowed only inside a dialog (elsewhere Cancel can cancel a
// sent capture link).
const REFUSE = /\b(save|send|submit|pay|delete|remove|approve|decide|invite|upload|download|create|apply|issue|mark|import|log request|read (names|appointments)|rotate|revoke|take it|release|resend|run checks|sign off|withdraw|escalate|final|deactivate|verify|start|export|csv|pdf|xml|json|confirm|reject|use this|test|set up|choose and|top up|assign|unassign|logout|sign out)\b/i;

// Client manuals hide the Back Office link (clients never see it); Back
// Office shots ("internal": true) keep it. Toasts are hidden everywhere.
const CLIENT_CSS = 'a[href^="/internal-ops"]{display:none!important}';
const COMMON_CSS = "[data-sonner-toaster]{display:none!important}nextjs-portal{display:none!important}";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: !process.argv.includes("--show") });
const context = await browser.newContext({ storageState: AUTH, viewport, deviceScaleFactor: 1 });
await context.addCookies([{ name: "sentinel_client_id", value: DEMO_CLIENT_ID, url: APP_URL }]);
let page = await context.newPage();
const signedInPage = page;
let view = viewport;
let current = null;

class SignedOut extends Error {}

function checkSignedIn() {
  if (current?.customer) return;
  const url = page.url();
  if (!url.startsWith(APP_URL) || /\/(auth\/login|sign-in|access-pending)/.test(url)) throw new SignedOut(`Signed out (landed on ${url.split("?")[0]}). Sign in again: node tools/videos/login.mjs`);
}

async function addCss() {
  // A close-up of a settings card leaves the floating Save bar in its place
  // at the foot of the form, so it never covers the card.
  const crop = current?.crop ? ".sticky.bottom-4{position:static!important}" : "";
  const css = COMMON_CSS + (current?.internal ? "" : CLIENT_CSS) + crop + (current?.css ?? "");
  await page.addStyleTag({ content: css }).catch(() => undefined);
}

// Sentinel keeps a live Convex connection, so "network idle" never comes:
// wait for the page to load and its data to render.
async function settle(ms = 1500) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.locator("main").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => undefined);
  await sleep(800);
  checkSignedIn();
  // Loading placeholders (skeletons) pulse until the data arrives.
  await page.waitForFunction(() => !document.querySelector(".animate-pulse"), null, { timeout: 15000 }).catch(() => undefined);
  await sleep(ms);
  checkSignedIn();
  await addCss();
}

// A click that opens another page starts it at the top, wherever the
// previous page was scrolled to.
async function scrollToTop() {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    for (const el of document.querySelectorAll("*")) if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: "instant" });
  });
}

// The same kinds of targets as record.mjs, plus link:, tab:, row: and css:.
function target(spec, scope = page) {
  const [kind, ...rest] = spec.split(":");
  const value = rest.join(":");
  switch (kind) {
    case "sidebar":
      return scope.getByRole("link", { name: value, exact: true }).first();
    case "link":
      return scope.getByRole("link", { name: value }).first();
    case "button":
      return scope.getByRole("button", { name: value }).first();
    case "tab":
      return scope.getByRole("tab", { name: value }).first().or(scope.getByRole("button", { name: value }).first()).first();
    case "case":
      return scope.getByRole("link", { name: value }).first().or(scope.getByText(value).filter({ visible: true }).first()).first();
    case "card":
      // A heading that starts with the text, and the box around it.
      return scope.getByRole("heading", { name: new RegExp("^\\s*" + escapeRegex(value)) }).first().locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
    case "heading":
      return scope.getByRole("heading", { name: value }).first();
    case "text":
      // The box (card, tile) around a piece of text.
      return scope.getByText(value).filter({ visible: true }).first().locator("xpath=ancestor-or-self::*[contains(@class,'rounded')][1]");
    case "row":
      return scope.getByRole("row", { name: new RegExp(escapeRegex(value)) }).first();
    case "field":
      return scope.getByLabel(value).first();
    case "form":
      return scope.getByRole("heading", { name: "Decision", exact: true }).first().locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
    case "queue-filter":
      return scope.getByLabel("Queue").first();
    case "views":
      return scope.getByRole("button", { name: /Assigned to me/ }).first().locator("xpath=..");
    case "dialog":
      return scope.getByRole("dialog").first();
    case "css":
      return scope.locator(value).first();
    default:
      return scope.locator("main").first();
  }
}

// Scrolls whatever scrolls (the window or the layout's own scroller) so the
// element sits `offset` pixels below the top of the window.
async function scrollNearTop(locator, offset) {
  await locator.evaluate((el, gap) => {
    el.scrollIntoView({ block: "start", behavior: "instant" });
    let box = el.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    (box ?? window).scrollBy({ top: -gap, behavior: "instant" });
  }, offset);
}

async function clickSafely(locator, action) {
  const name = (await locator.evaluate((el) => `${el.getAttribute("aria-label") ?? ""} ${el.innerText ?? el.textContent ?? ""}`).catch(() => "")).trim();
  const inDialog = await locator.evaluate((el) => !!el.closest('[role="dialog"],[role="alertdialog"]')).catch(() => false);
  const isSubmit = await locator.evaluate((el) => el.tagName === "BUTTON" && el.type === "submit" && !!el.form).catch(() => false);
  const closing = /^(cancel|close)$/i.test(name);
  if (closing && !inDialog) throw new Error(`refused to click "${name}" outside a dialog`);
  if (!closing && !action.allow && (REFUSE.test(name) || isSubmit)) throw new Error(`refused to click "${name}"`);
  await locator.click();
}

async function step(action) {
  if (action.goto) {
    await page.goto(`${APP_URL}${action.goto}`, { waitUntil: "load" });
    await settle(action.wait);
    return;
  }
  if (action.wait && Object.keys(action).length === 1) return sleep(action.wait);
  if (action.key) {
    await page.keyboard.press(action.key);
    return sleep(500);
  }
  const scope = action.dialog ? page.getByRole("dialog").first() : page;
  const spec = action.click ?? action.scroll ?? action.select ?? action.type ?? action.check ?? action.uncheck ?? action.hover ?? action.file ?? action.fill;
  const locator = target(spec, scope);
  // File inputs are usually visually hidden behind their label.
  await locator.waitFor({ state: action.file ? "attached" : "visible", timeout: 8000 });
  if (action.scroll) {
    // Bring the target near the top of the window (under the page header).
    await scrollNearTop(locator, action.offset ?? 80);
    await sleep(500);
  } else if (action.click) {
    await locator.scrollIntoViewIfNeeded();
    const before = page.url();
    await clickSafely(locator, action);
    await settle(action.wait);
    if (page.url() !== before) await scrollToTop();
  } else if (action.hover) {
    await locator.hover();
    await sleep(600);
  } else if (action.check || action.uncheck) {
    // Ticks or unticks a box on screen only; nothing is saved without Save.
    await (action.check ? locator.check() : locator.uncheck());
    await sleep(400);
  } else if (action.select) {
    const isSelect = await locator.evaluate((el) => el.tagName === "SELECT");
    const label = action.option ?? (action.select.startsWith("queue-filter") ? action.select.split(":")[1] : undefined);
    if (isSelect) await locator.selectOption(label ? { label } : { index: 1 });
    else {
      await locator.click();
      const options = page.getByRole("option");
      await (label ? options.filter({ hasText: label }).first() : options.nth(1)).click();
    }
    await settle(action.wait ?? 1200);
  } else if (action.file) {
    // Invented sample images only (see makeSamples), for wizard steps.
    await locator.setInputFiles(path.join(SAMPLES, action.path));
    await sleep(1500);
    await page.waitForFunction(() => !/uploading…/i.test(document.body.innerText), null, { timeout: 45000 });
    await sleep(800);
  } else if (action.fill) {
    // Date and number inputs take a value, not keystrokes.
    await locator.fill(action.text);
    await sleep(300);
  } else if (action.type) {
    await locator.click();
    await locator.fill("");
    await locator.pressSequentially(action.text, { delay: 10 });
    await sleep(400);
  }
}

// The whole window, a box in it, or an element (with some margin).
async function capture(shot, file) {
  await page.mouse.move(view.width - 5, view.height - 5);
  await sleep(300);
  // Lines a manual shouldn't show (e.g. the IP address the shot was taken from).
  if (shot.hideText?.length) {
    await page.evaluate((texts) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (texts.some((text) => node.textContent.includes(text))) node.parentElement.style.visibility = "hidden";
    }, shot.hideText);
  }
  if (shot.clip) return page.screenshot({ path: file, clip: shot.clip });
  if (!shot.crop) return page.screenshot({ path: file });
  const locator = target(shot.crop);
  await locator.waitFor({ state: "visible", timeout: 8000 });
  if (!shot.keepScroll) await scrollNearTop(locator, 90);
  await sleep(500);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${shot.crop}`);
  const pad = shot.pad ?? 16;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const width = Math.min(view.width - x, box.width + pad * 2);
  const height = Math.min(shot.maxHeight ?? Infinity, box.height + pad * 2);
  if (y + height <= view.height) return page.screenshot({ path: file, clip: { x, y, width, height } });
  // Near the foot of the page (or taller than the window): clip the whole
  // page instead, in page coordinates.
  const scrollY = await page.evaluate(() => window.scrollY);
  return page.screenshot({ path: file, fullPage: true, clip: { x, y: y + scrollY, width, height } });
}

// Invented sample images for the KYC and KYB wizards: a specimen ID card,
// a drawn (not photographed) face and two business documents, made here and
// never taken from real people or documents.
const SAMPLES = path.join(ROOT, "out", "samples");
async function makeSamples() {
  const card = (side) => `<div style="width:860px;height:540px;border-radius:28px;background:linear-gradient(135deg,#dbeafe,#fef9c3);font:28px system-ui;padding:36px;box-sizing:border-box;position:relative">
    <div style="font-weight:700;font-size:34px">REPUBLIC OF SPECIMEN · DEMO IDENTITY CARD</div><div style="color:#b91c1c;font-weight:800;font-size:40px;position:absolute;right:40px;bottom:30px;transform:rotate(-12deg)">SPECIMEN · NOT VALID</div>
    ${side === "front" ? '<svg width="220" height="270" style="position:absolute;left:40px;top:130px"><rect width="220" height="270" rx="16" fill="#cbd5e1"/><circle cx="110" cy="105" r="55" fill="#94a3b8"/><rect x="35" y="175" width="150" height="95" rx="70" fill="#94a3b8"/></svg><div style="position:absolute;left:300px;top:150px;line-height:1.7">NAME: AMANI DEMO SPECIMEN<br>ID NO: 00000000<br>DATE OF BIRTH: 01.01.1990<br>SEX: F</div>' : '<div style="position:absolute;left:40px;top:150px;line-height:1.7">DISTRICT: DEMO<br>PLACE OF ISSUE: SPECIMEN<br>&lt;&lt;&lt;DEMO&lt;SPECIMEN&lt;&lt;00000000&lt;&lt;&lt;</div>'}</div>`;
  const face = '<svg width="600" height="760" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="760" fill="#e0f2fe"/><ellipse cx="300" cy="330" rx="170" ry="210" fill="#c68642"/><circle cx="240" cy="300" r="18" fill="#1f2937"/><circle cx="360" cy="300" r="18" fill="#1f2937"/><path d="M230 420 Q300 470 370 420" stroke="#7c2d12" stroke-width="12" fill="none"/><path d="M130 260 Q300 40 470 260 Q420 150 300 140 Q180 150 130 260" fill="#111827"/><rect x="150" y="560" width="300" height="200" rx="120" fill="#7c3aed"/><text x="300" y="740" font-size="30" text-anchor="middle" fill="#fff" font-family="system-ui">ILLUSTRATION · NOT A PHOTO</text></svg>';
  const doc = (title, lines) => `<div style="width:820px;height:1100px;background:#fff;font:24px Georgia;padding:70px;box-sizing:border-box;border:2px solid #333"><div style="font-size:38px;font-weight:700;text-align:center">${title}</div><div style="color:#b91c1c;text-align:center;margin:12px 0 50px;font:700 26px system-ui">SPECIMEN · INVENTED FOR TRAINING</div>${lines.map((line) => `<p>${line}</p>`).join("")}</div>`;
  const items = {
    "id-front.png": card("front"),
    "id-back.png": card("back"),
    "selfie.png": face,
    "certificate.png": doc("CERTIFICATE OF INCORPORATION", ["This is to certify that MSITU DEMO TRADERS LIMITED is incorporated as a private company limited by shares.", "Registration number: PVT-DEMO2024X", "Dated: 12 March 2024", "Registrar of Companies (specimen)"]),
    "utility-bill.png": doc("DEMO POWER COMPANY · ELECTRICITY BILL", ["Account: MSITU DEMO TRADERS LIMITED", "Premises: Plot 7, Demo Road, Nairobi", "Billing period: September 2026", "Amount due: KES 4,250.00"]),
  };
  fs.mkdirSync(SAMPLES, { recursive: true });
  // Invented transactions for Demo Bank: 3 new (fresh ids each run), 1 that
  // repeats a seeded externalId and 1 with an invalid direction.
  const stamp = Date.now().toString(36).toUpperCase();
  fs.writeFileSync(path.join(SAMPLES, "transactions.csv"), [
    "externalId,customerRef,occurredAt,amount,currency,direction,channel,counterpartyName,counterpartyCountry,counterpartyAccount,narration",
    `MANUAL-${stamp}-1,CUST-2077,2026-10-17T09:15:00+03:00,2500,KES,in,mpesa,Demo Shop One,KE,0700000201,Demo payment (manual screenshot)`,
    `MANUAL-${stamp}-2,CUST-2077,2026-10-17T10:40:00+03:00,1800,KES,out,mpesa,Demo Shop Two,KE,0700000202,Demo payment (manual screenshot)`,
    `MANUAL-${stamp}-3,CUST-2077,2026-10-17T11:05:00+03:00,3200,KES,in,bank_transfer,Demo Supplier,KE,0000000203,Demo payment (manual screenshot)`,
    "DEMO-TX-0059,CUST-2077,2026-10-11T22:32:00+03:00,1850000,KES,in,cash,,KE,,Repeat of a seeded transaction",
    `MANUAL-${stamp}-4,CUST-2077,2026-10-17T12:00:00+03:00,900,KES,sideways,mpesa,Demo Shop Three,KE,0700000204,Invalid direction (manual screenshot)`,
  ].join("\n") + "\n");
  const missing = Object.keys(items).filter((name) => !fs.existsSync(path.join(SAMPLES, name)));
  if (!missing.length) return;
  const scratch = await browser.newPage();
  for (const name of missing) {
    await scratch.setContent(`<body style="margin:0;display:inline-block">${items[name]}</body>`);
    await scratch.locator("body > *").first().screenshot({ path: path.join(SAMPLES, name) });
  }
  await scratch.close();
}
if (shots.some((shot) => JSON.stringify(shot.steps ?? []).includes('"file"'))) await makeSamples();

// A customer's own page (e.g. a capture link) opens in a fresh context with
// no sign-in, at phone size. The link is read from a git-ignored file and is
// never printed.
async function openCustomer(shot) {
  const link = fs.readFileSync(path.join(ROOT, shot.customer), "utf8").trim();
  const phone = shot.viewport ?? { width: 390, height: 844 };
  const fresh = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page = await fresh.newPage();
  view = phone;
  try {
    await page.goto(link, { waitUntil: "load" });
  } catch (error) {
    await fresh.close();
    throw new Error(String(error instanceof Error ? error.message : error).split(link).join("<capture link>"));
  }
  return { fresh, link };
}

const results = { ok: [], failed: [] };
let signedOut = null;
for (const [index, shot] of shots.entries()) {
  current = shot;
  const file = path.join(/^d\d/.test(shot.name) ? RUNBOOK_DIR : OUT_DIR, `${shot.name}.png`);
  let customer = null;
  try {
    if (shot.customer) customer = await openCustomer(shot);
    else await page.goto(`${APP_URL}${shot.route}`, { waitUntil: "load" });
    await settle(shot.wait);
    for (const action of shot.steps ?? []) await step(action);
    await capture(shot, file);
    results.ok.push(shot.name);
    console.log(`✓ ${shot.name}`);
  } catch (error) {
    if (error instanceof SignedOut) {
      signedOut = error;
      break;
    }
    results.failed.push(shot.name);
    let message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    if (customer) message = message.split(customer.link).join("<capture link>");
    console.warn(`✗ ${shot.name}: ${message}`);
  } finally {
    if (customer) await customer.fresh.close();
    page = signedInPage;
    view = viewport;
  }
  // Keep the renewed sign-in (its tokens rotate) through a long run.
  if ((index + 1) % SAVE_EVERY === 0) await context.storageState({ path: AUTH });
}
// Only a working session is saved back.
if (!signedOut) await context.storageState({ path: AUTH });
await browser.close();
console.log(`${results.ok.length} captured, ${results.failed.length} failed${results.failed.length ? `: ${results.failed.join(", ")}` : ""}.`);
if (signedOut) {
  console.error(signedOut.message);
  process.exit(2);
}
if (results.failed.length) process.exitCode = 1;
