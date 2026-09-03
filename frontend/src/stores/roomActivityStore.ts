"use client";

/**
 * Per-room activity tally — a lightweight "how much work has happened here
 * this session" counter, shown as a subtitle on each room's placard
 * (RoomWalls.tsx). Purely a frontend tally driven by live pre_tool_use
 * events; no backend change, no per-agent token accounting (that doesn't
 * exist yet — see token_tracker.py, which is session-level only).
 */

import { create } from "zustand";

interface RoomActivityState {
  /** roomId -> cumulative tool-call count this session. */
  toolCalls: Record<string, number>;
  increment: (roomId: string) => void;
  reset: () => void;
}

export const useRoomActivityStore = create<RoomActivityState>()((set) => ({
  toolCalls: {},

  increment: (roomId) =>
    set((state) => ({
      toolCalls: {
        ...state.toolCalls,
        [roomId]: (state.toolCalls[roomId] ?? 0) + 1,
      },
    })),

  reset: () => set({ toolCalls: {} }),
}));

export const selectRoomToolCalls =
  (roomId: string) =>
  (state: RoomActivityState): number =>
    state.toolCalls[roomId] ?? 0;
