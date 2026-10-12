export const dynamic = "force-dynamic";

import { getCurrentUser, isInternalOpsRole } from "@/backend/lib/auth";
import { ReviewQueue } from "./review-queue";

// Global review queue (internal). Reads need an internal role; resolving
// needs an internal role without view_only. Convex enforces both again.
export default async function ReviewQueuePage() {
  const user = await getCurrentUser();
  const canResolve = Boolean(user && isInternalOpsRole(user.role) && !user.viewOnly);
  return <ReviewQueue canResolve={canResolve} />;
}
