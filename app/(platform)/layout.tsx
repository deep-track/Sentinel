import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getCurrentUser } from "@/backend/lib/auth";
import { getAuth0 } from "@/backend/lib/auth0";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { anyApi } from "convex/server";
import { AppSidebar } from "@/components/app-sidebar";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuth0Configured } = getAuth0();
  if (!isAuth0Configured) {
    redirect("/coming-soon?reason=auth-not-configured");
  }

  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  const convexClient = await getAuthenticatedConvexClient();
  if (!convexClient) {
    redirect("/access-pending?reason=authorization-unavailable");
  }

  try {
    const access = await convexClient.query(anyApi.watchlists.currentAccess, {});
    if (!access.authorized) {
      redirect("/access-pending");
    }
  } catch (error) {
    console.error("[platform-authz] access check failed", error);
    redirect("/access-pending?reason=authorization-unavailable");
  }

  return (
    <SidebarProvider>
      <AppSidebar role={user.role} />
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
