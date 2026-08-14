import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticateApiKey } from "./apiKeys";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

http.route({
  path: "/v1/verify/idp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateApiKey(
      { runQuery: ctx.runQuery, runMutation: ctx.runMutation },
      request.headers.get("Authorization"),
    );
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    let body: {
      livenessFramesBase64?: string;
      livenessMediaType?: "jpeg_frames" | "mp4";
      documentFrontBase64?: string;
      documentBackBase64?: string;
      idNumber?: string;
      firstName?: string;
      lastName?: string;
      dateOfBirth?: string;
      gender?: string;
    };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const required = [
      "livenessFramesBase64",
      "livenessMediaType",
      "documentFrontBase64",
      "idNumber",
      "firstName",
      "lastName",
      "dateOfBirth",
      "gender",
    ] as const;
    const missing = required.filter((k) => !body[k]);
    if (missing.length > 0) {
      return json({ error: `Missing required fields: ${missing.join(", ")}` }, 400);
    }


    const balance = await ctx.runQuery(internal.creditLedger._getBalance, {
      clientId: auth.clientId,
    });
    const IDP_CREDIT_COST = 1;
    if (balance < IDP_CREDIT_COST) {
      return json({ error: "Insufficient credits" }, 402);
    }

    const { id, reference } = await ctx.runMutation(internal.verifications._create, {
      clientId: auth.clientId,
      type: "idp",
      creditsUsed: IDP_CREDIT_COST,
      input: {
        idNumber: body.idNumber,
        firstName: body.firstName,
        lastName: body.lastName,
      },
    });

    await ctx.scheduler.runAfter(0, internal.idp.processIdpVerification, {
      verificationId: id,
      clientId: auth.clientId,
      livenessFramesBase64: body.livenessFramesBase64!,
      livenessMediaType: body.livenessMediaType!,
      documentFrontBase64: body.documentFrontBase64!,
      documentBackBase64: body.documentBackBase64,
      idNumber: body.idNumber!,
      firstName: body.firstName!,
      lastName: body.lastName!,
      dateOfBirth: body.dateOfBirth!,
      gender: body.gender!,
    });

    return json(
      { id: reference, type: "idp", status: "queued" },
      202,
    );
  }),
});

http.route({
  pathPrefix: "/v1/verify/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticateApiKey(
      { runQuery: ctx.runQuery, runMutation: ctx.runMutation },
      request.headers.get("Authorization"),
    );
    if (!auth.ok) {
      return json({ error: auth.error }, auth.status);
    }

    const url = new URL(request.url);
    const reference = url.pathname.split("/").pop();
    if (!reference) {
      return json({ error: "Missing verification id" }, 400);
    }

    // Auth.clientId;a client can only ever fetch its own
    const record = await ctx.runQuery(internal.verifications._getByReferenceForClient, {
      reference,
      clientId: auth.clientId,
    });

    if (!record) {
      return json({ error: "Verification not found" }, 404);
    }

    return json({
      id: record.reference,
      type: record.type,
      status: record.status,
      verdict: record.verdict ?? null,
      confidence: record.confidence ?? null,
      createdAt: record.createdAt,
      completedAt: record.completedAt ?? null,
      failureReason: record.failureReason ?? null,
    });
  }),
});

export default http;