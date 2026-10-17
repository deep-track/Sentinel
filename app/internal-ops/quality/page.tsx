import { ModelQuality } from "./model-quality";

// Back Office model and data quality. Access is enforced by
// app/internal-ops/layout.tsx and again in Convex (backOfficeQuality.quality).
export default function QualityPage() {
  return <ModelQuality />;
}
