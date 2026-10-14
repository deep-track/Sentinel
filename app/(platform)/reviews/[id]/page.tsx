export const dynamic = "force-dynamic";

import { ReviewCase } from "./review-case";

export default async function ReviewCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-5xl mx-auto">
      <ReviewCase reviewId={id} />
    </div>
  );
}
