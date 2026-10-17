// Narrates a script in each of its voices through Convex
// (videoNarration:narrate) and downloads the audio and captions to
// tools/videos/out/<video>/<voice>/.
//   node tools/videos/narrate.mjs b11-review-case
import fs from "node:fs";
import path from "node:path";
import { convexRun, loadScript, videoDir } from "./lib.mjs";

const script = loadScript(process.argv[2] ?? "");
const only = process.argv[3];
for (const [voice, { voiceId, name }] of Object.entries(script.voices)) {
  if (only && voice !== only) continue;
  console.log(`Narrating ${script.video} with ${name}…`);
  let result;
  try {
    result = convexRun("videoNarration:narrate", {
    video: script.video,
    voiceId,
    ...(script.modelId ? { modelId: script.modelId } : {}),
    scenes: script.scenes.map((scene) => ({ id: scene.id, text: scene.say })),
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    console.warn(`  ! ${name} skipped: ${/paid_plan_required/.test(message) ? "ElevenLabs needs a paid plan to use this Voice Library voice." : message.split("\n").slice(-4).join(" ").slice(0, 300)}`);
    continue;
  }
  const dir = videoDir(script, voice);
  for (const scene of result.scenes) {
    const response = await fetch(scene.url);
    if (!response.ok) throw new Error(`Download failed for ${scene.id}: HTTP ${response.status}`);
    fs.writeFileSync(path.join(dir, `${scene.id}.mp3`), Buffer.from(await response.arrayBuffer()));
  }
  fs.writeFileSync(path.join(dir, "narration.json"), JSON.stringify({ voice, name, voiceId, totalSeconds: result.totalSeconds, scenes: result.scenes.map(({ url, ...rest }) => rest) }, null, 2));
  console.log(`  ${result.scenes.length} scenes, ${result.totalSeconds}s → ${dir}`);
}
