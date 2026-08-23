import { findUser } from "@/backend/actions/auth-actions";
import ApiKeysTable from "@/app/(platform)/api-keys/api-keys-table";
import { getAuth } from "@/backend/lib/auth";
import { redirect } from "next/navigation";
import CreateApiKeyForm from "./create-api-key-form";

// NOTE: getUserApiKeys previously came from actions/api-keys.ts, which
// was removed as part of the Convex backend migration. There is no
// public Convex query yet that lists API keys, so this page shows an
// empty list until one exists.

export default async function ApiKeysPage() {
	const { userId } = await getAuth();
	if (!userId) return redirect("/auth/login");

	const dbUser = await findUser(userId);

	if (!dbUser) return redirect("/new-user");

	const apiKeys: import("@/backend/lib/types/api-keys").APIKey[] = [];

	return (
		<div className="space-y-4 p-6">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">
					API key listing is temporarily unavailable while the backend
					migrates to Convex.
				</p>
				<CreateApiKeyForm userId={userId} companyId="" />
			</div>
			<ApiKeysTable apiKeys={apiKeys} />
		</div>
	);
}