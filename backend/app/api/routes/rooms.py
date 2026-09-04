"""API routes for the office room configuration (names/colors/keywords)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.office_rooms import load_room_config_overrides, load_rooms
from app.db.database import get_db

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.get("")
async def get_rooms(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, object]:
    """Return the current room configuration (default + any stored override).

    Mirrors ``GET /floors``: this call also warms the in-process cache that
    ``StateMachine.create_agent`` reads synchronously.
    """
    rooms = await load_rooms(db)
    # Re-read the raw overrides for agentTypeOverrides' original casing —
    # the resolve-time cache lowercases agentType for case-insensitive
    # matching, which would otherwise round-trip oddly into a settings form.
    overrides = await load_room_config_overrides(db)
    return {
        "rooms": [
            {
                "id": room.id,
                "name": room.name,
                "accent": room.accent,
                "keywords": list(room.keywords),
                "desks": list(room.desks),
            }
            for room in rooms
        ],
        "agentTypeOverrides": [
            {"agentType": entry.agent_type, "roomId": entry.room_id}
            for entry in overrides.agent_type_overrides
        ],
    }
