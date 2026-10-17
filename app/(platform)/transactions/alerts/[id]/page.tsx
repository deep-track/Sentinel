export const dynamic = "force-dynamic";

import { AlertDetail } from "./alert-detail";

export default async function TransactionAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 lg:p-8">
      <AlertDetail alertId={id} />
    </div>
  );
}
