import { asRecord, callInternalService, invalidResponse, readArray, readNumber, readString } from "./internalFetch";

export type DocScanRequest = {
  frontImageBase64: string; // JPEG/PNG
  backImageBase64?: string;
};

export type DocScanFlag = "mrz_mismatch" | "font_anomaly" | "metadata_tamper" | "holo_missing";

export type DocScanResult = {
  fakeScore: number; // 0-1
  // Unknown flag strings are kept (not dropped): any flag fails the threshold.
  flags: Array<DocScanFlag | (string & {})>;
  documentType: string;
};

const PATH = "/internal/doc-scan";

export function passesDocScanThreshold(result: DocScanResult): boolean {
  return (
    Number.isFinite(result.fakeScore) &&
    result.fakeScore <= 0.25 &&
    Array.isArray(result.flags) &&
    result.flags.length === 0
  );
}

export function parseDocScanResponse(raw: unknown): DocScanResult {
  const body = asRecord(raw, PATH);
  const flags = readArray(body, "flags", PATH);
  if (!flags.every((flag) => typeof flag === "string")) {
    throw invalidResponse(PATH, "flags contains a non-string value");
  }
  return {
    fakeScore: readNumber(body, "fake_score", PATH, { min: 0, max: 1 }),
    flags: flags as string[],
    documentType: readString(body, "document_type", PATH),
  };
}

export async function scanDocument(
  req: DocScanRequest,
): Promise<DocScanResult> {
  const raw = await callInternalService(PATH, {
    front_image: req.frontImageBase64,
    back_image: req.backImageBase64 ?? null,
  });
  return parseDocScanResponse(raw);
}
