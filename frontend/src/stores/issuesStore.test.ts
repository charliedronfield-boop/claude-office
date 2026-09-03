import { describe, it, expect, beforeEach } from "vitest";
import {
  useIssuesStore,
  selectOpenIssues,
  selectOpenCount,
  selectHasOpenCritical,
} from "./issuesStore";
import type { Issue } from "@/systems/issueClassifier";

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: overrides.id ?? `i-${Math.random()}`,
    kind: "tool_failure",
    severity: "high",
    title: "Bash failed",
    description: "exit 1",
    suggestion: "fix it",
    agentId: "a1",
    agentName: "Editor",
    toolName: "Bash",
    toolInput: null,
    toolUseId: null,
    eventType: "post_tool_use",
    createdAt: 1,
    resolvedAt: null,
    dismissed: false,
    ...overrides,
  };
}

describe("issuesStore", () => {
  beforeEach(() => useIssuesStore.getState().reset());

  it("adds issues and de-duplicates identical open ones", () => {
    const store = useIssuesStore.getState();
    store.addIssue(issue({ id: "one" }));
    store.addIssue(issue({ id: "two" }));
    expect(selectOpenCount(useIssuesStore.getState())).toBe(1);

    store.resolveIssue("one");
    store.addIssue(issue({ id: "three" }));
    expect(selectOpenCount(useIssuesStore.getState())).toBe(1);
    expect(selectOpenIssues(useIssuesStore.getState())[0].id).toBe("three");
  });

  it("tracks the latest critical issue for tab auto-focus", () => {
    const store = useIssuesStore.getState();
    expect(useIssuesStore.getState().lastCriticalAt).toBeNull();
    store.addIssue(issue({ kind: "needs_approval", severity: "critical" }));
    expect(useIssuesStore.getState().lastCriticalAt).not.toBeNull();
    expect(selectHasOpenCritical(useIssuesStore.getState())).toBe(true);
  });

  it("resolves waiting issues for one agent or all agents", () => {
    const store = useIssuesStore.getState();
    store.addIssue(issue({ kind: "needs_approval", agentId: "a1" }));
    store.addIssue(issue({ kind: "needs_input", agentId: "a2" }));
    store.addIssue(issue({ kind: "tool_failure", agentId: "a1" }));

    store.resolveWaitingFor("a1");
    let open = selectOpenIssues(useIssuesStore.getState());
    expect(open.map((i) => i.kind).sort()).toEqual([
      "needs_input",
      "tool_failure",
    ]);

    store.resolveWaitingFor(null);
    open = selectOpenIssues(useIssuesStore.getState());
    expect(open.map((i) => i.kind)).toEqual(["tool_failure"]);
  });

  it("dismissed issues disappear from open and resolved lists", () => {
    const store = useIssuesStore.getState();
    store.addIssue(issue({ id: "x" }));
    store.dismissIssue("x");
    expect(selectOpenCount(useIssuesStore.getState())).toBe(0);
  });
});
