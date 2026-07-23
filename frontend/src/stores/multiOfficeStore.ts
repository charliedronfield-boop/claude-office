"use client";

/**
 * multiOfficeStore — LOCAL PATCH.
 *
 * Holds full per-session game state (boss AND agents) from the /ws/multi
 * feed, keyed by session id. Deliberately separate from gameStore (which
 * holds exactly one active session's state) and overviewStore (which holds
 * boss-only summaries for Command Center) — see MultiOfficeView.tsx.
 */

import { create } from "zustand";
import type { GameState } from "@/types";

interface MultiOfficeState {
  /** Full per-session game state from /ws/multi (live sessions only). */
  sessions: Record<string, GameState>;
  /** Whether the /ws/multi WebSocket is currently connected. */
  connected: boolean;
  /** Wall-clock ms of the last received update (null if none yet). */
  lastUpdated: number | null;

  setSessions: (sessions: Record<string, GameState>) => void;
  setConnected: (connected: boolean) => void;
  clear: () => void;
}

export const useMultiOfficeStore = create<MultiOfficeState>()((set) => ({
  sessions: {},
  connected: false,
  lastUpdated: null,

  setSessions: (sessions) => set({ sessions, lastUpdated: Date.now() }),
  setConnected: (connected) => set({ connected }),
  clear: () => set({ sessions: {}, lastUpdated: null, connected: false }),
}));

export const selectMultiOfficeSessions = (
  s: MultiOfficeState,
): Record<string, GameState> => s.sessions;
export const selectMultiOfficeConnected = (s: MultiOfficeState): boolean =>
  s.connected;
