"use node";

import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { fileForensics, MEDIA_TYPES } from "./lib/documentChecks";
import { runDocumentPipeline } from "./lib/documentPipeline";
import type { DocumentImage } from "./lib/documentVision";
import {
  certificateRules,
  certificateVerdict,
  decideKyb,
  isAllowedDocumentUrl,
  readBusinessRegistration,
  type ComponentOutcome,
  type PartyOutcome,
} from "./lib/kybChecks";
import { textractOcr } from "./documentsNode";
import type { ScreeningOutcome } from "./aml";

// KYB automation (Node runtime, for Textract). For a submitted business:
//   1. reads the registration certificate with Claude vision and matches it
//      to the declared name, registration number and directors;
//   2. checks the proof of address with the IDP pipeline (in the business's
//      name), including the Textract OCR cross-check when AWS is configured;
//   3. screens the business and each director / owner for sanctions, PEP,
//      adverse media and the other AML categories (kyb._screenParties);
// then passes it, or opens a review case explaining what needs a person.
// If the checks can't run at all (no Claude key, documents unreachable),
// it falls back to manual review, as before.

const internalApi: any = internal;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

async function fetchDocument(url: string): Promise<{ bytes: Uint8Array; image: DocumentImage } | string> {
  if (!isAllowedDocumentUrl(url)) return "The document isn't stored on Sentinel's upload service.";
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) return `The document couldn't be downloaded (HTTP ${response.status}).`;
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > MAX_DOCUMENT_BYTES) return "The document is larger than 10 MB.";
    const kind = fileForensics(buffer).kind;
    if (kind === "unknown") return "The document isn't a JPEG, PNG, WebP or PDF.";
    return {
      bytes: buffer,
      image: { mediaType: MEDIA_TYPES[kind] as DocumentImage["mediaType"], base64: Buffer.from(buffer).toString("base64"), side: "front" },
    };
  } catch (error) {
    return `The document couldn't be downloaded (${error instanceof Error ? error.message.slice(0, 100) : "network error"}).`;
  }
}

function partyHits(outcome: ScreeningOutcome) {
  return outcome.matches.slice(0, 25).map((match) => {
    const m = match as Record<string, unknown>;
    return {
      source: m.source as "OFAC_SDN" | "UN_CONSOLIDATED" | "OPENSANCTIONS" | "ADVERSE_MEDIA",
      sourceRecordId: String(m.sourceRecordId),
      entityName: String(m.entityName ?? ""),
      program: String(m.program ?? ""),
      matchScore: Number(m.matchScore ?? 0),
      matchMethod: m.matchMethod as "exact" | "normalized" | "alias" | "fuzzy" | "provider_score" | "ai_classification",
      riskLevel: (m.riskLevel === "critical" ? "critical" : "high") as "critical" | "high",
      ...(Array.isArray(m.categories) ? { categories: m.categories as string[] } : {}),
      ...(typeof m.pepClass === "number" ? { pepClass: m.pepClass as 1 | 2 | 3 | 4 } : {}),
      ...(typeof m.matchedCountry === "string" ? { matchedCountry: m.matchedCountry } : {}),
    };
  });
}

export const processKyb = internalAction({
  args: { verificationId: v.id("verifications"), clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const manual = (reason: string, result?: Record<string, unknown>) =>
      ctx.runMutation(internalApi.kyb._manualReview, { verificationId: args.verificationId, clientId: args.clientId, reason, ...(result ? { result } : {}) });

    const loaded: { verification: Doc<"verifications">; directors: Array<Doc<"kybDirectors">> } | null = await ctx.runQuery(internalApi.kyb._forProcessing, { verificationId: args.verificationId });
    if (!loaded) return;
    const { verification, directors } = loaded;
    const input = verification.input as {
      businessName: string;
      registrationNumber: string;
      incorporationCountry: string;
      registrationDocUrl: string;
      proofOfAddressUrl: string;
    };
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      await manual("Business verification needs a person: automatic document checks aren't configured.");
      return;
    }

    try {
      const client = new Anthropic({ apiKey });
      const declaredDirectors = directors.map((director) => `${director.firstName} ${director.lastName}`.trim());

      // 1. Registration certificate.
      let certificate: ComponentOutcome;
      let certificateDetail: Record<string, unknown> | null = null;
      const certificateFile = await fetchDocument(input.registrationDocUrl);
      if (typeof certificateFile === "string") {
        certificate = { verdict: "unavailable", reason: certificateFile };
      } else {
        try {
          const forensics = fileForensics(certificateFile.bytes);
          const vision = await readBusinessRegistration(client, [certificateFile.image]);
          const rules = certificateRules(vision.fields, { businessName: input.businessName, registrationNumber: input.registrationNumber, directors: declaredDirectors });
          const flags = [...vision.flags, ...forensics.flags, ...rules.flags];
          certificate = certificateVerdict(flags);
          certificateDetail = { fields: vision.fields, flags, checks: rules.checks, summary: vision.summary, software: forensics.software, model: vision.model };
        } catch (error) {
          console.error("[kyb] certificate reading failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
          certificate = { verdict: "unavailable", reason: "The certificate couldn't be read automatically." };
        }
      }

      // 2. Proof of address, in the business's name.
      let proofOfAddress: ComponentOutcome;
      let proofOfAddressDetail: Record<string, unknown> | null = null;
      const poaFile = await fetchDocument(input.proofOfAddressUrl);
      if (typeof poaFile === "string") {
        proofOfAddress = { verdict: "unavailable", reason: poaFile };
      } else {
        try {
          const result = await runDocumentPipeline(
            { documentKind: "proof_of_address", front: poaFile.bytes, expected: { name: input.businessName } },
            { client, ocr: textractOcr(), onError: (stage, error) => console.error(`[kyb] proof of address ${stage} unavailable`, error instanceof Error ? error.message.slice(0, 200) : "unknown") },
          );
          proofOfAddress = { verdict: result.verdict, reason: result.reason };
          proofOfAddressDetail = { verdict: result.verdict, reason: result.reason, flags: result.flags, fields: result.proofOfAddress?.fields ?? null, checks: result.checks, ocr: result.ocr };
        } catch (error) {
          console.error("[kyb] proof of address failed", error instanceof Error ? error.message.slice(0, 200) : "unknown");
          proofOfAddress = { verdict: "unavailable", reason: "The proof of address couldn't be checked automatically." };
        }
      }

      // 3. AML screening of the business and everyone declared.
      const subjects = [
        { subjectName: input.businessName, entityType: "entity" as const, country: input.incorporationCountry, registrationNumber: input.registrationNumber, jurisdiction: input.incorporationCountry },
        ...directors.map((director) => ({
          subjectName: `${director.firstName} ${director.lastName}`.trim(),
          entityType: "individual" as const,
          dateOfBirth: director.dateOfBirth,
          idNumber: director.idNumber,
        })),
      ];
      const outcomes: ScreeningOutcome[] = await ctx.runAction(internalApi.kyb._screenParties, { clientId: args.clientId, subjects });
      const parties: Array<PartyOutcome & { directorId?: Id<"kybDirectors">; outcome: ScreeningOutcome }> = outcomes.map((outcome, index) => ({
        name: subjects[index].subjectName,
        role: index === 0 ? "business" : /owner|ubo|shareholder/i.test(directors[index - 1].position) ? "ubo" : "director",
        verdict: outcome.verdict,
        complete: outcome.complete,
        reason: outcome.reason,
        ...(index > 0 ? { directorId: directors[index - 1]._id } : {}),
        outcome,
      }));

      const decision = decideKyb({ certificate, proofOfAddress, parties });
      await ctx.runMutation(internalApi.kyb._completeAutomated, {
        verificationId: args.verificationId,
        verdict: decision.verdict,
        reason: decision.reason,
        complete: decision.complete,
        result: {
          certificate: { verdict: certificate.verdict, reason: certificate.reason, ...(certificateDetail ?? {}) },
          proofOfAddress: proofOfAddressDetail ?? { verdict: proofOfAddress.verdict, reason: proofOfAddress.reason },
          parties: parties.map((party) => ({
            name: party.name,
            role: party.role,
            verdict: party.verdict,
            complete: party.complete,
            reason: party.reason.slice(0, 1000),
            hits: party.outcome.matches.length,
            suppressed: party.outcome.suppressed.length,
          })),
        },
        parties: parties.map((party) => ({
          name: party.name,
          ...(party.directorId ? { directorId: party.directorId } : {}),
          verdict: party.verdict,
          hits: partyHits(party.outcome),
        })),
      });
    } catch (error) {
      console.error("[kyb] automated checks failed", error instanceof Error ? error.message.slice(0, 300) : "unknown");
      await manual("Business verification needs a person: the automatic checks couldn't finish.");
    }
  },
});
