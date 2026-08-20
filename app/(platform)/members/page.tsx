// NOTE: this previously loaded company/members/role data via
// getCompanyAction, getCompanyMembersAction, and checkIfCompanyHeadAction
// from actions/organization.ts, which called the old Prisma-backed
// backend. That backend and actions/organization.ts were removed as part
// of the Convex migration. Convex models membership via the
// "clientMembers" table (see convex/schema.ts) but there's no query yet
// to list members for the current user's client, so this page can't load
// real data. Showing an honest unavailable state instead of faking a list.
import EmptyState from "@/components/empty-state";
import { getAuth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function MembersPage() {
	const { userId } = await getAuth();
	if (!userId) redirect("/auth/login");

	return (
		<div className="p-4 min-h-[calc(100vh-2.75rem)] h-full">
			<div className="space-y-4">
				<EmptyState emptyText="Member management is temporarily unavailable while the backend migrates to Convex." />
			</div>
		</div>
	);
}
