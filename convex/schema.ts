import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  notes: defineTable({
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    created_at: v.number(),
  }).index("by_user", ["userId"]),

  // ── Sentinel Phase 1 ──────────────────────────────────────
  clients: defineTable({
    name: v.string(),
    plan: v.union(
      v.literal("trial"),
      v.literal("starter"),
      v.literal("growth"),
      v.literal("enterprise"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("suspended"),
      v.literal("trial_expired"),
    ),
    creditLimit: v.number(), // guardrail on allocation, not a live balance
    rpmCap: v.number(),      // Section 10.3: 60 Starter / 200 Growth / 1000 Enterprise
    creditThresholdPct: v.number(), // Section 1.1 — default 80, alert fires above this
    webhookUrl: v.optional(v.string()),
    webhookSecret: v.optional(v.string()), // used to HMAC-sign outbound payloads — never returned in reads
    createdAt: v.number(),
  }),

  apiKeys: defineTable({
    clientId: v.id("clients"),
    prefix: v.string(),      // shown in dashboard, e.g. "snt_live_9f2a"
    hashedKey: v.string(),   // sha256 hex of the full raw key — raw key never stored
    environment: v.union(v.literal("live"), v.literal("test")),
    revoked: v.boolean(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_prefix", ["prefix"])
    .index("by_client", ["clientId"]),

  verifications: defineTable({
    clientId: v.id("clients"),
    type: v.union(
      v.literal("idp"),
      v.literal("kyb"),
      v.literal("aml"),
      v.literal("liveness"),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      // Section 1.5 of the Platform Spec — one of the four review
      // actions is "Request Resubmission", distinct from a hard
      // failure: the applicant needs to redo a step, not start over.
      v.literal("resubmission_requested"),
    ),
    verdict: v.optional(
      v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
    ),
    confidence: v.optional(v.number()), // 0-1
    creditsUsed: v.number(),
    // Refs to already-uploaded blobs (Convex storage id / S3 key), NOT
    // raw image bytes — keeps PII out of this row and any DB export.
    input: v.any(),
    result: v.optional(v.any()), // raw provider result payload, for audit
    reference: v.string(),       // client-facing id, e.g. "gt_..."
    failureReason: v.optional(v.string()),
    disputeReason: v.optional(v.string()), // Section 11.1 — client-initiated dispute
    disputedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_client", ["clientId"])
    .index("by_reference", ["reference"])
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_client_and_type", ["clientId", "type"]),

  // Immutable — never patch a balance. Every movement is a new row;
  // balance is always derived by summing this table for a client.
  creditLedger: defineTable({
    clientId: v.id("clients"),
    verificationId: v.optional(v.id("verifications")),
    type: v.union(
      v.literal("allocation"),
      v.literal("deduction"),
      v.literal("refund"),
      v.literal("adjustment"),
    ),
    amount: v.number(), // positive = added, negative = consumed
    reason: v.string(),
    createdAt: v.number(),
  }).index("by_client", ["clientId"]),

  // Phase 3 — table exists now so relations are valid; write path (AML
  // screening + watchlist ingestion crons) isn't built yet.
  flaggedEntities: defineTable({
    entityName: v.string(),
    source: v.union(
      v.literal("OFAC_SDN"),
      v.literal("UN_CONSOLIDATED"),
      v.literal("FBI_MOST_WANTED"),
    ),
    program: v.string(),
    matchScore: v.number(), // 0-100
    clientId: v.id("clients"),
    verificationId: v.id("verifications"),
    riskLevel: v.union(v.literal("critical"), v.literal("high")),
    matchedCountry: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_verification", ["verificationId"]),

  // Phase 4
  reviewQueue: defineTable({
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
    // Section 11.2 (engineering doc) — queue sort order is client
    // disputes first, then auto-escalated, then internal flags.
    triggerType: v.union(
      v.literal("client_dispute"),
      v.literal("auto_escalation"),
      v.literal("internal_flag"),
    ),
    triggerReason: v.string(),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
    status: v.union(
      v.literal("pending"),
      v.literal("in_review"),
      v.literal("resolved"),
    ),
    assignedTo: v.optional(v.string()),
    // Platform Spec Section 1.5 — the four actions a Compliance
    // Analyst can take. Reject and Escalate require notes (spec:
    // "reason must be logged for audit trail") — enforced in
    // reviewQueue.ts, not at the schema level.
    resolutionAction: v.optional(
      v.union(
        v.literal("approve"),
        v.literal("reject"),
        v.literal("escalate"),
        v.literal("request_resubmission"),
      ),
    ),
    resolutionNotes: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    // Escalated cases go to a separate Escalation Queue visible only
    // to Client Admin (Section 1.5) — modeled here as a flag rather
    // than a new table for now, since it's still fundamentally the
    // same record awaiting a second sign-off.
    escalated: v.optional(v.boolean()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_verification", ["verificationId"]),

  // Phase 4
  feedbackLabels: defineTable({
    verificationId: v.id("verifications"),
    label: v.union(
      v.literal("false_accept"),
      v.literal("false_reject"),
      v.literal("confirmed_correct"),
    ),
    labeledBy: v.string(),
    // Section 10.4 — reviewers must never confirm below 80% certainty;
    // enforced in reviewQueue.ts mutation, stored here for the audit trail.
    certaintyPct: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_verification", ["verificationId"]),

  // Section 10.4 — INSERT-only at the app layer. True enforcement (no
  // UPDATE/DELETE at all) is a DB-role grant Denzel owns at the Postgres/
  // Convex-infra level; this table + auditLog.ts's lack of any patch/delete
  // export is the application-layer half of that guarantee.
  auditLog: defineTable({
    actorId: v.string(),      // Convex Auth userId, or api_key_id for client-driven events
    actorType: v.union(v.literal("internal_admin"), v.literal("reviewer"), v.literal("client_api_key"), v.literal("system")),
    action: v.string(),       // e.g. "verification.created", "client.suspended", "review.confirmed"
    targetType: v.string(),   // e.g. "verification", "client", "apiKey"
    targetId: v.string(),
    clientId: v.optional(v.id("clients")), // scopes the event to a tenant when applicable
    ipAddress: v.optional(v.string()),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_target", ["targetType", "targetId"]),

  // Section 12.1 — webhook delivery log with signed HMAC-SHA256 payloads
  // and a manual test-send action. Retry policy fields are structured so
  // whatever backoff schedule Brian confirms (Section 8.4 open item)
  // drops in as config, not a rewrite.
  webhookDeliveries: defineTable({
    clientId: v.id("clients"),
    verificationId: v.id("verifications"),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("retrying"),
      v.literal("failed"),
    ),
    attemptCount: v.number(),
    lastAttemptAt: v.optional(v.number()),
    nextRetryAt: v.optional(v.number()),
    lastResponseStatus: v.optional(v.number()),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_status_and_retry", ["status", "nextRetryAt"]),
});