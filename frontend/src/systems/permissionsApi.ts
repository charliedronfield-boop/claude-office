/**
 * Client for the real-time permission approve/deny bridge
 * (backend/app/api/routes/permissions.py).
 *
 * Deciding here answers the hook process that's holding a connection open
 * on GET /permissions/{id}/wait (see hooks/.../main.py). If that hook
 * process is gone (timed out, backend was restarted mid-request), this call
 * still succeeds — the decision is simply never picked up, and Claude
 * Code's normal interactive prompt is whatever already happened.
 */

import { apiFetch } from "@/utils/api";

export type PermissionDecision = "allow" | "deny";

export async function decidePermission(
  toolUseId: string,
  decision: PermissionDecision,
  reason?: string,
): Promise<boolean> {
  try {
    const res = await apiFetch(
      `/api/v1/permissions/${encodeURIComponent(toolUseId)}/decide`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
