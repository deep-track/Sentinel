// NOTE: this used to post to createCompanyAction from actions/organization.ts,
// which called the old DEEPTRACK_BACKEND_URL Node/Prisma backend. That backend
// and actions/organization.ts were removed as part of the Convex migration.
// The Convex schema (convex/schema.ts) models tenants as "clients" +
// "clientMembers" rather than "organizations", and there is no Convex
// mutation yet for self-serve client creation, so this form has nothing to
// submit to. Showing an honest unavailable state instead of a dead form.
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

type Props = {
	userId: string;
};

function CreateOrganization({ userId }: Props) {
	return (
		<Card className="w-full max-w-3xl mx-auto">
			<CardHeader>
				<CardTitle>Create Organization</CardTitle>
				<CardDescription>
					Organization creation is temporarily unavailable while the backend
					migrates to Convex. There is no self-serve "create client" flow yet
					under the new data model.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-8 text-center">
					<p className="text-amber-700 dark:text-amber-400 font-medium">
						Organization setup for this account isn&apos;t available right now.
						Please check back once this flow has been migrated.
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

export default CreateOrganization;