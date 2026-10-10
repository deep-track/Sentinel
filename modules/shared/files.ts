// Browser-only helpers for verification uploads. Call these from client
// components (event handlers) only.
import { uploadFiles } from "@/backend/lib/uploadthing";

/** Largest original photo we accept before downscaling (camera photos are often 4–8 MB). */
export const MAX_IMAGE_INPUT_BYTES = 15 * 1024 * 1024;
/** Matches the UploadThing route limit (8MB for images and PDFs) in app/api/uploadthing/core.ts. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const DOCUMENT_ACCEPT = "application/pdf,image/jpeg,image/png";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

// Base64 inflates by ~4/3. The backend rejects any media field over
// 1,000,000 base64 characters (MAX_MEDIA_BASE64_CHARS in
// backend/convex/lib/verificationTypes.ts), i.e. ~730 KB of JPEG. Aim well
// under that.
const TARGET_IMAGE_BYTES = 600 * 1024;
const MAX_IMAGE_BYTES_AFTER_COMPRESSION = 720 * 1024;
const COMPRESSION_STEPS = [
  { maxDimension: 1600, quality: 0.85 },
  { maxDimension: 1280, quality: 0.8 },
  { maxDimension: 1024, quality: 0.75 },
] as const;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Removes a `data:<mime>;base64,` prefix, leaving raw base64. */
export function stripDataUrlPrefix(value: string): string {
  if (!value.startsWith("data:")) return value;
  const comma = value.indexOf(",");
  return comma >= 0 ? value.slice(comma + 1) : value;
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(blob);
  });
}

type Drawable = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decodeImage(file: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to <img> decoding (older Safari).
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("This image couldn't be read. Use a JPG or PNG photo."));
      element.src = objectUrl;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This image couldn't be processed."))),
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Downscales (longest side ≤ 1600px) and re-encodes an image as JPEG so the
 * base64 sent to Convex stays small. Steps down further for very detailed
 * images.
 */
export async function compressImage(file: File): Promise<File> {
  const image = await decodeImage(file);
  try {
    let blob: Blob | null = null;
    for (const step of COMPRESSION_STEPS) {
      const scale = Math.min(1, step.maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser can't process images.");
      // JPEG has no alpha; flatten transparent PNGs onto white instead of black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      blob = await canvasToJpeg(canvas, step.quality);
      if (blob.size <= TARGET_IMAGE_BYTES) break;
    }
    if (!blob) throw new Error("This image couldn't be processed.");
    if (blob.size > MAX_IMAGE_BYTES_AFTER_COMPRESSION) {
      throw new Error("This image is too detailed to send. Crop it to the document and try again.");
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    image.close();
  }
}

/** Uploads a file to UploadThing and returns its permanent URL. */
export async function uploadToStorage(file: File): Promise<string> {
  const uploaded = await uploadFiles("kycUploader", { files: [file] });
  const url = uploaded[0]?.ufsUrl ?? uploaded[0]?.url;
  if (!url) throw new Error("Upload failed. Please try again.");
  return url;
}

export function validateImageFile(file: File): string | null {
  if (!IMAGE_TYPES.has(file.type)) return "Upload a JPG, PNG or WebP image.";
  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    return `This image is larger than ${formatBytes(MAX_IMAGE_INPUT_BYTES)}. Use a smaller photo.`;
  }
  return null;
}

export function validateDocumentFile(file: File): string | null {
  if (!DOCUMENT_TYPES.has(file.type)) return "Upload a PDF, JPG or PNG file.";
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `This file is larger than ${formatBytes(MAX_DOCUMENT_BYTES)}.`;
  }
  return null;
}

export type PreparedImage = {
  /** Permanent UploadThing URL of the compressed image. */
  url: string;
  /** Raw base64 (no `data:` prefix) of the compressed JPEG. */
  base64: string;
};

/**
 * Validates, compresses, uploads and base64-encodes an identity image. The
 * URL and base64 describe the same compressed JPEG.
 */
export async function prepareVerificationImage(file: File): Promise<PreparedImage> {
  const problem = validateImageFile(file);
  if (problem) throw new Error(problem);
  const compressed = await compressImage(file);
  const [url, dataUrl] = await Promise.all([uploadToStorage(compressed), readAsDataUrl(compressed)]);
  return { url, base64: stripDataUrlPrefix(dataUrl) };
}

/** Validates and uploads a supporting document (PDF or image) and returns its URL. */
export async function uploadSupportingDocument(file: File): Promise<string> {
  const problem = validateDocumentFile(file);
  if (problem) throw new Error(problem);
  return uploadToStorage(file);
}
