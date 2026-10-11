"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Building2, Radar, ShieldAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/backend/lib/utils";

type NavItem = { title: string; url: string; icon: LucideIcon };

// Only pages that exist under app/internal-ops are listed here.
const SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Cross-client",
    items: [
      { title: "Overview", url: "/internal-ops/overview", icon: Radar },
      { title: "Client accounts", url: "/internal-ops/clients", icon: Building2 },
    ],
  },
  {
    label: "Quality & review",
    items: [{ title: "Screening monitor", url: "/internal-ops/monitoring", icon: ShieldAlert }],
  },
];

export function OpsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sentinel Ops" className="flex flex-col gap-1">
      {SECTIONS.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <div className="px-1.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-sentinel-faint">
            {section.label}
          </div>
          {section.items.map((item) => {
            const active = pathname === item.url || pathname.startsWith(`${item.url}/`);
            return (
              <Link
                key={item.url}
                href={item.url}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                  active
                    ? "bg-sentinel-raised text-sentinel-text"
                    : "text-sentinel-nav hover:bg-sentinel-raised hover:text-sentinel-text",
                )}
              >
                <item.icon className={cn("h-3.5 w-3.5", active ? "text-sentinel-blue" : undefined)} aria-hidden="true" />
                {item.title}
                {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sentinel-blue" /> : null}
              </Link>
            );
          })}
        </div>
      ))}
      <Link
        href="/dashboard"
        className="mt-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-sentinel-subtle transition-colors hover:bg-sentinel-raised hover:text-sentinel-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to dashboard
      </Link>
    </nav>
  );
}
