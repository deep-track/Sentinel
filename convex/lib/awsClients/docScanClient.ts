import { callInternalService } from "./internalFetch";

export type DocScanRequest = {
  frontImageBase64: string; // JPEG/PNG
  backImageBase64?: string;
};

export type DocScanFlag = "mrz_mismatch" | "font_anomaly" | "metadata_tamper" | "holo_missing";

export type DocScanResult = {
  fakeScore: number; // 0-1
  flags: DocScanFlag[];
  documentType: string;
};

// Pass threshold per Section 5.2 / 8.3 note: fake_score <= 0.25 AND
// flags array is empty.
export function passesDocScanThreshold(result: DocScanResult): boolean {
  return result.fakeScore <= 0.25 && result.flags.length === 0;
}

export async function scanDocument(
  req: DocScanRequest,
): Promise<DocScanResult> {
  const raw = await callInternalService<{
    fake_score: number;
    flags: DocScanFlag[];
    document_type: string;
  }>("/internal/doc-scan", {
    front_image: req.frontImageBase64,
    back_image: req.backImageBase64 ?? null,
  });

  return {
    fakeScore: raw.fake_score,
    flags: raw.flags,
    documentType: raw.document_type,
  };
}