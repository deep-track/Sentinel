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

  // Sentinel Phase 1
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
    creditLimit: v.number(), 
    rpmCap: v.number(),     
    creditThresholdPct: v.number(), 
    webhookUrl: v.optional(v.string()),
    webhookSecret: v.optional(v.string()), 
    createdAt: v.number(),
  }),

  apiKeys: defineTable({
    clientId: v.id("clients"),
    prefix: v.string(),      
    hashedKey: v.string(), 
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

      // Request Resubmission
      v.literal("resubmission_requested"),
    ),
    verdict: v.optional(
      v.union(v.literal("pass"), v.literal("review"), v.literal("reject")),
    ),
    confidence: v.optional(v.number()), // 0-1
    creditsUsed: v.number(),
    // raw image bytes
    input: v.any(),
    result: v.optional(v.any()), 
    reference: v.string(),       
    failureReason: v.optional(v.string()),
    disputeReason: v.optional(v.string()), 
    disputedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_client", ["clientId"])
    .index("by_reference", ["reference"])
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_client_and_type", ["clientId", "type"]),

  creditLedger: defineTable({
    clientId: v.id("clients"),
    verificationId: v.optional(v.id("verifications")),
    type: v.union(
      v.literal("allocation"),
      v.literal("deduction"),
      v.literal("refund"),
      v.literal("adjustment"),
    ),
    amount: v.number(), 
    reason: v.string(),
    createdAt: v.number(),
  }).index("by_client", ["clientId"]),


  // screening + watchlist ingestion 
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

  
  reviewQueue: defineTable({
    verificationId: v.id("verifications"),
    clientId: v.id("clients"),
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
    // reviewQueue
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
    escalated: v.optional(v.boolean()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_verification", ["verificationId"]),


  feedbackLabels: defineTable({
    verificationId: v.id("verifications"),
    label: v.union(
      v.literal("false_accept"),
      v.literal("false_reject"),
      v.literal("confirmed_correct"),
    ),
    labeledBy: v.string(),
    certaintyPct: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_verification", ["verificationId"]),

  auditLog: defineTable({
    actorId: v.string(),      // Convex Auth userId, or api_key_id for client-driven events
    actorType: v.union(v.literal("internal_admin"), v.literal("reviewer"), v.literal("client_api_key"), v.literal("system")),
    action: v.string(),       
    targetType: v.string(),  
    targetId: v.string(),
    clientId: v.optional(v.id("clients")), 
    ipAddress: v.optional(v.string()),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_target", ["targetType", "targetId"]),

  // webhook delivery
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