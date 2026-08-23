import { Card } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";

export const dynamic = "force-dynamic";

function formatDate(value: number) {
  return new Date(value).toLocaleString();
}

export default async function ScreeningMonitoringPage() {
  const client = await getAuthenticatedConvexClient();
  const data = client
    ? await client.query(api.monitoring.overview, { windowMs: 7 * 24 * 60 * 60 * 1000, limit: 25 }).catch(() => null)
    : null;

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AML Screening Monitor</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Review queue health and screening audit activity for the last seven days
        </p>
      </div>

      {!data ? (
        <Card className="p-6 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            Monitoring data is unavailable. Confirm that the internal Auth0 session and Convex production configuration are available.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            {[
              ["Pending review", data.reviewCounts.pending],
              ["In review", data.reviewCounts.inReview],
              ["High priority", data.reviewCounts.highPriority],
              ["Screening failures", data.screeningCounts.failed],
            ].map(([label, value]) => (
              <Card key={label} className="p-5">
                <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
                <p className="text-3xl font-semibold text-slate-900 dark:text-white mt-2">{value}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <h2 className="font-semibold text-slate-900 dark:text-white">Screening outcomes</h2>
              <div className="grid grid-cols-4 gap-3 mt-5 text-center">
                {[
                  ["Screened", data.screeningCounts.screened],
                  ["Pass", data.screeningCounts.pass],
                  ["Review", data.screeningCounts.review],
                  ["Reject", data.screeningCounts.reject],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-xl font-semibold mt-1">{value}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="font-semibold text-slate-900 dark:text-white">Review status</h2>
              <div className="grid grid-cols-3 gap-3 mt-5 text-center">
                {[
                  ["Pending", data.reviewCounts.pending],
                  ["In review", data.reviewCounts.inReview],
                  ["Resolved", data.reviewCounts.resolved],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-xl font-semibold mt-1">{value}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="p-6 overflow-x-auto">
            <h2 className="font-semibold text-slate-900 dark:text-white mb-4">Weekly compliance reports</h2>
            {data.recentReports.length === 0 ? (
              <p className="text-sm text-slate-500">No weekly reports have been generated yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
                    <th className="py-3 pr-4">Generated</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Verifications</th>
                    <th className="py-3 pr-4">AML outcomes</th>
                    <th className="py-3 pr-4">Export hash</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentReports.map((report) => (
                    <tr key={report._id} className="border-b last:border-0">
                      <td className="py-3 pr-4 whitespace-nowrap">{formatDate(report.generatedAt)}</td>
                      <td className="py-3 pr-4 font-medium">{report.status}</td>
                      <td className="py-3 pr-4">{report.verificationCount}</td>
                      <td className="py-3 pr-4">{report.passCount} pass · {report.reviewCount} review · {report.rejectCount} reject</td>
                      <td className="py-3 pr-4 font-mono text-xs">{report.exportHash ? `${report.exportHash.slice(0, 16)}…` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-6 overflow-x-auto">
            <h2 className="font-semibold text-slate-900 dark:text-white mb-4">Recent screening audit events</h2>
            {data.auditEvents.length === 0 ? (
              <p className="text-sm text-slate-500">No AML screening events in the selected window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
                    <th className="py-3 pr-4">Time</th>
                    <th className="py-3 pr-4">Action</th>
                    <th className="py-3 pr-4">Target</th>
                    <th className="py-3 pr-4">Verdict / detail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.auditEvents.map((event) => {
                    const metadata = event.metadata as { verdict?: string; matchCount?: number; reason?: string } | undefined;
                    return (
                      <tr key={event._id} className="border-b last:border-0">
                        <td className="py-3 pr-4 whitespace-nowrap">{formatDate(event.timestamp)}</td>
                        <td className="py-3 pr-4 font-medium">{event.action}</td>
                        <td className="py-3 pr-4 font-mono text-xs">{event.targetId}</td>
                        <td className="py-3 pr-4">{metadata?.verdict ?? metadata?.reason ?? "—"}{metadata?.matchCount !== undefined ? ` · ${metadata.matchCount} matches` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="p-6 overflow-x-auto">
            <h2 className="font-semibold text-slate-900 dark:text-white mb-4">Review queue</h2>
            {data.reviews.length === 0 ? (
              <p className="text-sm text-slate-500">No review items in the selected window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
                    <th className="py-3 pr-4">Created</th>
                    <th className="py-3 pr-4">Priority</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reviews.map((review) => (
                    <tr key={review._id} className="border-b last:border-0">
                      <td className="py-3 pr-4 whitespace-nowrap">{formatDate(review.createdAt)}</td>
                      <td className="py-3 pr-4 font-medium">{review.priority}</td>
                      <td className="py-3 pr-4">{review.status}</td>
                      <td className="py-3 pr-4">{review.triggerReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
