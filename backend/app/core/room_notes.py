"""Persistent, room-scoped knowledge notes ("the shared knowledge board").

Notes come from two sources:
- **You**, via `POST /api/v1/room-notes` (the office UI's Notes tab).
- **The agents themselves**, automatically: every real inter-agent chat
  (`AGENT_MESSAGE` — see `state_machine._handle_agent_message`) appends its
  text as a note in the recipient's room, so a hint one agent gives another
  outlives the moment and the next agent in that room can see it too.

The boss's ``UserPromptSubmit`` hook reads these back (best-effort, via
``GET /api/v1/room-notes/context``) and injects them as
``hookSpecificOutput.additionalContext`` on its next turn — the one
documented, verifiable way to get accumulated knowledge in front of a
running Claude Code session. There is no verified hook mechanism to inject
context directly into a *new* subagent's initial prompt, so this
deliberately stops at "the boss sees it and can pass it along," rather than
overclaiming automatic delivery into every subagent.
"""

from __future__ import annotations

from typing import Literal

from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RoomNoteRecord

MAX_NOTE_LENGTH = 500
MAX_NOTES_PER_ROOM = 50
# How many of the most recent notes (across all rooms) go into additionalContext.
CONTEXT_NOTE_LIMIT = 12

Source = Literal["user", "chat"]


async def add_note(
    db: AsyncSession,
    room_id: str,
    text: str,
    source: Source,
    author: str | None = None,
) -> RoomNoteRecord:
    """Add a note to *room_id*, trimming to ``MAX_NOTE_LENGTH`` characters."""
    note = RoomNoteRecord(
        room_id=room_id, text=text.strip()[:MAX_NOTE_LENGTH], source=source, author=author
    )
    db.add(note)
    await db.flush()
    await _prune(db, room_id)
    await db.commit()
    await db.refresh(note)
    return note


async def _prune(db: AsyncSession, room_id: str) -> None:
    """Keep only the most recent ``MAX_NOTES_PER_ROOM`` notes for *room_id*."""
    result = await db.execute(
        select(RoomNoteRecord.id)
        .where(RoomNoteRecord.room_id == room_id)
        .order_by(desc(RoomNoteRecord.created_at))
        .offset(MAX_NOTES_PER_ROOM)
    )
    stale_ids = [row[0] for row in result.all()]
    if stale_ids:
        await db.execute(delete(RoomNoteRecord).where(RoomNoteRecord.id.in_(stale_ids)))


async def list_notes(
    db: AsyncSession, room_id: str | None = None, limit: int = MAX_NOTES_PER_ROOM
) -> list[RoomNoteRecord]:
    """Most-recent-first notes, optionally scoped to one room."""
    query = select(RoomNoteRecord).order_by(desc(RoomNoteRecord.created_at)).limit(limit)
    if room_id is not None:
        query = query.where(RoomNoteRecord.room_id == room_id)
    result = await db.execute(query)
    return list(result.scalars().all())


async def delete_note(db: AsyncSession, note_id: int) -> bool:
    result = await db.execute(select(RoomNoteRecord).where(RoomNoteRecord.id == note_id))
    if result.scalar_one_or_none() is None:
        return False
    await db.execute(delete(RoomNoteRecord).where(RoomNoteRecord.id == note_id))
    await db.commit()
    return True


async def build_context_block(db: AsyncSession) -> str | None:
    """Render the most recent notes as compact text for a hook's additionalContext.

    Returns None when there is nothing to say (the common case) so the
    caller can skip printing an empty/near-empty block.
    """
    notes = await list_notes(db, room_id=None, limit=CONTEXT_NOTE_LIMIT)
    if not notes:
        return None
    lines = [f"- [{n.room_id}] {n.text}" for n in reversed(notes)]
    return "Notes from the team (Claude Office knowledge board):\n" + "\n".join(lines)
