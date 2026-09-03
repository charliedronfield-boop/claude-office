"use client";

import { useEffect } from "react";
import { useGameStore } from "@/stores/gameStore";
import { useIssuesStore } from "@/stores/issuesStore";

/** How long a "working" agent may go without any backend activity. */
const STUCK_AFTER_MS = 5 * 60_000;
const CHECK_EVERY_MS = 30_000;

/**
 * Periodically flags agents that report "working" but have produced nothing
 * for a long time, and clears the flag once they move again.
 */
export function useStuckAgentWatch(): void {
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const issues = useIssuesStore.getState();
      for (const agent of useGameStore.getState().agents.values()) {
        const quietFor = now - agent.lastActivityAt;
        const busy =
          agent.backendState === "working" || agent.backendState === "thinking";
        if (busy && quietFor >= STUCK_AFTER_MS && agent.phase !== "arriving") {
          const minutes = Math.round(quietFor / 60_000);
          issues.addIssue({
            id: `stuck-${agent.id}-${now}`,
            kind: "stuck",
            severity: "low",
            title: `${agent.name ?? "Agent"} seems stuck`,
            description: `No activity for ${minutes} min while marked as working.`,
            suggestion:
              "Peek at the agent's terminal — it may be waiting on a long command or looping on the same step.",
            agentId: agent.id,
            agentName: agent.name,
            toolName: null,
            toolInput: null,
            eventType: "agent_update",
            createdAt: now,
            resolvedAt: null,
            dismissed: false,
          });
        } else {
          issues.resolveKindFor("stuck", agent.id);
        }
      }
    };

    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);
}
