"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { anyApi } from "convex/server";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDate } from "@/components/client-date";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getErrorMessage } from "@/modules/shared/errors";
import { compressImage, readAsDataUrl, stripDataUrlPrefix } from "@/modules/shared/files";

type DocumentKind = "identity" | "proof_of_address";

type Row = {
  _id: string;
  reference: string;
  status: "queued" | "processing" | "completed" | "failed";
  verdict?: "pass" | "review" | "reject" | null;
  failureReason?: string | null;
  input?: { documentKind?: DocumentKind; expectedName?: string | null; externalRef?: string | null } | null;
  result?: {
    riskScore?: number;
    identity?: { fields?: { fullName?: string | null; surname?: string | null; givenNames?: string | null; documentType?: string } };
    proofOfAddress?: { fields?: { holderName?: string | null; documentType?: string } };
    flags?: Array<{ severity: string }>;
  } | null;
  createdAt: number;
};

// Convex caps media at 1,000,000 base64 characters (about 730 KB of file).
const MAX_ORIGINAL_BYTES = 730 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const ACCEPTED_TYPES = new Set(ACCEPT.split(","));

// The original file is sent whenever it fits, so its metadata can be checked
// for AI-generator and editing-tool signatures. Larger images are resized
// (which removes the metadata); larger PDFs can't be shrunk here.
async function prepareFile(file: File): Promise<{ base64: string; resized: boolean }> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error("Upload a JPG, PNG, WebP or PDF file.");
  if (file.size <= MAX_ORIGINAL_BYTES) {
    return { base64: stripDataUrlPrefix(await readAsDataUrl(file)), resized: false };
  }
  if (file.type === "application/pdf") throw new Error("This PDF is larger than 730 KB. Upload a smaller PDF or a photo of the page.");
  const compressed = await compressImage(file);
  return { base64: stripDataUrlPrefix(await readAsDataUrl(compressed)), resized: true };
}

function outcome(row: Row): { label: string; className: string } {
  if (row.status === "failed") return { label: "Failed", className: "text-red-600 dark:text-red-400" };
  if (row.verdict === "pass") return { label: "Verified", className: "text-emerald-600 dark:text-emerald-400" };
  if (row.verdict === "reject") return { label: "Rejected", className: "text-red-600 dark:text-red-400" };
  if (row.verdict === "review") return { label: "Needs review", className: "text-amber-600 dark:text-amber-400" };
  if (row.status === "processing") return { label: "Processing…", className: "text-muted-foreground" };
  return { label: "Queued", className: "text-muted-foreground" };
}

function rowTitle(row: Row): string {
  const identity = row.result?.identity?.fields;
  const name =
    identity?.fullName ??
    ([identity?.givenNames, identity?.surname].filter(Boolean).join(" ") || null) ??
    row.result?.proofOfAddress?.fields?.holderName ??
    row.input?.expectedName ??
    null;
  return name || row.input?.externalRef || row.reference;
}

const inputClass = "mt-2 w-full rounded-lg border p-2.5";

export function DocumentVerificationForm({ clientId, canSubmit }: { clientId: string; canSubmit: boolean }) {
  const submit = useMutation(anyApi.documents.submit);
  const rows = useAuthedQuery(anyApi.documents.listForClient, { clientId, limit: 50 }) as Row[] | undefined;

  const [kind, setKind] = useState<DocumentKind>("identity");
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [expectedName, setExpectedName] = useState("");
  const [expectedDateOfBirth, setExpectedDateOfBirth] = useState("");
  const [expectedAddress, setExpectedAddress] = useState("");
  const [maxAgeDays, setMaxAgeDays] = useState("90");
  const [externalRef, setExternalRef] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!front) {
      setMessage({ tone: "error", text: kind === "identity" ? "Choose the front of the document." : "Choose the document." });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const frontFile = await prepareFile(front);
      const backFile = kind === "identity" && back ? await prepareFile(back) : null;
      const optional = (value: string) => value.trim() || undefined;
      await submit({
        clientId,
        documentKind: kind,
        documentFrontBase64: frontFile.base64,
        ...(backFile ? { documentBackBase64: backFile.base64 } : {}),
        expectedName: optional(expectedName),
        externalRef: optional(externalRef),
        resized: frontFile.resized || backFile?.resized ? true : undefined,
        ...(kind === "identity"
          ? { expectedDateOfBirth: optional(expectedDateOfBirth) }
          : { expectedAddress: optional(expectedAddress), maxDocumentAgeDays: Number(maxAgeDays) || undefined }),
      });
      setFront(null);
      setBack(null);
      setExpectedName("");
      setExpectedDateOfBirth("");
      setExpectedAddress("");
      setExternalRef("");
      setFormKey((key) => key + 1);
      setMessage({
        tone: "info",
        text: frontFile.resized
          ? "Verification queued. The image was resized to fit the upload limit, so its file metadata couldn't be checked."
          : "Verification queued. Results usually take under a minute.",
      });
    } catch (error) {
      setMessage({ tone: "error", text: getErrorMessage(error, "The document couldn't be submitted.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      {canSubmit ? (
        <form key={formKey} onSubmit={verify} className="rounded-xl border bg-card p-6 space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Document type">
            {(
              [
                ["identity", "Identity document", "Passport, national ID, driver's licence, residence permit"],
                ["proof_of_address", "Proof of address", "Utility bill, bank statement, salary slip and 20+ more"],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => setKind(value)}
                className={`flex-1 min-w-[220px] rounded-lg border p-3 text-left text-sm ${kind === value ? "border-primary bg-primary/5" : ""}`}
              >
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              {kind === "identity" ? "Front of the document" : "Document"}
              <input type="file" accept={ACCEPT} onChange={(e) => setFront(e.target.files?.[0] ?? null)} className={inputClass} />
            </label>
            {kind === "identity" ? (
              <label className="text-sm font-medium">
                Back of the document
                <input type="file" accept={ACCEPT} onChange={(e) => setBack(e.target.files?.[0] ?? null)} className={inputClass} />
                <span className="mt-1 block text-xs font-normal text-muted-foreground">Optional; recommended for ID cards and licences</span>
              </label>
            ) : null}
            <label className="text-sm font-medium">
              {kind === "identity" ? "Expected name" : "Customer name"}
              <input value={expectedName} onChange={(e) => setExpectedName(e.target.value)} className={inputClass} placeholder="Optional, to match" maxLength={300} />
            </label>
            {kind === "identity" ? (
              <label className="text-sm font-medium">
                Expected date of birth
                <input value={expectedDateOfBirth} onChange={(e) => setExpectedDateOfBirth(e.target.value)} className={inputClass} placeholder="Optional: YYYY-MM-DD" maxLength={10} />
              </label>
            ) : (
              <>
                <label className="text-sm font-medium">
                  Declared address
                  <input value={expectedAddress} onChange={(e) => setExpectedAddress(e.target.value)} className={inputClass} placeholder="Optional, to match" maxLength={300} />
                </label>
                <label className="text-sm font-medium">
                  Maximum document age (days)
                  <input value={maxAgeDays} onChange={(e) => setMaxAgeDays(e.target.value.replace(/\D/g, ""))} className={inputClass} inputMode="numeric" maxLength={3} />
                </label>
              </>
            )}
            <label className="text-sm font-medium">
              Your reference
              <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} className={inputClass} placeholder="Optional" maxLength={300} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            JPG, PNG, WebP or PDF. Upload the original file where possible: resizing removes metadata that reveals AI-generated or
            edited documents.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {pending ? "Uploading…" : "Verify document"}
          </button>
          {message ? (
            <p className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p>
          ) : null}
        </form>
      ) : (
        <div className="rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Your role can view document verifications but not submit new ones.
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="border-b p-4 font-medium">Recent documents</div>
        <div className="divide-y">
          {rows === undefined ? (
            <div className="space-y-3 p-4" aria-busy="true">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-5 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No documents verified yet.</p>
          ) : (
            rows.map((row) => {
              const state = outcome(row);
              const kindLabel = row.input?.documentKind === "proof_of_address" ? "Proof of address" : "Identity document";
              const flagCount = row.result?.flags?.length ?? 0;
              return (
                <div key={row._id} className="flex items-center justify-between gap-4 p-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{rowTitle(row)}</p>
                    <p className="text-xs text-muted-foreground">
                      {kindLabel} · <ClientDate value={row.createdAt} format="PPp" />
                      {row.status === "completed" && flagCount > 0 ? ` · ${flagCount} flag${flagCount === 1 ? "" : "s"}` : null}
                      {row.status === "failed" && row.failureReason ? ` · ${row.failureReason}` : null}
                    </p>
                  </div>
                  {row.status === "completed" || row.status === "failed" ? (
                    <Link
                      href={`/idp/${row._id}`}
                      className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted ${state.className}`}
                    >
                      {state.label} · View report
                    </Link>
                  ) : (
                    <span className={`shrink-0 font-medium ${state.className}`}>{state.label}</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
