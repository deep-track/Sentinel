"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const SETTINGS_TABS = [
  { href: "/settings", label: "Profile" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/review", label: "Review workflow" },
  { href: "/settings/screening", label: "Screening rules" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/developers", label: "Developers" },
  { href: "/settings/audit", label: "Audit & data" },
  { href: "/settings/organization", label: "Organization" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="-mx-1 flex gap-1 overflow-x-auto border-b pb-px">
      {SETTINGS_TABS.map((tab) => {
        const active = tab.href === "/settings" ? pathname === "/settings" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
              active ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
