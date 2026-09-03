"""API routes for user preferences."""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.floor_config import invalidate_building_config
from app.core.office_rooms import invalidate_rooms_cache
from app.core.product_mapper import invalidate_product_mapper
from app.db.database import get_db
from app.db.models import UserPreference

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/preferences", tags=["preferences"])


class PreferenceValue(BaseModel):
    """Request body for setting a preference value."""

    value: str


@router.get("")
async def get_all_preferences(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    """Get all user preferences as a dictionary."""
    try:
        result = await db.execute(select(UserPreference))
        preferences = result.scalars().all()
        return {pref.key: pref.value for pref in preferences}
    except Exception as e:
        logger.exception("Error fetching preferences: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch preferences") from e


@router.get("/{key}")
async def get_preference(
    key: str, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, str | None]:
    """Get a single preference by key."""
    try:
        result = await db.execute(select(UserPreference).where(UserPreference.key == key))
        pref = result.scalar_one_or_none()
        return {"key": key, "value": pref.value if pref else None}
    except Exception as e:
        logger.exception("Error fetching preference %s: %s", key, e)
        raise HTTPException(status_code=500, detail="Failed to fetch preference") from e


@router.put("/{key}")
async def set_preference(
    key: str,
    body: PreferenceValue,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, str]:
    """Set a preference value. Creates or updates the preference."""
    try:
        # Validate config values against their schema before persisting.
        if key == "building_config":
            _validate_building_config(body.value)
        elif key == "room_config":
            _validate_room_config(body.value)

        result = await db.execute(select(UserPreference).where(UserPreference.key == key))
        pref = result.scalar_one_or_none()

        if pref:
            pref.value = body.value
        else:
            pref = UserPreference(key=key, value=body.value)
            db.add(pref)

        await db.commit()

        # Invalidate cached floor/mapper/room data so the next request picks up changes.
        if key == "building_config":
            invalidate_building_config()
            invalidate_product_mapper()
        elif key == "room_config":
            invalidate_rooms_cache()

        return {"key": key, "value": body.value}
    except HTTPException:
        # A schema-validation 400 from _validate_building_config/_validate_room_config
        # above — re-raise as-is instead of falling into the generic 500 handler
        # below (that except Exception previously masked every 400 into a 500).
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("Error setting preference %s: %s", key, e)
        raise HTTPException(status_code=500, detail="Failed to set preference") from e


@router.delete("/{key}")
async def delete_preference(
    key: str, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, str]:
    """Delete a preference by key."""
    try:
        # First check if the preference exists
        check_result = await db.execute(select(UserPreference).where(UserPreference.key == key))
        if check_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail=f"Preference '{key}' not found")

        await db.execute(delete(UserPreference).where(UserPreference.key == key))
        await db.commit()

        # Invalidate cached floor/mapper/room data when the config is removed.
        if key == "building_config":
            invalidate_building_config()
            invalidate_product_mapper()
        elif key == "room_config":
            invalidate_rooms_cache()

        return {"status": "success", "message": f"Preference '{key}' deleted"}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.exception("Error deleting preference %s: %s", key, e)
        raise HTTPException(status_code=500, detail="Failed to delete preference") from e


def _validate_building_config(value: str) -> None:
    """Validate that a JSON string conforms to the BuildingConfig schema.

    Args:
        value: JSON string to validate.

    Raises:
        HTTPException: If the value is not valid JSON or doesn't match the schema.
    """
    from app.core.floor_config import BuildingConfig

    try:
        BuildingConfig.from_json(value)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid building_config: {exc}",
        ) from exc


def _validate_room_config(value: str) -> None:
    """Validate that a JSON string conforms to the RoomConfigOverrides schema.

    Each override's ``id`` must be one of the four fixed room slots — the
    nav grid's walls are keyed to those ids and cannot be renamed.

    Args:
        value: JSON string to validate.

    Raises:
        HTTPException: If the value is not valid JSON, doesn't match the
            schema, or references an unknown room id.
    """
    from app.core.office_rooms import SLOT_IDS, RoomConfigOverrides

    try:
        overrides = RoomConfigOverrides.from_json(value)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid room_config: {exc}") from exc

    unknown = [entry.id for entry in overrides.rooms if entry.id not in SLOT_IDS]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid room_config: unknown room id(s) {unknown}, "
                f"expected one of {list(SLOT_IDS)}"
            ),
        )
