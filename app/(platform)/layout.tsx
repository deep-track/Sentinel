import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getCurrentUser, sessionConnection, sessionUsedMfa } from "@/backend/lib/auth";
import { getAuth0 } from "@/backend/lib/auth0";
import { getAuthenticatedConvexClient } from "@/backend/lib/convex-server";
import { anyApi } from "convex/server";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { IdleTimeout } from "@/components/security/idle-timeout";
import { SecurityBlock } from "@/components/security/security-block";
import { TrialBanner } from "@/components/billing/trial-banner";
import { ipAllowed } from "@/backend/convex/lib/clientSettings";
import { getActiveMembership } from "./_lib/active-client";
import { requestIp } from "./_lib/request-ip";
import type { CurrentAccess } from "./_lib/active-client-constants";
import { redirect } from "next/navigation";

// Every platform page is auth-gated; never prerender one at build time.
export const dynamic = "force-dynamic";

const MFA_LOGIN_URL = `/auth/login?${new URLSearchParams({
  acr_values: "http://schemas.openid.net/pape/policies/2007/06/multi-factor",
  prompt: "login",
  returnTo: "/dashboard",
})}`;

type Gate = { requireMfa: boolean; sessionTimeoutMinutes: number; ipAllowlist: string[]; sso?: { connectionName: string } | null };

function ssoLoginUrl(connection: string) {
  return `/auth/login?${new URLSearchParams({ connection, prompt: "login", returnTo: "/dashboard" })}`;
}

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

  let access: CurrentAccess;
  try {
    access = await convexClient.query(anyApi.watchlists.currentAccess, {});
  } catch (error) {
    console.error("[platform-authz] access query failed", error);
    redirect("/access-pending?reason=authorization-unavailable");
  }

  if (!access.authorized) {
    // Someone signing in for the first time after being invited joins their
    // team now (team.acceptMyInvites checks the email is verified).
    try {
      const { accepted } = (await convexClient.mutation(anyApi.team.acceptMyInvites, {})) as { accepted: number };
      if (accepted > 0) access = await convexClient.query(anyApi.watchlists.currentAccess, {});
    } catch (error) {
      console.error("[platform-authz] invite acceptance failed", error);
    }
  }

  if (!access.authorized) {
    redirect("/access-pending");
  }

  // The selected organization's security rules (Settings → Security).
  const active = await getActiveMembership(access.memberships);
  let gate: Gate = { requireMfa: false, sessionTimeoutMinutes: 0, ipAllowlist: [] };
  if (active) {
    try {
      gate = await convexClient.query(anyApi.orgSettings.gate, { clientId: active.clientId });
    } catch (error) {
      console.error("[platform-authz] security settings unavailable", error);
    }
  }
  const others = access.memberships.filter((membership) => membership.clientId !== active?.clientId);
  if (active && gate.ipAllowlist.length > 0) {
    const ip = await requestIp();
    if (!ipAllowed(ip, gate.ipAllowlist)) {
      return (
        <SecurityBlock
          title="This network isn't allowed"
          body={`${active.clientName} only allows Sentinel from approved networks. Your address (${ip ?? "unknown"}) isn't on the list. Connect from the office network or VPN, or ask your Admin to add it.`}
          others={others}
        />
      );
    }
  }
  if (active && gate.sso && (await sessionConnection()) !== gate.sso.connectionName) {
    return (
      <SecurityBlock
        title="Sign in with your company account"
        body={`${active.clientName} requires single sign-on. Sign in again with your company account to continue.`}
        action={{ label: "Sign in with your company account", href: ssoLoginUrl(gate.sso.connectionName) }}
        others={others}
      />
    );
  }
  if (active && gate.requireMfa && !(await sessionUsedMfa())) {
    return (
      <SecurityBlock
        title="Two-step sign-in required"
        body={`${active.clientName} requires two-step verification (MFA). Sign in again and complete the second step to continue.`}
        action={{ label: "Sign in with two-step verification", href: MFA_LOGIN_URL }}
        others={others}
      />
    );
  }

  return (
    <SidebarProvider>
      {gate.sessionTimeoutMinutes > 0 ? <IdleTimeout minutes={gate.sessionTimeoutMinutes} /> : null}
      <div className="print:hidden contents">
        <AppSidebar role={user.role} />
      </div>
      <main className="w-full">
        <div className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 dark:border-border h-11 print:hidden">
          <div className="flex items-center justify-between mx-8 mt-4">
            <SidebarTrigger />
            <div className="flex items-center gap-3">
              <NotificationBell />
              <span className="text-sm text-muted-foreground hidden md:inline">
                {user.fullName}
              </span>
              <Button asChild size="sm" variant="outline">
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/auth/logout">Logout</a>
              </Button>
            </div>
          </div>
        </div>

        {active ? <TrialBanner clientId={active.clientId} /> : null}
        {children}
      </main>
    </SidebarProvider>
  );
}
