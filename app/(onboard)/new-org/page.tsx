import { getCurrentUser } from "@/backend/lib/auth";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import CreateOrganization from "@/modules/organization/create-organization";
import { anyApi } from "convex/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function hasWorkspaceAccess() {
	const client = await getAuthenticatedConvexClient();
	if (!client) return false;
	try {
		const access = await client.query(anyApi.watchlists.currentAccess, {});
		return Boolean(access?.authorized);
	} catch (error) {
		console.error("[new-org] access query failed", error);
		return false;
	}
}

// Self-serve organization creation is not available under the Convex data
// model yet. Users who already have a workspace (or are internal admins) go
// straight to the dashboard; everyone else sees the unavailable notice.
export default async function NewOrg() {
	const user = await getCurrentUser();
	if (!user) redirect("/auth/login");

	if (await hasWorkspaceAccess()) redirect("/dashboard");

	return (
		<div className="min-h-screen w-full flex items-center justify-center">
			<CreateOrganization userId={user.id} />
		</div>
	);
}
