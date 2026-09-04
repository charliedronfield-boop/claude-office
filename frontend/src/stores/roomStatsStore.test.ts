import { describe, it, expect, beforeEach } from "vitest";
import { useRoomStatsStore } from "./roomStatsStore";

describe("roomStatsStore", () => {
  beforeEach(() => useRoomStatsStore.getState().reset());

  it("starts every room with no tallies", () => {
    const state = useRoomStatsStore.getState();
    expect(state.success.editing).toBeUndefined();
    expect(state.failure.editing).toBeUndefined();
  });

  it("tallies success and failure independently per room", () => {
    const store = useRoomStatsStore.getState();
    store.recordResult("editing", true);
    store.recordResult("editing", true);
    store.recordResult("editing", false);
    store.recordResult("scripting", false);

    const state = useRoomStatsStore.getState();
    expect(state.success.editing).toBe(2);
    expect(state.failure.editing).toBe(1);
    expect(state.success.scripting).toBeUndefined();
    expect(state.failure.scripting).toBe(1);
  });

  it("reset clears every room's tally", () => {
    const store = useRoomStatsStore.getState();
    store.recordResult("editing", true);
    store.recordResult("editing", false);
    store.reset();

    const state = useRoomStatsStore.getState();
    expect(state.success).toEqual({});
    expect(state.failure).toEqual({});
  });
});
