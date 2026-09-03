import { describe, it, expect, beforeEach } from "vitest";
import { useRoomActivityStore, selectRoomToolCalls } from "./roomActivityStore";

describe("roomActivityStore", () => {
  beforeEach(() => useRoomActivityStore.getState().reset());

  it("starts every room at zero", () => {
    expect(selectRoomToolCalls("editing")(useRoomActivityStore.getState())).toBe(0);
  });

  it("increments only the given room", () => {
    const store = useRoomActivityStore.getState();
    store.increment("editing");
    store.increment("editing");
    store.increment("scripting");

    expect(selectRoomToolCalls("editing")(useRoomActivityStore.getState())).toBe(2);
    expect(selectRoomToolCalls("scripting")(useRoomActivityStore.getState())).toBe(1);
    expect(selectRoomToolCalls("publishing")(useRoomActivityStore.getState())).toBe(0);
  });

  it("reset clears every room's tally", () => {
    const store = useRoomActivityStore.getState();
    store.increment("editing");
    store.reset();
    expect(selectRoomToolCalls("editing")(useRoomActivityStore.getState())).toBe(0);
  });
});
