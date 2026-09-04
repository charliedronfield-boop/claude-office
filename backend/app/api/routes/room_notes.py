"""API routes for the shared knowledge board (room-scoped notes).

Not gated behind the API key: unlike /focus, /sessions/simulate or
/permissions/.../decide, a note can't execute anything or touch the
filesystem — worst case it's spam on a whiteboard only you and your own
agents ever see.
"""

from __future__ import annotations

from datetime import UTC
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.office_rooms import SLOT_IDS
from app.core.room_notes import (
    MAX_NOTE_LENGTH,
    add_note,
    build_context_block,
    delete_note,
    list_notes,
)
from app.db.database import get_db
from app.db.models import RoomNoteRecord

router = APIRouter(prefix="/room-notes", tags=["room-notes"])


class NoteOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: int
    room_id: str
    text: str
    source: str
    author: str | None
    created_at: str

    @classmethod
    def from_record(cls, record: RoomNoteRecord) -> NoteOut:
        # SQLite drops tzinfo on round-trip even for a DateTime(timezone=True)
        # column, so a naive value here is always really UTC — re-attach it
        # rather than let isoformat() emit an offset-less string (which
        # `new Date(...)` on the frontend would parse as local time). Same
        # idiom as app/api/routes/sessions.py's created_utc/updated_utc.
        created_utc = (
            record.created_at.astimezone(UTC)
            if record.created_at.tzinfo
            else record.created_at.replace(tzinfo=UTC)
        )
        return cls(
            id=record.id,
            room_id=record.room_id,
            text=record.text,
            source=record.source,
            author=record.author,
            created_at=created_utc.isoformat(),
        )


class CreateNoteRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    room_id: str
    text: str = Field(min_length=1, max_length=MAX_NOTE_LENGTH)
    author: str | None = None


@router.get("")
async def get_notes(
    db: Annotated[AsyncSession, Depends(get_db)],
    room_id: str | None = None,
) -> dict[str, list[NoteOut]]:
    notes = await list_notes(db, room_id=room_id)
    return {"notes": [NoteOut.from_record(n) for n in notes]}


@router.get("/context")
async def get_context_block(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str | None]:
    """Rendered text for the UserPromptSubmit hook's additionalContext."""
    return {"context": await build_context_block(db)}


@router.post("")
async def create_note(
    body: CreateNoteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> NoteOut:
    if body.room_id not in SLOT_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown room id {body.room_id!r}")
    note = await add_note(db, body.room_id, body.text, source="user", author=body.author)
    return NoteOut.from_record(note)


@router.delete("/{note_id}")
async def remove_note(
    note_id: int, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, bool]:
    deleted = await delete_note(db, note_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"deleted": True}
