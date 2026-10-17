// Sentinel's deepfake shield: every deepfake and AI-forgery signal in a
// check, in one headline. DeepTrack Live checks the selfie for a fake or
// synthetic face and the liveness capture for a deepfake; document
// forensics look for AI-generated, edited and photo-substituted documents.
// No imports, so it can be used from pages, PDFs and Convex alike.

export type ShieldOutcome = "clear" | "flagged" | "uncertain" | "not_run";
export type ShieldCheck = { name: string; by: string; outcome: ShieldOutcome; detail: string };
export type ShieldStatus = "clear" | "detected" | "uncertain" | "not_checked";
export type ShieldSummary = { status: ShieldStatus; headline: string; checks: ShieldCheck[] };

export const SHIELD_HEADLINES: Record<ShieldStatus, string> = {
  clear: "No deepfake or AI forgery detected",
  detected: "Deepfake or AI forgery detected",
  uncertain: "Possible deepfake or AI forgery: a person should look",
  not_checked: "The deepfake check didn't run",
};

const DEEPTRACK_LIVE = "DeepTrack Live";
const FORENSICS = "Sentinel document forensics";

// Document flags by what they show.
const AI_CODES = [/^visual_ai_generated$/, /^ai_generator_metadata$/, /^ai_generation_parameters$/, /^c2pa_.*ai/];
const EDIT_CODES = [/^visual_digitally_altered$/, /^visual_text_tampering$/, /^edited_with_software$/, /^pdf_modified_after_creation$/];
const PHOTO_CODES = [/^visual_photo_substitution$/];

type Flag = { code?: string; message?: string; severity?: string };
type Record_ = Record<string, unknown>;

const asRecord = (value: unknown): Record_ | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record_) : null);
const pct = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : null);

function faceCheck(step: unknown, name: string): ShieldCheck | null {
  const record = asRecord(step);
  if (!record) return null;
  if ("error" in record) return { name, by: DEEPTRACK_LIVE, outcome: "not_run", detail: "DeepTrack Live was unavailable for this check." };
  const prediction = record.prediction;
  const confidence = pct(record.confidencePct);
  if (prediction === "fake") return { name, by: DEEPTRACK_LIVE, outcome: "flagged", detail: `Fake or synthetic face${confidence ? ` (${confidence} confidence)` : ""}.` };
  if (prediction === "real") {
    const strong = typeof record.confidencePct === "number" && record.confidencePct >= 70 && !record.warning;
    return { name, by: DEEPTRACK_LIVE, outcome: strong ? "clear" : "uncertain", detail: strong ? `A real face${confidence ? ` (${confidence} confidence)` : ""}.` : `Probably real, but not certain${confidence ? ` (${confidence})` : ""}${record.warning ? `: ${String(record.warning)}` : ""}.` };
  }
  if (prediction === "uncertain") return { name, by: DEEPTRACK_LIVE, outcome: "uncertain", detail: "DeepTrack Live couldn't tell whether the face is real." };
  return null;
}

function documentChecks(flags: Flag[]): ShieldCheck[] {
  const matching = (patterns: RegExp[]) => flags.filter((flag) => typeof flag.code === "string" && patterns.some((pattern) => pattern.test(flag.code!)));
  const check = (name: string, patterns: RegExp[], clear: string): ShieldCheck => {
    const found = matching(patterns);
    return found.length
      ? { name, by: FORENSICS, outcome: "flagged", detail: found.map((flag) => flag.message ?? flag.code).slice(0, 2).join(" ") }
      : { name, by: FORENSICS, outcome: "clear", detail: clear };
  };
  return [
    check("AI-generated document", AI_CODES, "No sign of an AI-generated image in the picture, its metadata or content credentials."),
    check("Edited or tampered document", EDIT_CODES, "No sign of editing or altered text."),
    check("Photo substitution", PHOTO_CODES, "The holder photo looks original."),
  ];
}

export function summarize(checks: ShieldCheck[]): ShieldSummary {
  const status: ShieldStatus = checks.some((check) => check.outcome === "flagged")
    ? "detected"
    : checks.some((check) => check.outcome === "uncertain")
      ? "uncertain"
      : checks.some((check) => check.outcome === "clear")
        ? "clear"
        : "not_checked";
  return { status, headline: SHIELD_HEADLINES[status], checks };
}

// The shield for a verification, or null for types it doesn't apply to.
export function deepfakeShield(type: string, result: unknown): ShieldSummary | null {
  const record = asRecord(result);
  if (!record || record.sandbox) return null;
  const checks: ShieldCheck[] = [];
  if (type === "idp") {
    const selfie = faceCheck(record.faceCheck, "Selfie: real face");
    if (selfie) checks.push(selfie);
    const liveness = asRecord(record.liveness);
    if (liveness && typeof liveness.deepfakeFlag === "boolean") {
      checks.push({ name: "Liveness: no deepfake", by: DEEPTRACK_LIVE, outcome: liveness.deepfakeFlag ? "flagged" : "clear", detail: liveness.deepfakeFlag ? "The liveness capture was flagged as a deepfake." : "The liveness capture shows no deepfake." });
    } else if (liveness && "error" in liveness) {
      checks.push({ name: "Liveness: no deepfake", by: DEEPTRACK_LIVE, outcome: "not_run", detail: "The liveness service was unavailable." });
    } else if (liveness?.status === "not_collected") {
      checks.push({ name: "Liveness: no deepfake", by: DEEPTRACK_LIVE, outcome: "not_run", detail: "No liveness capture was collected." });
    }
    const video = faceCheck(liveness?.deeptrackLive, "Liveness video: real face");
    if (video) checks.push(video);
    const docScan = asRecord(record.docScan);
    if (docScan && typeof docScan.fakeScore === "number") {
      const score = docScan.fakeScore;
      checks.push({ name: "ID document: not forged", by: FORENSICS, outcome: score > 0.5 ? "flagged" : score > 0.25 ? "uncertain" : "clear", detail: `Forgery score ${Math.round(score * 100)}%.` });
    }
  } else if (type === "document") {
    checks.push(...documentChecks(Array.isArray(record.flags) ? (record.flags as Flag[]) : []));
  } else if (type === "liveness") {
    const video = faceCheck(asRecord(record.liveness)?.deeptrackLive ?? record.deeptrackLive ?? record, "Liveness: real face");
    if (video) checks.push(video);
  } else {
    return null;
  }
  return checks.length ? summarize(checks) : null;
}
