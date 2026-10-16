// Opens Sentinel in a browser window for you to sign in once (as an Admin
// of Demo Bank Ltd). The session is saved to tools/videos/.auth/state.json
// (git-ignored) so recordings run signed in. Nobody types your password
// but you.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { APP_URL, AUTH, BROWSER_CHANNEL } from "./lib.mjs";

// Maximized and sized by the window itself, so the whole sign-in page fits
// the screen (Continue with Google sits below the password box).
const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: false, args: ["--start-maximized"] });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(`${APP_URL}/dashboard`);
console.log("Sign in in the browser window. When the Sentinel dashboard shows, switch to Demo Bank Ltd if needed. Waiting up to 15 minutes…");
await page.waitForURL(/\/dashboard/, { timeout: 900_000 });
await page.waitForSelector("text=Demo Bank Ltd", { timeout: 900_000 }).catch(() => console.log("Couldn't see Demo Bank Ltd on screen; saving the session anyway."));
fs.mkdirSync(path.dirname(AUTH), { recursive: true });
await context.storageState({ path: AUTH });
console.log(`Saved the signed-in session to ${AUTH}.`);
await browser.close();
