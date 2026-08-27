export const dynamic = "force-dynamic";

import { anyApi } from "convex/server";
import { redirect } from "next/navigation";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";

export default async function MembersPage() {
  const client = await getAuthenticatedConvexClient();
  if (!client) redirect("/access-pending?reason=authorization-unavailable");
  const access = await client.query(anyApi.dashboard.currentAccess, {});
  const scope = access.memberships[0];
  if (!access.authorized || !scope) redirect("/access-pending");
  let members: any[] = [];
  try {
    members = await client.query(anyApi.memberships.listForClient, { clientId: scope.clientId });
  } catch (error) {
    console.error("[members] Convex query failed", error);
  }
  return <div className="p-6 space-y-6"><div><h1 className="text-2xl font-semibold">Members</h1><p className="text-sm text-muted-foreground">Access for {scope.clientName}</p></div><div className="rounded-xl border bg-card overflow-hidden"><table className="w-full text-sm"><thead className="border-b bg-muted/40"><tr><th className="p-3 text-left">User</th><th className="p-3 text-left">Role</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Added</th></tr></thead><tbody>{members.map((member) => <tr key={member._id} className="border-b last:border-0"><td className="p-3 font-mono">{member.userId}</td><td className="p-3">{member.role}</td><td className="p-3">{member.isActive ? "Active" : "Inactive"}</td><td className="p-3 text-muted-foreground">{new Date(member.createdAt).toLocaleDateString()}</td></tr>)}{members.length === 0 ? <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No members are assigned to this client.</td></tr> : null}</tbody></table></div></div>;
}
