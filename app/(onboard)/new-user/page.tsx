import { addNewUser, findUser } from "@/backend/actions/auth-actions";
import { TypographyMuted } from "@/components/ui/typography";
import { getCurrentUser } from "@/backend/lib/auth";
import { Loader } from "lucide-react";
import { redirect } from "next/navigation";
import React from "react";

export default async function NewUser() {
	// First, check if user is authenticated
	const authUser = await getCurrentUser();
	if (!authUser) {
		redirect("/auth/login");
	}

	// Then check if user exists in our database
	const user = await findUser(authUser.id);
	
	// If user doesn't exist, create them first
	if (!user) {
		const result = await addNewUser({
			userId: authUser.id,
			email: authUser.email,
			fullName: authUser.email?.split("@")[0] || "User",
			role: "user",
		});

		if (!result.success) {
			console.warn(`new-user addNewUser skipped: ${result.error ?? "unknown error"}`);
		}
	}

	// Single redirect for both cases
	redirect("/dashboard");

	// This return statement will never be reached due to the redirect
	// but is required for TypeScript to recognize this as a valid React component
	return (
		<div className="min-h-screen flex flex-col items-center justify-center gap-8">
			<Loader className="size-32 animate-spin text-muted-foreground" />
			<TypographyMuted className="animate-bounce text-lg">
				Checking Access Levels
			</TypographyMuted>
		</div>
	);
}
