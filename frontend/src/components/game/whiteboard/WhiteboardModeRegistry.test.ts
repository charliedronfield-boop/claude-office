import { describe, it, expect } from "vitest";
import { MODE_INFO, WHITEBOARD_MODE_COUNT, getNextMode, getModeInfo } from "./WhiteboardModeRegistry";
import type { WhiteboardMode } from "@/types";

describe("WhiteboardModeRegistry", () => {
  it("WHITEBOARD_MODE_COUNT matches the number of registered modes", () => {
    // Regression guard: whiteboardSlice's click-to-cycle used to hardcode
    // its own stale copy of this count, so modes added to MODE_INFO (e.g.
    // Pipeline, Artifacts, Room Stats) were reachable only by hotkey, never
    // by clicking the whiteboard.
    expect(Object.keys(MODE_INFO)).toHaveLength(WHITEBOARD_MODE_COUNT);
  });

  it("every mode 0..count-1 has registry info", () => {
    for (let mode = 0; mode < WHITEBOARD_MODE_COUNT; mode++) {
      expect(getModeInfo(mode as WhiteboardMode).name).toBeTruthy();
    }
  });

  it("cycling from the last mode wraps back to 0", () => {
    const last = (WHITEBOARD_MODE_COUNT - 1) as WhiteboardMode;
    expect(getNextMode(last)).toBe(0);
  });

  it("cycling visits every mode exactly once before repeating", () => {
    const seen = new Set<WhiteboardMode>();
    let mode: WhiteboardMode = 0;
    for (let i = 0; i < WHITEBOARD_MODE_COUNT; i++) {
      seen.add(mode);
      mode = getNextMode(mode);
    }
    expect(seen.size).toBe(WHITEBOARD_MODE_COUNT);
    expect(mode).toBe(0);
  });
});
