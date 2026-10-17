"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { anyApi } from "convex/server";
import { useAuthedQuery } from "@/hooks/use-authed-query";

// Header bell: unread in-app notifications (notifications.ts).
export function NotificationBell() {
  const unread = useAuthedQuery(anyApi.notifications.unreadCount, {}) as number | undefined;
  const count = unread ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted"
      aria-label={count ? `Notifications: ${count} unread` : "Notifications"}
    >
      <Bell className="h-4 w-4" />
      {count > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
