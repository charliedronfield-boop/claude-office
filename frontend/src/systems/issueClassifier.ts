/**
 * Issue classifier.
 *
 * Turns incoming backend events into actionable "issues" for the Issues
 * panel: tool failures, permission denials/requests, agents waiting on
 * input, quota problems and failed background tasks. Pure-TS so the rules
 * are unit-testable without React or the stores.
 */

import type { EventType, WebSocketMessage } from "@/types";

export type IssueSeverity = "critical" | "high" | "low";

export type IssueKind =
  | "tool_failure"
  | "permission_denied"
  | "stop_failure"
  | "generic_error"
  | "needs_approval"
  | "needs_input"
  | "quota"
  | "background_failed"
  | "stuck";

export interface Issue {
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  title: string;
  description: string;
  suggestion: string;
  /** Frontend agent id, or "main" for the boss. */
  agentId: string | null;
  agentName: string | null;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  eventType: EventType;
  createdAt: number;
  resolvedAt: number | null;
  dismissed: boolean;
}

export interface IssueActor {
  agentId: string | null;
  agentName: string | null;
}

type IncomingEvent = NonNullable<WebSocketMessage["event"]>;

const TOOL_FAILURE_SUGGESTIONS: Record<string, string> = {
  Bash: "Open the terminal to read the command output, fix the underlying error and let the agent re-run it.",
  Edit: "The edit did not apply — check the file path exists and the text being replaced still matches.",
  Write: "The write failed — check the path is writable and the directory exists.",
  Read: "The file could not be read — check the path and that it has not been moved or deleted.",
};

const DEFAULT_TOOL_FAILURE_SUGGESTION =
  "Open the terminal to see the full error, then fix it and let the agent retry.";

/** Auto-resolving kinds: cleared when the same agent makes progress again. */
export const WAITING_KINDS: ReadonlySet<IssueKind> = new Set<IssueKind>([
  "needs_approval",
  "needs_input",
]);

function makeId(event: IncomingEvent, kind: IssueKind): string {
  return `${event.id}-${kind}-${Math.random().toString(36).slice(2, 8)}`;
}

function build(
  event: IncomingEvent,
  actor: IssueActor,
  fields: Pick<Issue, "kind" | "severity" | "title" | "description" | "suggestion">,
): Issue {
  const detail = event.detail ?? {};
  return {
    id: makeId(event, fields.kind),
    ...fields,
    agentId: actor.agentId,
    agentName: actor.agentName,
    toolName: detail.toolName ?? null,
    toolInput: detail.toolInput ?? null,
    eventType: event.type,
    createdAt: event.timestamp ? new Date(event.timestamp).getTime() : Date.now(),
    resolvedAt: null,
    dismissed: false,
  };
}

/**
 * Classify an event. Returns `null` for anything that is not a problem the
 * user should act on.
 */
export function classifyIssue(
  event: IncomingEvent,
  actor: IssueActor,
): Issue | null {
  const detail = event.detail ?? {};
  const toolName = detail.toolName ?? "tool";

  switch (event.type) {
    case "post_tool_use": {
      if (detail.success !== false) return null;
      return build(event, actor, {
        kind: "tool_failure",
        severity: "high",
        title: `${toolName} failed`,
        description: detail.message ?? detail.errorType ?? "The tool call failed.",
        suggestion:
          TOOL_FAILURE_SUGGESTIONS[toolName] ?? DEFAULT_TOOL_FAILURE_SUGGESTION,
      });
    }

    case "error": {
      const errorType = detail.errorType ?? "";
      if (errorType === "permission_denied") {
        return build(event, actor, {
          kind: "permission_denied",
          severity: "critical",
          title: `${toolName} was blocked`,
          description:
            detail.message ?? detail.reason ?? "A tool call was denied.",
          suggestion:
            "Approve the tool in the terminal, or add it to the allow rules in settings.json so it runs next time.",
        });
      }
      if (errorType === "stop_failure") {
        return build(event, actor, {
          kind: "stop_failure",
          severity: "critical",
          title: "Turn ended with an error",
          description: detail.message ?? "Claude stopped with an API error.",
          suggestion:
            "Check for rate limits or quota problems, then resume the session from the terminal.",
        });
      }
      return build(event, actor, {
        kind: "generic_error",
        severity: "high",
        title: errorType ? errorType.replace(/_/g, " ") : "Error",
        description: detail.message ?? event.summary,
        suggestion: "Open the terminal to see what went wrong.",
      });
    }

    case "permission_request":
      return build(event, actor, {
        kind: "needs_approval",
        severity: "critical",
        title: `${toolName} needs your approval`,
        description: summariseToolInput(detail.toolInput) ?? event.summary,
        suggestion:
          "Switch to the terminal and approve or deny the request — the agent is paused until you do.",
      });

    case "notification": {
      const notificationType = detail.notificationType ?? "";
      if (notificationType === "permission_prompt") {
        return build(event, actor, {
          kind: "needs_approval",
          severity: "critical",
          title: "Waiting for your approval",
          description: detail.message ?? event.summary,
          suggestion: "Switch to the terminal and answer the permission prompt.",
        });
      }
      if (notificationType === "agent_needs_input") {
        return build(event, actor, {
          kind: "needs_input",
          severity: "high",
          title: "Waiting for your input",
          description: detail.message ?? event.summary,
          suggestion:
            "An agent asked a question and is blocked until you answer it in the terminal.",
        });
      }
      if (notificationType.startsWith("quota_auto_resume")) {
        return build(event, actor, {
          kind: "quota",
          severity: "high",
          title: "Usage quota hit",
          description: detail.message ?? event.summary,
          suggestion:
            "Work is paused on quota. It resumes automatically when the limit resets; check your plan limits if this keeps happening.",
        });
      }
      return null;
    }

    case "background_task_notification": {
      if (detail.backgroundTaskStatus !== "failed") return null;
      return build(event, actor, {
        kind: "background_failed",
        severity: "high",
        title: "Background task failed",
        description: event.summary,
        suggestion:
          "Open the task's output file from the terminal to see why it failed.",
      });
    }

    default:
      return null;
  }
}

/** Kinds that count as "the agent moved on" and clear waiting issues. */
export function clearsWaitingIssues(eventType: EventType): boolean {
  return (
    eventType === "pre_tool_use" ||
    eventType === "post_tool_use" ||
    eventType === "stop" ||
    eventType === "session_end"
  );
}

function summariseToolInput(
  toolInput: Record<string, unknown> | undefined,
): string | null {
  if (!toolInput) return null;
  const preferred = ["command", "file_path", "pattern", "url", "description"];
  for (const key of preferred) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim()) {
      return value.length > 160 ? `${value.slice(0, 157)}...` : value;
    }
  }
  return null;
}
