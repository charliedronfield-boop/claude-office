"""Role-based rooms: cordoned desk columns with doorways, plus the meeting table.

Each of the four desk columns is a walled room dedicated to one production
role. Agents are routed to the room whose keywords match their
``subagent_type``; unknown roles land in the emptiest room.

The four room *slots* (id, column, desk numbers, wall/door geometry) are
fixed — the navigation grid's walls are baked around them. Their display
``name``, ``accent`` color and routing ``keywords`` are configurable at
runtime: ``DEFAULT_ROOMS`` below is the seed, and an optional override is
stored as JSON in the ``user_preferences`` table under
``ROOM_CONFIG_KEY`` (mirrors ``floor_config.py``'s ``building_config``).

Mirrored by ``frontend/src/systems/officeRooms.ts`` — keep the four slot ids
(and desk geometry) in sync; name/accent/keywords do not need to match since
those are fetched at runtime from ``GET /api/v1/rooms``.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from dataclasses import dataclass, replace
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.core.office_layout import DESK_ROW_SIZE

logger = logging.getLogger(__name__)

ROOM_CONFIG_KEY = "room_config"

# Fixed slot ids — the navigation grid's wall/door geometry (both backend
# office_layout.py constants and frontend officeRooms.ts) is keyed to these
# four columns and must not change without also reworking the nav grid.
SCRIPTING = "scripting"
EDITING = "editing"
THUMBNAILS_SEO = "thumbnails_seo"
PUBLISHING = "publishing"
SLOT_IDS: tuple[str, ...] = (SCRIPTING, EDITING, THUMBNAILS_SEO, PUBLISHING)
_SLOT_COLUMN: dict[str, int] = {slot: index for index, slot in enumerate(SLOT_IDS)}


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


DEFAULT_ROOMS: tuple[Room, ...] = (
    Room(
        id=SCRIPTING,
        name="Scripting",
        accent="#3B82F6",
        keywords=("script", "writ", "research", "outline", "hook", "story"),
        column=_SLOT_COLUMN[SCRIPTING],
    ),
    Room(
        id=EDITING,
        name="Editing",
        accent="#22C55E",
        keywords=("edit", "cut", "audio", "caption", "subtitle", "motion", "vfx"),
        column=_SLOT_COLUMN[EDITING],
    ),
    Room(
        id=THUMBNAILS_SEO,
        name="Thumbnails & SEO",
        accent="#A855F7",
        keywords=("thumb", "design", "seo", "metadata", "title", "tag", "keyword"),
        column=_SLOT_COLUMN[THUMBNAILS_SEO],
    ),
    Room(
        id=PUBLISHING,
        name="Publishing",
        accent="#F97316",
        keywords=("publish", "upload", "schedul", "analytic", "communit", "distribut", "promot"),
        column=_SLOT_COLUMN[PUBLISHING],
    ),
)

ALL_DESKS: tuple[int, ...] = tuple(range(1, DESK_ROW_SIZE * 2 + 1))


# ---------------------------------------------------------------------------
# Wire model for the override stored in user_preferences.
# ---------------------------------------------------------------------------


class RoomOverride(BaseModel):
    """Partial override for one of the four fixed room slots.

    Any field left unset keeps the default. ``id`` must be one of
    ``SLOT_IDS`` — the four physical room slots are fixed by the nav grid.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    name: str | None = None
    accent: str | None = None
    keywords: list[str] | None = None


class AgentTypeOverride(BaseModel):
    """Pin one exact ``subagent_type`` string to a fixed room slot.

    Checked before the keyword search in ``resolve_room`` — an escape hatch
    for agent types that don't (or shouldn't) match any room's keywords,
    e.g. spawning a generic ``general-purpose`` agent to do editing work.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    agent_type: str
    room_id: str


class RoomConfigOverrides(BaseModel):
    """Top-level shape of the ``room_config`` preference value."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    rooms: list[RoomOverride] = Field(default_factory=lambda: [])
    agent_type_overrides: list[AgentTypeOverride] = Field(default_factory=lambda: [])

    @classmethod
    def from_json(cls, json_str: str) -> RoomConfigOverrides:
        data: dict[str, Any] = json.loads(json_str)
        return cls.model_validate(data)


def apply_overrides(
    overrides: RoomConfigOverrides, base: tuple[Room, ...] = DEFAULT_ROOMS
) -> tuple[Room, ...]:
    """Merge *overrides* onto *base*, keeping slot order and unknown ids ignored."""
    by_id = {room.id: entry for room in base if (entry := _find(overrides.rooms, room.id))}
    merged: list[Room] = []
    for room in base:
        entry = by_id.get(room.id)
        if entry is None:
            merged.append(room)
            continue
        merged.append(
            replace(
                room,
                name=entry.name if entry.name is not None else room.name,
                accent=entry.accent if entry.accent is not None else room.accent,
                keywords=tuple(entry.keywords) if entry.keywords is not None else room.keywords,
            )
        )
    return tuple(merged)


def _find(entries: list[RoomOverride], room_id: str) -> RoomOverride | None:
    return next((e for e in entries if e.id == room_id), None)


# ---------------------------------------------------------------------------
# Module-level cache — mirrors floor_config.py's get_cached_building_config()
# / invalidate_building_config() so state_machine.create_agent() (sync, no DB
# access) can consult it directly.
# ---------------------------------------------------------------------------

_cached_rooms: tuple[Room, ...] | None = None
_cached_agent_type_pins: dict[str, str] | None = None


def get_cached_rooms() -> tuple[Room, ...]:
    """Return the cached room list, falling back to the built-in defaults."""
    return _cached_rooms if _cached_rooms is not None else DEFAULT_ROOMS


def get_cached_agent_type_pins() -> dict[str, str]:
    """Return the cached ``agent_type`` (lowercased) -> ``room_id`` pin map."""
    return _cached_agent_type_pins if _cached_agent_type_pins is not None else {}


def invalidate_rooms_cache() -> None:
    """Clear the cached rooms so the next ``load_rooms`` call reloads them."""
    global _cached_rooms, _cached_agent_type_pins
    _cached_rooms = None
    _cached_agent_type_pins = None


async def load_room_config_overrides(db: Any) -> RoomConfigOverrides:
    """Load the raw ``room_config`` override object (unapplied).

    Used both by ``load_rooms`` (to populate the resolve-time caches) and by
    the ``GET /rooms`` route (which needs the agent-type overrides' original
    casing for display — the cached pin map is lowercased for matching).
    Falls back to an empty overrides object on any error, mirroring the
    previous ``load_rooms`` behaviour of silently defaulting.

    Args:
        db: Async database session.
    """
    from sqlalchemy import select

    from app.db.models import UserPreference

    try:
        result = await db.execute(
            select(UserPreference).where(UserPreference.key == ROOM_CONFIG_KEY)
        )
        pref = result.scalar_one_or_none()
        if pref and pref.value:
            return RoomConfigOverrides.from_json(pref.value)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Invalid room_config preference, using default: %s", exc)
    except Exception:
        logger.exception("Error loading room_config")

    return RoomConfigOverrides()


async def load_rooms(db: Any) -> tuple[Room, ...]:
    """Load room overrides from the ``user_preferences`` table and cache them.

    Falls back to (and caches) ``DEFAULT_ROOMS`` if no preference is stored
    or the stored JSON is invalid.

    Args:
        db: Async database session.

    Returns:
        The resolved (default + override) room tuple.
    """
    global _cached_rooms, _cached_agent_type_pins

    overrides = await load_room_config_overrides(db)
    _cached_rooms = apply_overrides(overrides)
    _cached_agent_type_pins = {
        entry.agent_type.strip().lower(): entry.room_id
        for entry in overrides.agent_type_overrides
        if entry.agent_type.strip()
    }
    return _cached_rooms


# ---------------------------------------------------------------------------
# Routing helpers — consumed by state_machine.create_agent().
# ---------------------------------------------------------------------------


def room_by_id(room_id: str, rooms: tuple[Room, ...] | None = None) -> Room | None:
    for room in rooms if rooms is not None else get_cached_rooms():
        if room.id == room_id:
            return room
    return None


def desk_to_room(desk: int, rooms: tuple[Room, ...] | None = None) -> str | None:
    for room in rooms if rooms is not None else get_cached_rooms():
        if desk in room.desks:
            return room.id
    return None


def resolve_room(
    agent_type: str | None,
    used_desks: Iterable[int] = (),
    rooms: tuple[Room, ...] | None = None,
    agent_type_pins: dict[str, str] | None = None,
) -> str:
    """Return the room id for an agent type, falling back to the emptiest room.

    Resolution order: an exact ``agent_type_pins`` match wins outright (a
    user-configured escape hatch for types that shouldn't be keyword-routed),
    then the keyword search, then the emptiest room.
    """
    active_rooms = rooms if rooms is not None else get_cached_rooms()
    pins = agent_type_pins if agent_type_pins is not None else get_cached_agent_type_pins()
    needle = (agent_type or "").strip().lower()
    if needle:
        pinned_room_id = pins.get(needle)
        if pinned_room_id is not None and any(room.id == pinned_room_id for room in active_rooms):
            return pinned_room_id
        for room in active_rooms:
            if any(keyword in needle for keyword in room.keywords):
                return room.id

    used = set(used_desks)
    emptiest = max(
        active_rooms,
        key=lambda room: (sum(desk not in used for desk in room.desks), -room.column),
    )
    return emptiest.id


def pick_desk(
    room_id: str, used_desks: Iterable[int], rooms: tuple[Room, ...] | None = None
) -> int | None:
    """Lowest free desk inside ``room_id``, else the lowest free desk anywhere."""
    used = set(used_desks)
    room = room_by_id(room_id, rooms)
    preferred = list(room.desks) if room else []
    candidates = preferred + [desk for desk in ALL_DESKS if desk not in preferred]
    return next((desk for desk in candidates if desk not in used), None)
