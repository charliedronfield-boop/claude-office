"""API routes for the real-time permission approve/deny gate.

Two very different callers hit this router:

- The **hook process** (``hooks/src/claude_office_hooks/main.py``) calls
  ``GET /{tool_use_id}/wait`` and blocks on it for up to its own timeout,
  waiting to see if a human decides from the office UI.
- The **office UI** (a person, via the Issues panel) calls
  ``POST /{tool_use_id}/decide`` to answer one pending request.

See ``app/core/permission_gate.py`` for the safety properties: every
failure mode here (unknown id, already decided, nobody answers in time)
degrades to "the office UI didn't help," never to a silent allow.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.permission_gate import get_permission_gate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/permissions", tags=["permissions"])

# Hard ceiling regardless of what the hook asks for — keeps one runaway
# request from holding a server worker open indefinitely.
MAX_WAIT_SECONDS = 300.0
DEFAULT_WAIT_SECONDS = 110.0


class DecisionRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    decision: Literal["allow", "deny"]
    reason: str | None = Field(default=None, max_length=500)


@router.get("/{tool_use_id}/wait")
async def wait_for_decision(
    tool_use_id: str,
    timeout: float = Query(default=DEFAULT_WAIT_SECONDS, ge=0, le=MAX_WAIT_SECONDS),
) -> dict[str, object]:
    """Block until *tool_use_id* is decided or *timeout* elapses.

    Returns ``{"decision": null}`` for an unknown id, a timeout, or a
    request that was already answered before this call started polling for
    it a second time — every one of those is treated identically by the
    caller (print nothing, let Claude Code's normal prompt stand).
    """
    gate = get_permission_gate()
    pending = await gate.wait(tool_use_id, timeout=min(timeout, MAX_WAIT_SECONDS))
    if pending is None:
        return {"decision": None, "found": False}
    return {
        "decision": pending.decision,
        "reason": pending.reason,
        "found": True,
    }


@router.post("/{tool_use_id}/decide")
async def decide(tool_use_id: str, body: DecisionRequest) -> dict[str, object]:
    """Answer a pending permission request from the office UI.

    Returns ``{"status": "not_found"}`` if the id is unknown or was already
    decided (e.g. a double-click, or the terminal prompt was answered
    directly) — the caller should treat that as a no-op, not an error.
    """
    gate = get_permission_gate()
    pending = gate.decide(tool_use_id, body.decision, body.reason)
    if pending is None:
        return {"status": "not_found", "toolUseId": tool_use_id}
    logger.info("Permission %s for %s (%s)", body.decision, tool_use_id, pending.tool_name)
    return {"status": "decided", "toolUseId": tool_use_id, "decision": body.decision}


@router.get("")
async def list_pending(session_id: str | None = None) -> dict[str, object]:
    """List permission requests still awaiting a decision (debug/reconnect)."""
    gate = get_permission_gate()
    pending = gate.list_pending(session_id=session_id)
    return {
        "pending": [
            {
                "toolUseId": p.tool_use_id,
                "sessionId": p.session_id,
                "agentId": p.agent_id,
                "toolName": p.tool_name,
                "toolInput": p.tool_input,
                "requestedAt": p.requested_at.isoformat(),
            }
            for p in pending
        ]
    }
