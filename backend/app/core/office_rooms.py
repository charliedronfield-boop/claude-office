"""Role-based rooms: cordoned desk columns with doorways, plus the meeting table.

Each of the four desk columns is a walled room dedicated to one production
role. Agents are routed to the room whose keywords match their
``subagent_type``; unknown roles land in the emptiest room.

Mirrored by ``frontend/src/systems/officeRooms.ts`` — keep both in sync.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from app.core.office_layout import DESK_ROW_SIZE


@dataclass(frozen=True)
class Room:
    id: str
    name: str
    accent: str
    keywords: tuple[str, ...]
    column: int

    @property
    def desks(self) -> tuple[int, ...]:
        return (self.column + 1, self.column + 1 + DESK_ROW_SIZE)


ROOMS: tuple[Room, ...] = (
    Room(
        id="scripting",
        name="Scripting",
        accent="#3B82F6",
        keywords=("script", "writ", "research", "outline", "hook", "story"),
        column=0,
    ),
    Room(
        id="editing",
        name="Editing",
        accent="#22C55E",
        keywords=("edit", "cut", "audio", "caption", "subtitle", "motion", "vfx"),
        column=1,
    ),
    Room(
        id="thumbnails_seo",
        name="Thumbnails & SEO",
        accent="#A855F7",
        keywords=("thumb", "design", "seo", "metadata", "title", "tag", "keyword"),
        column=2,
    ),
    Room(
        id="publishing",
        name="Publishing",
        accent="#F97316",
        keywords=("publish", "upload", "schedul", "analytic", "communit", "distribut", "promot"),
        column=3,
    ),
)

ROOM_BY_ID: dict[str, Room] = {room.id: room for room in ROOMS}
DESK_TO_ROOM: dict[int, str] = {desk: room.id for room in ROOMS for desk in room.desks}
ALL_DESKS: tuple[int, ...] = tuple(range(1, DESK_ROW_SIZE * 2 + 1))


def resolve_room(agent_type: str | None, used_desks: Iterable[int] = ()) -> str:
    """Return the room id for an agent type, falling back to the emptiest room."""
    needle = (agent_type or "").lower()
    if needle:
        for room in ROOMS:
            if any(keyword in needle for keyword in room.keywords):
                return room.id

    used = set(used_desks)
    emptiest = max(
        ROOMS,
        key=lambda room: (sum(desk not in used for desk in room.desks), -room.column),
    )
    return emptiest.id


def pick_desk(room_id: str, used_desks: Iterable[int]) -> int | None:
    """Lowest free desk inside ``room_id``, else the lowest free desk anywhere."""
    used = set(used_desks)
    room = ROOM_BY_ID.get(room_id)
    preferred = list(room.desks) if room else []
    candidates = preferred + [desk for desk in ALL_DESKS if desk not in preferred]
    return next((desk for desk in candidates if desk not in used), None)
