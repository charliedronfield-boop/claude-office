"use client";

/**
 * Per-room pass/fail tally for post_tool_use calls this session — feeds
 * RoomStatsMode (whiteboard). Same "purely a frontend tally, no backend
 * change" shape as roomActivityStore, just split success vs. failure
 * instead of a flat increment.
 */

import { create } from "zustand";

interface RoomStatsState {
  success: Record<string, number>;
  failure: Record<string, number>;
  recordResult: (roomId: string, ok: boolean) => void;
  reset: () => void;
}

export const useRoomStatsStore = create<RoomStatsState>()((set) => ({
  success: {},
  failure: {},

  recordResult: (roomId, ok) =>
    set((state) =>
      ok
        ? { success: { ...state.success, [roomId]: (state.success[roomId] ?? 0) + 1 } }
        : { failure: { ...state.failure, [roomId]: (state.failure[roomId] ?? 0) + 1 } },
    ),

  reset: () => set({ success: {}, failure: {} }),
}));
