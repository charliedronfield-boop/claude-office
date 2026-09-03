import { describe, it, expect } from "vitest";
import { classifyIssue, clearsWaitingIssues } from "./issueClassifier";
import type { EventType, WebSocketMessage } from "@/types";

type IncomingEvent = NonNullable<WebSocketMessage["event"]>;

function event(
  type: EventType,
  detail: IncomingEvent["detail"] = {},
  summary = "summary",
): IncomingEvent {
  return {
    id: "1",
    type,
    agentId: "main",
    summary,
    timestamp: "2026-09-03T08:00:00Z",
    detail,
  };
}

const actor = { agentId: "subagent_1", agentName: "Editor" };

describe("classifyIssue", () => {
  it("ignores successful tool calls", () => {
    expect(classifyIssue(event("post_tool_use", { toolName: "Bash" }), actor)).toBeNull();
    expect(
      classifyIssue(event("post_tool_use", { toolName: "Bash", success: true }), actor),
    ).toBeNull();
  });

  it("flags failed tool calls with a tool-specific suggestion", () => {
    const issue = classifyIssue(
      event("post_tool_use", {
        toolName: "Bash",
        toolInput: { command: "pytest" },
        success: false,
        message: "exit code 1",
      }),
      actor,
    );
    expect(issue).toMatchObject({
      kind: "tool_failure",
      severity: "high",
      title: "Bash failed",
      description: "exit code 1",
      agentId: "subagent_1",
      agentName: "Editor",
      toolName: "Bash",
      toolInput: { command: "pytest" },
    });
    expect(issue?.suggestion).toMatch(/command output/);
  });

  it("treats permission denials and stop failures as critical", () => {
    const denied = classifyIssue(
      event("error", {
        errorType: "permission_denied",
        toolName: "Write",
        message: "blocked",
      }),
      actor,
    );
    expect(denied).toMatchObject({
      kind: "permission_denied",
      severity: "critical",
      title: "Write was blocked",
    });

    const stopped = classifyIssue(
      event("error", { errorType: "stop_failure", message: "429" }),
      actor,
    );
    expect(stopped).toMatchObject({ kind: "stop_failure", severity: "critical" });
  });

  it("uses the tool input as the description of a permission request", () => {
    const issue = classifyIssue(
      event("permission_request", {
        toolName: "Bash",
        toolInput: { command: "rm -rf build" },
      }),
      actor,
    );
    expect(issue).toMatchObject({
      kind: "needs_approval",
      severity: "critical",
      description: "rm -rf build",
    });
  });

  it("only turns actionable notifications into issues", () => {
    expect(
      classifyIssue(event("notification", { notificationType: "idle_prompt" }), actor),
    ).toBeNull();
    expect(
      classifyIssue(
        event("notification", { notificationType: "agent_needs_input" }),
        actor,
      )?.kind,
    ).toBe("needs_input");
    expect(
      classifyIssue(
        event("notification", { notificationType: "quota_auto_resume_fired" }),
        actor,
      )?.kind,
    ).toBe("quota");
  });

  it("flags failed background tasks only", () => {
    expect(
      classifyIssue(
        event("background_task_notification", { backgroundTaskStatus: "completed" }),
        actor,
      ),
    ).toBeNull();
    expect(
      classifyIssue(
        event("background_task_notification", { backgroundTaskStatus: "failed" }),
        actor,
      )?.kind,
    ).toBe("background_failed");
  });

  it("ignores routine events", () => {
    expect(classifyIssue(event("pre_tool_use"), actor)).toBeNull();
    expect(classifyIssue(event("subagent_start"), actor)).toBeNull();
  });
});

describe("clearsWaitingIssues", () => {
  it("clears on progress or completion, not on other events", () => {
    expect(clearsWaitingIssues("pre_tool_use")).toBe(true);
    expect(clearsWaitingIssues("stop")).toBe(true);
    expect(clearsWaitingIssues("notification")).toBe(false);
  });
});
