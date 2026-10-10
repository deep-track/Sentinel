import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClientDate } from "@/components/client-date";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type RecentVerification = {
  id: string;
  caseId: string;
  type: string;
  subjectName: string | null;
  status: string;
  sentinelScore: number | null;
  createdAt: number;
};

function verdictVariant(status: string) {
  switch (status) {
    case "APPROVED":
      return "success" as const;
    case "REJECTED":
    case "FAILED":
      return "destructive" as const;
    case "PENDING_REVIEW":
    case "ESCALATED":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

const STATUS_LABELS: Record<string, string> = {
  APPROVED: "approved",
  REJECTED: "rejected",
  PENDING_REVIEW: "needs review",
  FAILED: "failed",
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
};

const TYPE_LABELS: Record<string, string> = {
  idp: "KYC",
  kyb: "KYB",
  kyi: "KYI",
  aml: "AML",
  liveness: "Liveness",
};

// The backend's `confidence` is a hard-coded 0/1 (or a fixed 0.8) for most
// verification types, so it isn't shown as a score — the verdict is the
// meaningful signal.
export function RecentVerificationsTable({ data }: { data: RecentVerification[] }) {
  return (
    <Card className="bg-card border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-medium text-foreground">
          Recent verifications
        </span>
      </div>
      {data.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">No verifications in this period.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="text-muted-foreground font-mono text-xs">{v.caseId}</TableCell>
                <TableCell>
                  <Badge variant="outline">{TYPE_LABELS[v.type] ?? v.type}</Badge>
                </TableCell>
                <TableCell className="text-foreground">
                  {v.subjectName ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={verdictVariant(v.status)}>
                    {STATUS_LABELS[v.status] ?? v.status.toLowerCase().replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <ClientDate value={v.createdAt} format="MMM d, HH:mm" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
