"""API routes for the office room configuration (names/colors/keywords)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.office_rooms import load_rooms
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
        ]
    }
