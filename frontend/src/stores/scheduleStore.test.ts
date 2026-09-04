import { describe, it, expect, beforeEach } from "vitest";
import {
  extractSchedule,
  formatCountdown,
  useScheduleStore,
} from "./scheduleStore";

describe("extractSchedule", () => {
  it("extracts a single-quoted value", () => {
    expect(
      extractSchedule("yt upload --schedule 'Fri 16:00' mastered.mp4"),
    ).toBe("Fri 16:00");
  });

  it("extracts a double-quoted value", () => {
    expect(extractSchedule('yt upload --schedule "2026-09-10T16:00:00Z"')).toBe(
      "2026-09-10T16:00:00Z",
    );
  });

  it("extracts an unquoted value", () => {
    expect(extractSchedule("yt upload --schedule=2026-09-10T16:00:00Z")).toBe(
      "2026-09-10T16:00:00Z",
    );
  });

  it("returns null when there is no --schedule flag", () => {
    expect(extractSchedule("yt upload mastered.mp4")).toBeNull();
  });
});

describe("formatCountdown", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");

  it("returns null once the target has passed", () => {
    expect(formatCountdown(now - 1000, now)).toBeNull();
  });

  it("formats minutes for under an hour", () => {
    expect(formatCountdown(now + 25 * 60_000, now)).toBe("in 25m");
  });

  it("formats hours and minutes for under a day", () => {
    expect(formatCountdown(now + 3 * 3_600_000 + 15 * 60_000, now)).toBe(
      "in 3h 15m",
    );
  });

  it("formats days and hours beyond a day", () => {
    expect(formatCountdown(now + 2 * 86_400_000 + 4 * 3_600_000, now)).toBe(
      "in 2d 4h",
    );
  });
});

describe("useScheduleStore", () => {
  beforeEach(() => useScheduleStore.getState().reset());

  it("parses a Date.parse-able schedule", () => {
    useScheduleStore.getState().setSchedule("2026-09-10T16:00:00Z");
    const state = useScheduleStore.getState();
    expect(state.raw).toBe("2026-09-10T16:00:00Z");
    expect(state.parsedAt).toBe(Date.parse("2026-09-10T16:00:00Z"));
  });

  it("keeps the raw text but leaves parsedAt null for unparseable text", () => {
    useScheduleStore.getState().setSchedule("Fri 16:00");
    const state = useScheduleStore.getState();
    expect(state.raw).toBe("Fri 16:00");
    expect(state.parsedAt).toBeNull();
  });

  it("reset clears both fields", () => {
    useScheduleStore.getState().setSchedule("2026-09-10T16:00:00Z");
    useScheduleStore.getState().reset();
    const state = useScheduleStore.getState();
    expect(state.raw).toBeNull();
    expect(state.parsedAt).toBeNull();
  });
});
