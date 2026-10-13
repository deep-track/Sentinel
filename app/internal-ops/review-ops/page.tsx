import { ReviewOperations } from "./review-operations";

// Back Office review operations. Access is enforced by
// app/internal-ops/layout.tsx and again in Convex (backOfficeReviews).
export default function ReviewOperationsPage() {
  return <ReviewOperations />;
}
