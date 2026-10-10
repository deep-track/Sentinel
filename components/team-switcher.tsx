"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anyApi } from "convex/server";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { getInitials } from "@/utils/getInitials";
import {
  ACTIVE_CLIENT_COOKIE,
  type ClientMembership,
  type CurrentAccess,
  pickActiveMembership,
} from "@/app/(platform)/_lib/active-client-constants";
import { setActiveClient } from "@/app/(platform)/_lib/active-client-actions";

const ROLE_LABELS: Record<ClientMembership["role"], string> = {
  client_admin: "Admin",
  compliance_analyst: "Compliance analyst",
  developer: "Developer",
  viewer: "Viewer",
};

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

const noopSubscribe = () => () => {};

/**
 * Organization switcher. Lists the user's client memberships (all active
 * clients for internal admins) and stores the selection in the
 * `sentinel_client_id` cookie via a server action that re-validates it.
 * Server pages resolve the active organization from that cookie.
 */
export function TeamSwitcher() {
  const { isMobile } = useSidebar();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const access = useAuthedQuery(anyApi.dashboard.currentAccess, {}) as CurrentAccess | undefined;
  const cookieClientId = useSyncExternalStore(
    noopSubscribe,
    () => readCookie(ACTIVE_CLIENT_COOKIE),
    () => null,
  );
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  if (access === undefined) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Skeleton className="size-8 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
    );
  }

  const memberships = access.memberships;
  if (memberships.length === 0) return null;

  const active = pickActiveMembership(memberships, selectedClientId ?? cookieClientId) ?? memberships[0];

  function selectOrganization(clientId: string) {
    if (clientId === active.clientId) return;
    startTransition(async () => {
      const result = await setActiveClient(clientId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSelectedClientId(clientId);
      router.refresh();
    });
  }

  const trigger = (
    <SidebarMenuButton
      size="lg"
      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
      disabled={pending}
    >
      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
        {pending ? <Loader2 className="size-4 animate-spin" /> : getInitials(active.clientName)}
      </div>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">{active.clientName}</span>
        <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[active.role] ?? active.role}</span>
      </div>
      {memberships.length > 1 ? <ChevronsUpDown className="ml-auto size-4" /> : null}
    </SidebarMenuButton>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {memberships.length === 1 ? (
          trigger
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
              {memberships.map((membership) => (
                <DropdownMenuItem
                  key={membership.clientId}
                  onSelect={() => selectOrganization(membership.clientId)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-sm border text-[10px] font-semibold">
                    {getInitials(membership.clientName)}
                  </div>
                  <span className="flex-1 truncate">{membership.clientName}</span>
                  {membership.clientId === active.clientId ? <Check className="size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
