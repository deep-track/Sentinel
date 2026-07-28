// app/(platform)/dashboard/_components/recent-verifications-table.tsx
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Verification = {
  id: string;
  caseId: string;
  type: string;
  subjectName: string | null;
  status: string;
  sentinelScore: number | null;
  createdAt: string | Date;
};

function verdictVariant(status: string) {
  switch (status) {
    case "APPROVED":
      return "success" as const;
    case "REJECTED":
      return "destructive" as const;
    case "PENDING_REVIEW":
    case "ESCALATED":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function RecentVerificationsTable({ data }: { data: Verification[] }) {
  return (
    <Card className="bg-card border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-sm font-medium text-foreground">
          Recent verifications
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case ID</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Verdict</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Submitted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((v) => (
            <TableRow key={v.id}>
              <TableCell className="text-muted-foreground">{v.caseId}</TableCell>
              <TableCell>
                <Badge variant="outline">{v.type}</Badge>
              </TableCell>
              <TableCell className="text-foreground">
                {v.subjectName ?? "—"}
              </TableCell>
              <TableCell>
                <Badge variant={verdictVariant(v.status)}>
                  {v.status.toLowerCase().replace("_", " ")}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {v.sentinelScore != null ? `${v.sentinelScore.toFixed(1)}%` : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(v.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}