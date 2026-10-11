import { Space_Grotesk } from "next/font/google";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/backend/lib/utils";

// Sentinel brand kit: near-black surfaces, the three-bar blue mark, and
// Space Grotesk. Colors are the `sentinel-*` tokens in tailwind.config.ts.

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

/** Full-bleed branded canvas for a Sentinel page. */
export function SentinelCanvas({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        spaceGrotesk.variable,
        "font-grotesk min-h-full bg-sentinel-bg text-sentinel-text text-[13px] antialiased",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SentinelMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex h-[22px] items-end gap-[3px]", className)}>
      <span className="h-[10px] w-[3px] rounded-sm bg-sentinel-blue-light" />
      <span className="h-[16px] w-[3px] rounded-sm bg-sentinel-blue-mid" />
      <span className="h-[22px] w-[3px] rounded-sm bg-sentinel-blue" />
    </span>
  );
}

export function SentinelLogo({ caption }: { caption: string }) {
  return (
    <div className="flex items-center gap-2">
      <SentinelMark />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold text-sentinel-text">
          deep<span className="font-normal text-sentinel-muted">track</span>
        </div>
        <div className="text-[10px] text-sentinel-subtle">{caption}</div>
      </div>
    </div>
  );
}

export function TopBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-sentinel-line px-5 py-2.5">{children}</div>
  );
}

export function StatusDot({ tone = "green", children }: { tone?: "green" | "amber" | "red"; children: ReactNode }) {
  const styles = {
    green: ["bg-sentinel-green", "text-sentinel-green-text"],
    amber: ["bg-sentinel-amber", "text-sentinel-amber-text"],
    red: ["bg-sentinel-red", "text-sentinel-red-text"],
  }[tone];
  return (
    <span className={cn("flex items-center gap-1.5 text-[11px]", styles[1])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", styles[0])} />
      {children}
    </span>
  );
}

export function Breadcrumb({ items }: { items: string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[11px] text-sentinel-subtle">
      {items.map((item, index) => (
        <span key={item} className="flex items-center gap-1.5">
          {index > 0 ? <span aria-hidden="true">›</span> : null}
          <span className={index === items.length - 1 ? "text-sentinel-muted" : undefined}>{item}</span>
        </span>
      ))}
    </nav>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-sentinel-line bg-sentinel-surface", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({
  icon: Icon,
  iconClassName,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon;
  iconClassName?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sentinel-line px-3.5 py-2.5">
      <h2 className="flex items-center gap-1.5 text-[13px] font-medium">
        {Icon ? <Icon className={cn("h-3.5 w-3.5 text-sentinel-muted", iconClassName)} aria-hidden="true" /> : null}
        {title}
        {hint ? <span className="ml-1.5 text-[11px] font-normal text-sentinel-subtle">{hint}</span> : null}
      </h2>
      {action}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-medium uppercase tracking-[0.05em] text-sentinel-subtle">{children}</div>;
}

export function StatTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "amber" | "red" | "blue";
}) {
  const toneClass =
    tone === "amber"
      ? "text-sentinel-amber"
      : tone === "red"
        ? "text-sentinel-red-text"
        : tone === "blue"
          ? "text-sentinel-blue-mid"
          : undefined;
  return (
    <div className="min-w-[150px] flex-1 rounded-lg border border-sentinel-line bg-sentinel-surface px-3 py-2.5">
      <Eyebrow>{label}</Eyebrow>
      <div className={cn("mt-1.5 text-xl font-semibold", toneClass)}>{value}</div>
      {note ? <div className="text-[10px] text-sentinel-subtle">{note}</div> : null}
    </div>
  );
}

export type BadgeTone = "green" | "blue" | "red" | "amber" | "neutral" | "outline";

const BADGE_TONES: Record<BadgeTone, string> = {
  green: "bg-sentinel-green-bg text-sentinel-green-text",
  blue: "bg-sentinel-blue-bg text-sentinel-blue-mid",
  red: "bg-sentinel-red-bg text-sentinel-red-text",
  amber: "bg-sentinel-amber-bg text-sentinel-amber-text",
  neutral: "bg-sentinel-line-soft text-sentinel-muted",
  outline: "border border-sentinel-chip text-sentinel-muted",
};

export function Badge({ tone, icon: Icon, children }: { tone: BadgeTone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px]", BADGE_TONES[tone])}>
      {Icon ? <Icon className="h-2.5 w-2.5" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Thin usage bar; turns amber at the alert threshold and red at 90%+. */
export function UsageBar({
  pct,
  thresholdPct = 80,
  className,
  label,
}: {
  pct: number | null;
  thresholdPct?: number;
  className?: string;
  label: string;
}) {
  const clamped = pct === null ? 0 : Math.min(Math.max(pct, 0), 100);
  const color =
    pct !== null && pct >= 90 ? "bg-sentinel-red" : pct !== null && pct >= thresholdPct ? "bg-sentinel-amber" : "bg-sentinel-blue";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(clamped)}
      className={cn("overflow-hidden rounded bg-sentinel-line-soft", className ?? "h-1 w-16")}
    >
      <div className={cn("h-full rounded", color)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function DataTable({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-sentinel-line text-[10px] uppercase tracking-[0.05em] text-sentinel-faint">
            {head.map((label) => (
              <th key={label} scope="col" className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-b border-sentinel-line-soft last:border-b-0",
        onClick ? "cursor-pointer hover:bg-sentinel-raised" : undefined,
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("whitespace-nowrap px-3 py-2", className)}>{children}</td>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-[12px] text-sentinel-subtle">{children}</div>;
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-sentinel-line-soft", className)} />;
}
