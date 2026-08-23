import { addNewUser, findUser } from "@/backend/actions/auth-actions";
import { getCurrentUser } from "@/backend/lib/auth";
import CreateOrganization from "@/modules/organization/create-organization";
import { redirect } from "next/navigation";
import React from "react";

export default async function NewOrg() {
	const user = await getCurrentUser();
	if (!user) return redirect("/auth/login");

	if (user.role !== "head") redirect("/new-user");

	const dbUser = await findUser(user.id);
	if (!dbUser) {
		const addResult = await addNewUser({
			userId: user.id,
			email: user.email,
			fullName: user.fullName,
			role: user.role,
		});

		if (!addResult.success) {
			console.warn(`new-org addNewUser skipped: ${addResult.error ?? "unknown error"}`);
		}
	}

	// NOTE: this used to check getOrganizationByUser (actions/organization.ts)
	// and redirect to /dashboard if the user already had one. That action was
	// removed as part of the Convex migration and there is no Convex
	// equivalent yet, so we can no longer tell whether the user already
	// belongs to a client org. Always falling through to the (currently
	// unavailable) create-org form rather than guessing.

	return (
		<div className="min-h-screen w-full flex items-center justify-center">
			<CreateOrganization userId={user.id} />
		</div>
	);
}
