// Shared helpers for the training video pipeline (tools/videos/README.md).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(ROOT, "..", "..");
export const OUT = path.join(ROOT, "out");
export const AUTH = path.join(ROOT, ".auth", "state.json");
export const APP_URL = process.env.SENTINEL_VIDEO_URL ?? "https://sentinel.deeptrack.io";
// Time on screen after each scene's narration, and before the first one.
export const SCENE_PAD_SECONDS = 0.6;
export const LEAD_IN_SECONDS = 0.8;
// Demo Bank Ltd (backend/convex/demoSeed.ts) in production: recordings
// open on this organization through Sentinel's sentinel_client_id cookie.
export const DEMO_CLIENT_ID = process.env.SENTINEL_VIDEO_CLIENT_ID ?? "m57bcx0z62as4cawh5hzq97f2s8gc0zf";
// The installed Google Chrome (in a clean, separate profile), or "msedge".
export const BROWSER_CHANNEL = process.env.SENTINEL_VIDEO_BROWSER ?? "chrome";

export function loadScript(nameOrPath) {
  const file = fs.existsSync(nameOrPath) ? nameOrPath : path.join(ROOT, "scripts", `${nameOrPath.replace(/\.json$/, "")}.json`);
  const script = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!script.video || !Array.isArray(script.scenes) || !script.voices?.default) throw new Error(`${file} needs video, voices.default and scenes.`);
  return script;
}

export function videoDir(script, ...parts) {
  const dir = path.join(OUT, script.video, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Runs an internal Convex function on the deployment the CLI is set up for.
export function convexRun(fn, args) {
  // The CLI through Node itself: no shell, so the JSON arrives intact.
  const cli = path.join(REPO, "node_modules", "convex", "bin", "main.js");
  const output = execFileSync(process.execPath, [cli, "run", fn, JSON.stringify(args)], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const start = output.indexOf("{");
  return JSON.parse(output.slice(start));
}

// ffmpeg from FFMPEG, the PATH, or WinGet's install folder (a terminal
// opened before the install doesn't have it on its PATH yet).
function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const packages = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  if (process.platform === "win32" && fs.existsSync(packages)) {
    for (const dir of fs.readdirSync(packages).filter((name) => name.startsWith("Gyan.FFmpeg"))) {
      for (const build of fs.readdirSync(path.join(packages, dir))) {
        const exe = path.join(packages, dir, build, "bin", "ffmpeg.exe");
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return "ffmpeg";
}

export function ffmpeg(args) {
  execFileSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

export function secondsToSrt(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

// The voices narrated so far (a voice can wait, e.g. on a paid plan).
export function narratedVoices(script) {
  const voices = Object.keys(script.voices).filter((voice) => fs.existsSync(path.join(OUT, script.video, voice, "narration.json")));
  if (!voices.length) throw new Error(`Narrate ${script.video} first.`);
  return voices;
}

// Each scene's on-screen length: the longer voice, plus a short pause.
export function sceneLengths(script) {
  const voices = narratedVoices(script);
  return script.scenes.map((scene) => {
    const longest = Math.max(
      ...voices.map((voice) => {
        const file = path.join(OUT, script.video, voice, "narration.json");
        if (!fs.existsSync(file)) throw new Error(`Narrate first: ${file} is missing.`);
        const narration = JSON.parse(fs.readFileSync(file, "utf8"));
        return narration.scenes.find((item) => item.id === scene.id)?.seconds ?? 0;
      }),
    );
    return Math.round((longest + SCENE_PAD_SECONDS) * 100) / 100;
  });
}
