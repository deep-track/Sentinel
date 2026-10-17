import { normalizeIdentifier, namePartOverlap, namePartsForHash } from "./fraudNetwork";

// Face match for KYC (faceMatchNode.ts): the selfie (or the first liveness
// frame) compared with the photo on the ID document by Amazon Rekognition,
// and, when the client turns it on, a search of the client's own customers
// for the same face under another identity.

// Rekognition similarity (0-100) for the selfie and the ID photo.
export const FACE_MATCH_PASS = 90; // the same person
export const FACE_MATCH_REVIEW = 70; // 70-90: unclear, a reviewer compares
// The same face in the client's collection.
export const DUPLICATE_FACE_SIMILARITY = 95;

export type FaceMatchOutcome = "match" | "uncertain" | "mismatch" | "no_face_selfie" | "no_face_document";

export function faceMatchOutcome(input: { probeFace: boolean; documentFace: boolean; similarity: number | null }): FaceMatchOutcome {
  if (!input.probeFace) return "no_face_selfie";
  if (!input.documentFace) return "no_face_document";
  const similarity = input.similarity ?? 0;
  if (similarity >= FACE_MATCH_PASS) return "match";
  if (similarity >= FACE_MATCH_REVIEW) return "uncertain";
  return "mismatch";
}

export const FACE_MATCH_MESSAGES: Record<FaceMatchOutcome, string> = {
  match: "The selfie matches the photo on the ID.",
  uncertain: "The selfie may not match the photo on the ID: a reviewer should compare them.",
  mismatch: "The selfie doesn't match the photo on the ID.",
  no_face_selfie: "No clear face was found in the selfie.",
  no_face_document: "No clear face was found on the ID document.",
};

export type DuplicateFace = { reference: string; similarity: number; sameIdentity: boolean; createdAt: number };

// Earlier customers of the client with the same face. The same ID number
// (or, without one, the same name) is a returning customer, not a signal.
export function assessDuplicates(
  current: { idNumber: string | null; name: string | null },
  others: Array<{ reference: string; similarity: number; idNumber: string | null; name: string | null; createdAt: number }>,
): DuplicateFace[] {
  const id = current.idNumber ? normalizeIdentifier("id_number", current.idNumber) : null;
  const parts = current.name ? namePartsForHash(current.name) : [];
  return others.map((other) => {
    const otherId = other.idNumber ? normalizeIdentifier("id_number", other.idNumber) : null;
    const sameIdentity = id && otherId ? id === otherId : namePartOverlap(parts, other.name ? namePartsForHash(other.name) : []) >= 0.5;
    return { reference: other.reference, similarity: Math.round(other.similarity * 10) / 10, sameIdentity, createdAt: other.createdAt };
  });
}

export type FaceMatchResult = {
  status: "completed";
  probe: "selfie" | "liveness_frame";
  outcome: FaceMatchOutcome;
  similarity: number | null;
  message: string;
  duplicateSearch: boolean;
  duplicates: DuplicateFace[];
};

// What the face match does to a KYC verdict: a clear match changes
// nothing; anything else, or the same face under another identity, holds a
// pass for review. Face results never reject on their own.
export function faceMatchReview(result: FaceMatchResult): string | null {
  const reasons: string[] = [];
  if (result.outcome !== "match") reasons.push(result.message);
  const others = result.duplicates.filter((duplicate) => !duplicate.sameIdentity);
  if (others.length) {
    reasons.push(`The same face is on ${others.length === 1 ? "another customer" : `${others.length} other customers`} verified under a different identity (${others.map((duplicate) => duplicate.reference).slice(0, 3).join(", ")}).`);
  }
  return reasons.length ? `Face match: ${reasons.join(" ")}` : null;
}

// The first JPEG in a liveness "jpeg_frames" upload (one JPEG, or several
// back to back), or null.
export function firstJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let index = 2; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return bytes.subarray(0, index + 2);
  }
  return bytes;
}

// Rekognition reads JPEG and PNG up to 5 MB as bytes.
export const MAX_REKOGNITION_BYTES = 5 * 1024 * 1024;

export function isRekognitionImage(bytes: Uint8Array): boolean {
  if (bytes.length > MAX_REKOGNITION_BYTES) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return jpeg || png;
}

// One Rekognition collection per client, so a search never crosses clients.
export function collectionIdFor(clientId: string): string {
  return `sentinel-${clientId}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

// How a stored face match step reads on the KYC page and PDF.
export function describeFaceMatch(step: unknown): { result: string; tone: "green" | "amber" | "red" | "neutral"; detail: string } | null {
  if (!step || typeof step !== "object") return null;
  const record = step as Omit<Partial<FaceMatchResult>, "status"> & { status?: string; reason?: string; error?: string };
  if (record.error) return { result: "Error", tone: "amber", detail: "The face comparison service was unavailable, so a reviewer compares the faces." };
  if (record.status === "not_configured") return { result: "Not set up", tone: "neutral", detail: "Face match isn't set up for Sentinel yet." };
  if (record.status === "skipped") return { result: "Not run", tone: "neutral", detail: record.reason ?? "Face match didn't run." };
  if (record.status !== "completed" || !record.outcome) return null;
  const source = record.probe === "liveness_frame" ? "liveness photo" : "selfie";
  const similarity = record.similarity === null || record.similarity === undefined ? "" : ` Similarity ${record.similarity}% (match at ${FACE_MATCH_PASS}% or more).`;
  const others = (record.duplicates ?? []).filter((duplicate) => !duplicate.sameIdentity);
  const returning = (record.duplicates ?? []).filter((duplicate) => duplicate.sameIdentity);
  const duplicateText = !record.duplicateSearch
    ? ""
    : others.length
      ? ` Same face under a different identity: ${others.map((duplicate) => `${duplicate.reference} (${duplicate.similarity}%)`).join(", ")}.`
      : ` No other customer of yours has this face${returning.length ? ` (seen before under the same identity: ${returning.map((duplicate) => duplicate.reference).join(", ")})` : ""}.`;
  const label = { match: "Match", uncertain: "Unclear", mismatch: "No match", no_face_selfie: "No face", no_face_document: "No face" }[record.outcome];
  const tone = record.outcome === "match" && !others.length ? "green" : record.outcome === "mismatch" || others.length ? "red" : "amber";
  return { result: others.length && record.outcome === "match" ? "Duplicate face" : label, tone, detail: `${record.message ?? ""} Compared the ${source} with the ID photo.${similarity}${duplicateText}`.trim() };
}
