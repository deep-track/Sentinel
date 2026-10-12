export const dynamic = "force-dynamic";

import { getCurrentUser, isInternalOpsRole } from "@/backend/lib/auth";
import { ReviewItem } from "./review-item";

// One review-queue item: the verification result and the resolution form.
// Resolving needs an internal role without view_only; Convex enforces it
// again in reviewQueue.resolve.
export default async function ReviewItemPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const [user, { reviewId }] = await Promise.all([getCurrentUser(), params]);
  const canResolve = Boolean(user && isInternalOpsRole(user.role) && !user.viewOnly);
  return <ReviewItem reviewId={reviewId} canResolve={canResolve} />;
}
