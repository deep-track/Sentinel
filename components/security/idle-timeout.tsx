"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Signs the user out after `minutes` without activity in any Sentinel tab
// (Settings → Security → idle timeout). Activity is shared between tabs via
// localStorage; without storage each tab times out on its own.
const STORAGE_KEY = "sentinel:last-activity";
const WARNING_MS = 60_000;
const EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "visibilitychange"] as const;

function readShared(): number | null {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeShared(value: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable: this tab still tracks its own activity.
  }
}

export function IdleTimeout({ minutes }: { minutes: number }) {
  const lastActivity = useRef(Date.now());
  const warned = useRef(false);

  useEffect(() => {
    const limit = minutes * 60_000;
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      warned.current = false;
      // Throttle shared writes.
      if (now - lastWrite > 5_000) {
        lastWrite = now;
        writeShared(now);
      }
    };
    onActivity();
    for (const event of EVENTS) window.addEventListener(event, onActivity, { passive: true });
    const timer = window.setInterval(() => {
      const latest = Math.max(lastActivity.current, readShared() ?? 0);
      const idle = Date.now() - latest;
      if (idle >= limit) {
        window.location.assign("/auth/logout");
      } else if (idle >= limit - WARNING_MS && !warned.current) {
        warned.current = true;
        toast.warning("You'll be signed out in a minute for inactivity. Move the mouse or press a key to stay signed in.");
      }
    }, 10_000);
    return () => {
      window.clearInterval(timer);
      for (const event of EVENTS) window.removeEventListener(event, onActivity);
    };
  }, [minutes]);

  return null;
}
