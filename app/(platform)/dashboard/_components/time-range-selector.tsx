"use client";

import { useState } from "react";
import { cn } from "@/backend/lib/utils";

type Range = "today" | "7d" | "30d" | "custom";

interface TimeRangeSelectorProps {
  onChange: (range: Range) => void;
}

export function TimeRangeSelector({ onChange }: TimeRangeSelectorProps) {
  const [active, setActive] = useState<Range>("7d");

  const options: { value: Range; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "7d", label: "Last 7 Days" },
    { value: "30d", label: "Last 30 Days" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => {
            setActive(opt.value);
            onChange(opt.value);
          }}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            active === opt.value
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
