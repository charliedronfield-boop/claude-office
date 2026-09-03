"use client";

/**
 * Tracks the most recent `--schedule` value seen in a publisher's Bash
 * command (e.g. `yt upload --schedule 'Fri 16:00' video.mp4`), so the
 * Publishing room's placard can show "next upload" at a glance.
 *
 * Deliberately does NOT attempt natural-language date parsing (no
 * chrono-node-style library here, and getting "Fri 16:00" wrong would be
 * actively misleading). It tries the one thing the browser can parse safely
 * — `Date.parse`, which handles ISO-ish and many explicit formats — and
 * falls back to showing the raw text verbatim when that fails.
 */

import { create } from "zustand";

interface ScheduleState {
  raw: string | null;
  parsedAt: number | null; // epoch ms, only set when Date.parse succeeded
  setSchedule: (raw: string) => void;
  reset: () => void;
}

/** Matches --schedule 'value', --schedule "value", or --schedule=value. */
const SCHEDULE_FLAG_RE = /--schedule[= ]+['"]([^'"]+)['"]|--schedule[= ]+(\S+)/;

export function extractSchedule(command: string): string | null {
  const match = SCHEDULE_FLAG_RE.exec(command);
  const value = match?.[1] ?? match?.[2];
  return value?.trim() || null;
}

export const useScheduleStore = create<ScheduleState>()((set) => ({
  raw: null,
  parsedAt: null,

  setSchedule: (raw) => {
    const parsed = Date.parse(raw);
    set({
      raw,
      parsedAt: Number.isNaN(parsed) ? null : parsed,
    });
  },

  reset: () => set({ raw: null, parsedAt: null }),
}));

/** "in 3h 12m", "in 2d 4h", or null once the target has passed. */
export function formatCountdown(targetMs: number, nowMs: number): string | null {
  const diff = targetMs - nowMs;
  if (diff <= 0) return null;

  const minutes = Math.floor(diff / 60_000) % 60;
  const hours = Math.floor(diff / 3_600_000) % 24;
  const days = Math.floor(diff / 86_400_000);

  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}
