import { describe, it, expect, vi } from "vitest";
import { createActor, SimulatedClock } from "xstate";
import { createAgentMachine } from "./agentMachine";
import type { AgentMachineActions } from "./agentMachineCommon";

const WANDER_DELAY = 100;
const WANDER_PAUSE = 50;

function buildActions(canWander: boolean): AgentMachineActions {
  return {
    onStartWalking: vi.fn(),
    onQueueJoined: vi.fn(),
    onQueueLeft: vi.fn(),
    onPhaseChanged: vi.fn(),
    onShowBossBubble: vi.fn(),
    onShowAgentBubble: vi.fn(),
    onClearBossBubble: vi.fn(),
    onClearAgentBubble: vi.fn(),
    onSetBossInUse: vi.fn(),
    onOpenElevator: vi.fn(),
    onCloseElevator: vi.fn(),
    onAgentRemoved: vi.fn(),
    canWander: () => canWander,
  };
}

function spawnAtDesk(actions: AgentMachineActions, strollAgain = false) {
  const clock = new SimulatedClock();
  const machine = createAgentMachine(actions).provide({
    delays: { WANDER_DELAY, WANDER_PAUSE },
    guards: { wantsAnotherStroll: () => strollAgain },
  });
  const actor = createActor(machine, { clock });
  actor.start();
  actor.send({
    type: "SPAWN_AT_DESK",
    agentId: "a1",
    name: "Scripter",
    desk: 1,
    position: { x: 256, y: 432 },
  });
  return { actor, clock };
}

describe("agentMachine idle wandering", () => {
  it("strolls to a spot after the idle delay and comes back on its own", () => {
    const actions = buildActions(true);
    const { actor, clock } = spawnAtDesk(actions);
    expect(actor.getSnapshot().matches({ idle: "at_desk" })).toBe(true);

    clock.increment(WANDER_DELAY);
    expect(actor.getSnapshot().matches({ idle: "wandering" })).toBe(true);
    expect(actions.onStartWalking).toHaveBeenLastCalledWith(
      "a1",
      expect.anything(),
      "to_wander_spot",
    );
    expect(actions.onPhaseChanged).toHaveBeenLastCalledWith("a1", "wandering");

    actor.send({ type: "ARRIVED_AT_SPOT" });
    expect(actor.getSnapshot().matches({ idle: "pausing" })).toBe(true);

    clock.increment(WANDER_PAUSE);
    expect(actor.getSnapshot().matches({ idle: "returning_to_desk" })).toBe(
      true,
    );
    expect(actions.onStartWalking).toHaveBeenLastCalledWith(
      "a1",
      expect.anything(),
      "to_desk",
    );

    actor.send({ type: "ARRIVED_AT_DESK" });
    expect(actor.getSnapshot().matches({ idle: "at_desk" })).toBe(true);
    expect(actions.onPhaseChanged).toHaveBeenLastCalledWith("a1", "idle");
  });

  it("keeps strolling while it wants to and interrupts on activity", () => {
    const actions = buildActions(true);
    const { actor, clock } = spawnAtDesk(actions, true);

    clock.increment(WANDER_DELAY);
    actor.send({ type: "ARRIVED_AT_SPOT" });
    clock.increment(WANDER_PAUSE);
    expect(actor.getSnapshot().matches({ idle: "wandering" })).toBe(true);

    actor.send({ type: "RETURN_TO_DESK" });
    expect(actor.getSnapshot().matches({ idle: "returning_to_desk" })).toBe(
      true,
    );
  });

  it("stays put while it cannot wander and keeps re-checking", () => {
    const actions = buildActions(false);
    const { actor, clock } = spawnAtDesk(actions);

    clock.increment(WANDER_DELAY);
    clock.increment(WANDER_DELAY);
    expect(actor.getSnapshot().matches({ idle: "at_desk" })).toBe(true);
    expect(actions.onStartWalking).not.toHaveBeenCalled();
    // One notification per (re)entry: spawn plus two re-armed timers.
    expect(actions.onPhaseChanged).toHaveBeenCalledTimes(3);
  });

  it("departs from wherever it is when removed mid-stroll", () => {
    const actions = buildActions(true);
    const { actor, clock } = spawnAtDesk(actions);

    clock.increment(WANDER_DELAY);
    actor.send({ type: "REMOVE" });
    expect(actor.getSnapshot().matches({ departure: "departing" })).toBe(true);
    expect(actions.onStartWalking).toHaveBeenLastCalledWith(
      "a1",
      expect.anything(),
      "to_departure_queue",
    );
  });

  it("ignores stroll events while at the desk", () => {
    const actions = buildActions(true);
    const { actor } = spawnAtDesk(actions);

    actor.send({ type: "RETURN_TO_DESK" });
    actor.send({ type: "ARRIVED_AT_SPOT" });
    expect(actor.getSnapshot().matches({ idle: "at_desk" })).toBe(true);
  });
});

describe("agentMachine chats", () => {
  const spot = { x: 640, y: 826 };

  it("walks to the chat spot, speaks, and returns when the chat runs out", () => {
    const actions = buildActions(false);
    const { actor, clock } = spawnAtDesk(actions);

    actor.send({
      type: "CHAT_START",
      spot,
      text: "Trim the intro",
      speaker: true,
    });
    expect(actor.getSnapshot().matches({ idle: "walking_to_chat" })).toBe(true);
    expect(actions.onStartWalking).toHaveBeenLastCalledWith(
      "a1",
      spot,
      "to_chat_spot",
    );

    actor.send({ type: "ARRIVED_AT_SPOT" });
    expect(actor.getSnapshot().matches({ idle: "chatting" })).toBe(true);
    expect(actions.onShowAgentBubble).toHaveBeenLastCalledWith(
      "a1",
      "Trim the intro",
      "💬",
    );

    clock.increment(20_000);
    expect(actor.getSnapshot().matches({ idle: "returning_to_desk" })).toBe(
      true,
    );
  });

  it("listens quietly when it is not the speaker", () => {
    const actions = buildActions(false);
    const { actor } = spawnAtDesk(actions);

    actor.send({
      type: "CHAT_START",
      spot,
      text: "Trim the intro",
      speaker: false,
    });
    actor.send({ type: "ARRIVED_AT_SPOT" });
    expect(actions.onShowAgentBubble).toHaveBeenLastCalledWith(
      "a1",
      "...",
      "👂",
    );
  });

  it("pre-empts a stroll and ignores an early CHAT_END until the scene has played", () => {
    const actions = buildActions(true);
    const { actor, clock } = spawnAtDesk(actions);

    clock.increment(WANDER_DELAY);
    expect(actor.getSnapshot().matches({ idle: "wandering" })).toBe(true);

    actor.send({ type: "CHAT_START", spot, text: "hi", speaker: true });
    expect(actor.getSnapshot().matches({ idle: "walking_to_chat" })).toBe(true);

    actor.send({ type: "CHAT_END" });
    expect(actor.getSnapshot().matches({ idle: "walking_to_chat" })).toBe(true);

    actor.send({ type: "ARRIVED_AT_SPOT" });
    actor.send({ type: "CHAT_END" });
    expect(actor.getSnapshot().matches({ idle: "chatting" })).toBe(true);
  });

  it("departs mid-chat when removed", () => {
    const actions = buildActions(false);
    const { actor } = spawnAtDesk(actions);

    actor.send({ type: "CHAT_START", spot, text: "hi", speaker: true });
    actor.send({ type: "ARRIVED_AT_SPOT" });
    actor.send({ type: "REMOVE" });
    expect(actor.getSnapshot().matches({ departure: "departing" })).toBe(true);
  });
});
