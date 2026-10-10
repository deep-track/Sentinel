export const dynamic = "force-dynamic";

import { anyApi } from "convex/server";
import { ShieldAlert } from "lucide-react";
import { requireActiveScope } from "@/app/(platform)/_lib/active-client";
import { getConvexErrorCode } from "@/modules/shared/errors";

type MemberRow = {
  _id: string;
  userId: string;
  role: string;
  isActive: boolean;
  createdAt: number;
};

type MembersResult =
  | { kind: "ok"; members: MemberRow[] }
  | { kind: "forbidden" }
  | { kind: "error" };

const ROLE_LABELS: Record<string, string> = {
  client_admin: "Admin",
  compliance_analyst: "Compliance analyst",
  developer: "Developer",
  viewer: "Viewer",
};

export default async function MembersPage() {
  const { client, scope } = await requireActiveScope();

  // memberships.listForClient is restricted to Sentinel internal
  // administrators. Customers get a clear explanation instead of an empty
  // table that suggests the organization has no members.
  let result: MembersResult;
  try {
    const members: MemberRow[] = await client.query(anyApi.memberships.listForClient, { clientId: scope.clientId });
    result = { kind: "ok", members };
  } catch (error) {
    const code = getConvexErrorCode(error);
    if (code === "forbidden" || code === "unauthenticated") {
      result = { kind: "forbidden" };
    } else {
      console.error("[members] Convex query failed", error);
      result = { kind: "error" };
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">Access for {scope.clientName}</p>
      </div>

      {result.kind === "forbidden" ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          <ShieldAlert className="h-5 w-5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Only internal administrators can view members</p>
            <p>
              Member management for {scope.clientName} is handled by the Sentinel team. Contact your
              account manager to add, remove, or change the role of a team member.
            </p>
          </div>
        </div>
      ) : result.kind === "error" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          Members couldn&apos;t be loaded right now. Try again in a moment.
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-3 text-left">User</th>
                <th className="p-3 text-left">Role</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Added</th>
              </tr>
            </thead>
            <tbody>
              {result.members.map((member) => (
                <tr key={member._id} className="border-b last:border-0">
                  <td className="p-3 font-mono">{member.userId}</td>
                  <td className="p-3">{ROLE_LABELS[member.role] ?? member.role}</td>
                  <td className="p-3">{member.isActive ? "Active" : "Inactive"}</td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(member.createdAt).toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
              {result.members.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    No members are assigned to this organization.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
