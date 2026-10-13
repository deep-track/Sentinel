"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowLeft, Building2, ClipboardCheck, FileCheck2, FlaskConical, Gauge, HeartPulse, Radar, Receipt, ShieldAlert, ShieldX, type LucideIcon } from "lucide-react";
import { cn } from "@/backend/lib/utils";

type NavItem = { title: string; url: string; icon: LucideIcon };

// Only pages that exist under app/internal-ops are listed here.
const SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Back office",
    items: [
      { title: "Overview", url: "/internal-ops/overview", icon: Radar },
      { title: "Service health", url: "/internal-ops/health", icon: Activity },
      { title: "Revenue & billing", url: "/internal-ops/billing", icon: Receipt },
    ],
  },
  {
    label: "Clients",
    items: [
      { title: "Client accounts", url: "/internal-ops/clients", icon: Building2 },
      { title: "Client health", url: "/internal-ops/client-health", icon: HeartPulse },
    ],
  },
  {
    label: "Reviews",
    items: [
      { title: "Review queue", url: "/internal-ops/review-queue", icon: ClipboardCheck },
      { title: "Review operations", url: "/internal-ops/review-ops", icon: Gauge },
      { title: "Screening monitor", url: "/internal-ops/monitoring", icon: ShieldAlert },
    ],
  },
  {
    label: "Risk & compliance",
    items: [
      { title: "Risk", url: "/internal-ops/risk", icon: ShieldX },
      { title: "Compliance", url: "/internal-ops/compliance", icon: FileCheck2 },
      { title: "Model & data quality", url: "/internal-ops/quality", icon: FlaskConical },
    ],
  },
];

export function OpsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sentinel Back Office" className="flex flex-col gap-1">
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
