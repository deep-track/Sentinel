"use node";

import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { DetectDocumentTextCommand, TextractClient } from "@aws-sdk/client-textract";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { decodeBase64, DocumentPipelineError, runDocumentPipeline, type OcrProvider } from "./lib/documentPipeline";
import { DocumentVisionError } from "./lib/documentVision";
import { c2paConfigFromEnv, lookupContentCredentials } from "./lib/c2paResolution";

// IDP pipeline action (Node runtime for the AWS SDK). Reads the document with
// Claude, cross-checks it with Amazon Textract OCR when AWS is configured,
// runs the forensic and rule checks, and stores the result.
//
// Convex environment:
//   ANTHROPIC_API_KEY                         required
//   AWS_TEXTRACT_REGION (or AWS_REGION),
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  optional; without them the OCR
//                                             cross-check is reported as not configured
//   C2PA_RESOLUTION_URL                       optional: a C2PA Soft Binding Resolution
//                                             API (e.g. https://c2pa.trufo.ai/v1)
//   C2PA_TOKEN_URL, C2PA_CLIENT_ID,
//   C2PA_CLIENT_SECRET, C2PA_SCOPE, C2PA_ALG  optional: OAuth client credentials and
//                                             the soft binding algorithm, if the service needs them

const internalApi: any = internal;

function textractOcr(): OcrProvider | null {
  const region = process.env.AWS_TEXTRACT_REGION?.trim() || process.env.AWS_REGION?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!region || !accessKeyId || !secretAccessKey) return null;
  const client = new TextractClient({ region, credentials: { accessKeyId, secretAccessKey } });
  return async (bytes) => {
    // Synchronous Textract reads JPEG, PNG and single-page PDF up to 10 MB.
    const output = await client.send(new DetectDocumentTextCommand({ Document: { Bytes: bytes } }));
    const lines = (output.Blocks ?? []).filter((block) => block.BlockType === "LINE" && block.Text);
    const confidences = lines.map((line) => line.Confidence ?? 0);
    return {
      provider: "aws_textract",
      text: lines.map((line) => line.Text).join("\n"),
      averageConfidence: confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : null,
      lineCount: lines.length,
    };
  };
}

export const processDocument = internalAction({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    documentKind: v.union(v.literal("identity"), v.literal("proof_of_address")),
    documentFrontBase64: v.string(),
    documentBackBase64: v.optional(v.string()),
    expectedName: v.optional(v.string()),
    expectedAddress: v.optional(v.string()),
    expectedDateOfBirth: v.optional(v.string()),
    maxDocumentAgeDays: v.optional(v.number()),
    resized: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalApi.verifications._markProcessing, { id: args.verificationId });
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const fail = async (reason: string, detail: string) => {
      // No document data in the log line.
      console.error("[IDP] document verification failed", detail.slice(0, 300));
      await ctx.runMutation(internalApi.verifications._fail, { id: args.verificationId, reason, notifyWebhook: true });
      await ctx.runMutation(internalApi.auditLog._log, {
        actorId: "system",
        actorType: "system",
        action: "document.verification_failed",
        targetType: "verification",
        targetId: args.verificationId,
        clientId: args.clientId,
        metadata: { reason: detail.slice(0, 500) },
      });
    };
    if (!apiKey) {
      await fail("Document verification is not configured.", "ANTHROPIC_API_KEY is not set");
      return;
    }
    try {
      const result = await runDocumentPipeline(
        {
          documentKind: args.documentKind,
          front: decodeBase64(args.documentFrontBase64),
          back: args.documentBackBase64 ? decodeBase64(args.documentBackBase64) : undefined,
          expected: { name: args.expectedName, address: args.expectedAddress, dateOfBirth: args.expectedDateOfBirth },
          maxDocumentAgeDays: args.maxDocumentAgeDays,
          resized: args.resized,
        },
        {
          client: new Anthropic({ apiKey }),
          ocr: textractOcr(),
          contentCredentials: (() => {
            const config = c2paConfigFromEnv(process.env);
            return config
              ? (bytes: Uint8Array, mediaType: string) =>
                  lookupContentCredentials(config, bytes, mediaType, {
                    onError: (error) => console.error("[IDP] C2PA lookup problem", error instanceof Error ? error.message.slice(0, 200) : "unknown"),
                  })
              : null;
          })(),
          onError: (stage, error) => console.error(`[IDP] ${stage} unavailable`, error instanceof Error ? error.message.slice(0, 200) : "unknown"),
        },
      );
      const { verdict, riskScore, reason, ...rest } = result;
      await ctx.runMutation(internalApi.documents._complete, {
        verificationId: args.verificationId,
        verdict,
        riskScore,
        reason,
        chargeCredits: true,
        result: rest,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const clientReason =
        error instanceof DocumentPipelineError
          ? message
          : error instanceof DocumentVisionError
            ? "The document could not be read. Try a clearer, uncropped image."
            : "Document verification is temporarily unavailable; please retry.";
      await fail(clientReason, message);
    }
  },
});
