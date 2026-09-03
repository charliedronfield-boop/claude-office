"""In-memory gate that lets a human decide a pending PermissionRequest.

The hook process that raised the request holds an HTTP connection open on
``GET /api/v1/permissions/{tool_use_id}/wait`` (see
``app/api/routes/permissions.py``) while this module's ``PermissionGate``
holds an ``asyncio.Event`` for that request. The office UI's Approve/Deny
buttons call ``POST .../decide``, which sets the event; the waiting hook
process wakes up, gets the decision, and (best-effort) prints Claude Code's
``hookSpecificOutput`` decision JSON to stdout before exiting.

Safety property: if nobody decides in time, or the backend restarts, or the
printed JSON isn't in the shape Claude Code expects, the hook prints nothing
and Claude Code's normal interactive permission prompt happens exactly as it
does today. Nothing here can *silently allow* a tool call — the worst case
of every failure mode is "the office UI didn't help this time," never "the
tool ran without a human saying yes."
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

logger = logging.getLogger(__name__)

Decision = Literal["allow", "deny"]

# Pending requests older than this are dropped on the next sweep so a crashed
# or abandoned hook process doesn't leak memory forever.
STALE_AFTER_SECONDS = 15 * 60


@dataclass
class PendingPermission:
    tool_use_id: str
    session_id: str
    agent_id: str | None
    tool_name: str | None
    tool_input: dict[str, Any] | None
    requested_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    decision: Decision | None = None
    reason: str | None = None
    decided_at: datetime | None = None
    _event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    def is_stale(self, now: datetime | None = None) -> bool:
        current = now or datetime.now(UTC)
        return (current - self.requested_at).total_seconds() > STALE_AFTER_SECONDS

    async def wait(self, timeout: float) -> None:
        """Block up to *timeout* seconds for :meth:`resolve` to be called."""
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._event.wait(), timeout=timeout)

    def resolve(self, decision: Decision, reason: str | None) -> None:
        """Record the decision and wake every waiter. Call at most once."""
        self.decision = decision
        self.reason = reason
        self.decided_at = datetime.now(UTC)
        self._event.set()


class PermissionGate:
    """Tracks pending permission requests and lets them be decided exactly once."""

    def __init__(self) -> None:
        self._pending: dict[str, PendingPermission] = {}

    def register(
        self,
        tool_use_id: str,
        session_id: str,
        agent_id: str | None,
        tool_name: str | None,
        tool_input: dict[str, Any] | None,
    ) -> PendingPermission:
        """Create (or return the existing) pending entry for *tool_use_id*.

        Idempotent: a duplicate PERMISSION_REQUEST event for the same
        tool_use_id (e.g. a retried event POST) reuses the same waiter
        instead of losing whoever is already waiting on it.
        """
        existing = self._pending.get(tool_use_id)
        if existing is not None and existing.decision is None:
            return existing
        pending = PendingPermission(
            tool_use_id=tool_use_id,
            session_id=session_id,
            agent_id=agent_id,
            tool_name=tool_name,
            tool_input=tool_input,
        )
        self._pending[tool_use_id] = pending
        self._sweep()
        return pending

    async def wait(self, tool_use_id: str, timeout: float) -> PendingPermission | None:
        """Block up to *timeout* seconds for a decision on *tool_use_id*.

        Returns the entry regardless of whether it was decided (callers
        check ``.decision`` — ``None`` means "nobody decided in time").
        Returns ``None`` only if the id was never registered.
        """
        pending = self._pending.get(tool_use_id)
        if pending is None:
            return None
        await pending.wait(timeout)
        return pending

    def decide(
        self, tool_use_id: str, decision: Decision, reason: str | None
    ) -> PendingPermission | None:
        """Resolve a pending request. Returns None if unknown or already decided."""
        pending = self._pending.get(tool_use_id)
        if pending is None or pending.decision is not None:
            return None
        pending.resolve(decision, reason)
        return pending

    def get(self, tool_use_id: str) -> PendingPermission | None:
        return self._pending.get(tool_use_id)

    def list_pending(self, session_id: str | None = None) -> list[PendingPermission]:
        return [
            p
            for p in self._pending.values()
            if p.decision is None and (session_id is None or p.session_id == session_id)
        ]

    def _sweep(self) -> None:
        """Drop stale entries so long-running backends don't leak memory."""
        stale = [tool_use_id for tool_use_id, p in self._pending.items() if p.is_stale()]
        for tool_use_id in stale:
            del self._pending[tool_use_id]


_gate = PermissionGate()


def get_permission_gate() -> PermissionGate:
    return _gate
