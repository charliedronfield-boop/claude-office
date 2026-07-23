"""Cross-session, full-detail models for the multi-session office view.

LOCAL PATCH. Unlike ``OverviewState`` (Command Center — boss-only summaries,
see ``app/models/overview.py``), this carries the complete ``GameState``
(boss AND subagents, desks, queues, etc.) for every active session at once,
so the office scene can render every live session's agents together instead
of one session at a time.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.sessions import GameState

__all__ = ["MultiSessionState"]


class MultiSessionState(BaseModel):
    """Full per-session game state for every active session.

    Broadcast over ``/ws/multi``, keyed by session id so the frontend can
    render (and diff) each session's agents independently.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    sessions: dict[str, GameState] = Field(default_factory=dict)
    last_updated: datetime
