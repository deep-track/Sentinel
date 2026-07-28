import { AppSidebar } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

const isAuth0Configured = Boolean(
	process.env.AUTH0_SECRET &&
	process.env.AUTH0_DOMAIN &&
	process.env.AUTH0_CLIENT_ID &&
	process.env.AUTH0_CLIENT_SECRET &&
	process.env.APP_BASE_URL,
);

const DEV_USER = {
	id: "dev-user",
	email: "dev@deeptrack.io",
	fullName: "Dev User",
	role: "admin" as const,
};

export default async function Layout({
	children,
}: { children: React.ReactNode }) {
	const user = isAuth0Configured ? await getCurrentUser() : DEV_USER;
	if (!user) redirect("/auth/login");
	return (
		<SidebarProvider>
			<AppSidebar
				role={user.role}
			/>
			<main className="w-full">
				<div className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 dark:border-border h-11">
					<div className="flex items-center justify-between mx-8 mt-4">
						<SidebarTrigger />
						<div className="flex items-center gap-3">
							<span className="text-sm text-muted-foreground hidden md:inline">
								{user.fullName}
							</span>
							<Button asChild size="sm" variant="outline">
								<Link href="/auth/logout">Logout</Link>
							</Button>
						</div>
					</div>
				</div>

				{children}
			</main>
		</SidebarProvider>
	);
}