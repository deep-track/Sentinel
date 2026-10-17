"use node";

import { v } from "convex/values";
import {
  CompareFacesCommand,
  CreateCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
  SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  assessDuplicates,
  collectionIdFor,
  DUPLICATE_FACE_SIMILARITY,
  FACE_MATCH_MESSAGES,
  faceMatchOutcome,
  firstJpeg,
  isRekognitionImage,
  type FaceMatchResult,
} from "./lib/faceMatch";

// Face match for KYC with Amazon Rekognition (lib/faceMatch.ts). Env:
//   AWS_REKOGNITION_REGION (or AWS_REGION, or AWS_TEXTRACT_REGION), AWS_ACCESS_KEY_ID,
//   AWS_SECRET_ACCESS_KEY. The IAM user needs rekognition:CompareFaces and,
//   for duplicate faces, CreateCollection, SearchFacesByImage, IndexFaces
//   and DeleteFaces. Without them face match is skipped.

const internalApi: any = internal;

function rekognition(): RekognitionClient | null {
  const region = process.env.AWS_REKOGNITION_REGION?.trim() || process.env.AWS_REGION?.trim() || process.env.AWS_TEXTRACT_REGION?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (!region || !accessKeyId || !secretAccessKey) return null;
  return new RekognitionClient({ region, credentials: { accessKeyId, secretAccessKey } });
}

function decode(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64"));
}

const errorName = (error: unknown) => (error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "");

export type FaceMatchStep = FaceMatchResult | { status: "not_configured" } | { status: "skipped"; reason: string } | { error: "face_match_unavailable" };

export const run = internalAction({
  args: {
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    selfieBase64: v.optional(v.string()),
    livenessFramesBase64: v.optional(v.string()),
    documentFrontBase64: v.string(),
    idNumber: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<FaceMatchStep> => {
    const settings: { faceMatch: boolean; duplicateFaceSearch: boolean } = await ctx.runQuery(internalApi.faceMatch.settingsFor, { clientId: args.clientId });
    if (!settings.faceMatch) return { status: "skipped", reason: "Face match is turned off in your screening settings." };
    const client = rekognition();
    if (!client) return { status: "not_configured" };

    let probe: Uint8Array | null = null;
    let probeKind: FaceMatchResult["probe"] = "selfie";
    if (args.selfieBase64?.trim()) probe = decode(args.selfieBase64);
    else if (args.livenessFramesBase64?.trim()) {
      probe = firstJpeg(decode(args.livenessFramesBase64));
      probeKind = "liveness_frame";
    }
    const document = decode(args.documentFrontBase64);
    if (!probe || !isRekognitionImage(probe)) return { status: "skipped", reason: "No selfie or liveness photo in a format face match reads (JPEG or PNG up to 5 MB)." };
    if (!isRekognitionImage(document)) return { status: "skipped", reason: "The ID image isn't a JPEG or PNG up to 5 MB." };

    try {
      let probeFace = true;
      let documentFace = false;
      let similarity: number | null = null;
      try {
        const compared = await client.send(new CompareFacesCommand({ SourceImage: { Bytes: probe }, TargetImage: { Bytes: document }, SimilarityThreshold: 0, QualityFilter: "AUTO" }));
        const best = Math.max(0, ...(compared.FaceMatches ?? []).map((match) => match.Similarity ?? 0));
        documentFace = Boolean(compared.FaceMatches?.length || compared.UnmatchedFaces?.length);
        similarity = documentFace ? Math.round(best * 10) / 10 : null;
      } catch (error) {
        // No face in the selfie: Rekognition refuses the source image.
        if (errorName(error) !== "InvalidParameterException") throw error;
        probeFace = false;
      }
      const outcome = faceMatchOutcome({ probeFace, documentFace, similarity });

      let duplicates: FaceMatchResult["duplicates"] = [];
      if (settings.duplicateFaceSearch && probeFace) {
        const collectionId = collectionIdFor(args.clientId);
        try {
          await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
        } catch (error) {
          if (errorName(error) !== "ResourceAlreadyExistsException") throw error;
        }
        const found = await client.send(new SearchFacesByImageCommand({ CollectionId: collectionId, Image: { Bytes: probe }, FaceMatchThreshold: DUPLICATE_FACE_SIMILARITY, MaxFaces: 10, QualityFilter: "AUTO" }));
        const matches = (found.FaceMatches ?? []).flatMap((match) =>
          match.Face?.ExternalImageId && match.Face.ExternalImageId !== args.verificationId ? [{ verificationId: match.Face.ExternalImageId, similarity: match.Similarity ?? 0 }] : [],
        );
        if (matches.length) {
          const identities: Array<{ verificationId: string; reference: string; idNumber: string | null; name: string | null; createdAt: number }> = await ctx.runQuery(internalApi.faceMatch.identities, {
            clientId: args.clientId,
            verificationIds: [...new Set(matches.map((match) => match.verificationId))],
          });
          const byId = new Map(identities.map((identity) => [identity.verificationId, identity]));
          duplicates = assessDuplicates(
            { idNumber: args.idNumber, name: args.name },
            matches.flatMap((match) => {
              const identity = byId.get(match.verificationId);
              return identity ? [{ ...identity, similarity: match.similarity }] : [];
            }),
          );
        }
        const indexed = await client.send(new IndexFacesCommand({ CollectionId: collectionId, Image: { Bytes: probe }, ExternalImageId: args.verificationId, MaxFaces: 1, QualityFilter: "AUTO" }));
        const faceId = indexed.FaceRecords?.[0]?.Face?.FaceId;
        if (faceId) await ctx.runMutation(internalApi.faceMatch.recordFace, { verificationId: args.verificationId, clientId: args.clientId, collectionId, faceId });
      }

      return { status: "completed", probe: probeKind, outcome, similarity, message: FACE_MATCH_MESSAGES[outcome], duplicateSearch: settings.duplicateFaceSearch, duplicates };
    } catch (error) {
      const name = errorName(error);
      // Keys without Rekognition permissions: face match isn't set up yet,
      // which shouldn't hold every check for review.
      if (name === "AccessDeniedException" || name === "UnrecognizedClientException") {
        console.error("[faceMatch] Rekognition not permitted for these AWS keys", name);
        return { status: "not_configured" };
      }
      console.error("[faceMatch] Rekognition failed", args.verificationId, name);
      return { error: "face_match_unavailable" };
    }
  },
});

// Removes faces from a client's collection (retention purge).
export const deleteFaces = internalAction({
  args: { collectionId: v.string(), faceIds: v.array(v.string()) },
  handler: async (_ctx, args) => {
    const client = rekognition();
    if (!client || !args.faceIds.length) return;
    await client.send(new DeleteFacesCommand({ CollectionId: args.collectionId, FaceIds: args.faceIds }));
  },
});
