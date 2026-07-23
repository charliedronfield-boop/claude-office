"""WebSocket routes for the Claude Office backend.

Moved out of ``app.main`` in ARC-023. The three endpoints register on a
dedicated ``APIRouter`` that ``app.main`` includes without a prefix.

Declaration order is load-bearing: ``/ws/overview`` and ``/ws/multi`` MUST be
registered before ``/ws/{session_id}`` so those single-segment paths aren't
captured by the session-id route (which would treat "overview"/"multi" as a
session id, accept, find no state, and silently idle).
"""

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.websocket import get_manager
from app.core.event_processor import get_event_processor
from app.services.git_service import git_service

logger = logging.getLogger(__name__)

# Upper bound on concurrent /ws/overview (Command Center) watchers. Each one
# amplifies the per-event overview rebuild cost, so refuse new ones past this.
_MAX_OVERVIEW_CONNECTIONS = 16

# LOCAL PATCH: upper bound on concurrent /ws/multi (multi-session office)
# watchers. Same rationale as overview — each one amplifies the per-event
# rebuild cost, and this feed's payload is larger (full agent detail, not
# just boss summaries), so kept at the same cap rather than higher.
_MAX_MULTI_CONNECTIONS = 16

router = APIRouter()


@router.websocket("/ws/overview")
async def websocket_overview(websocket: WebSocket) -> None:
    """Overview WebSocket: boss status of every live session (Command Center).

    Declared BEFORE ``/ws/{session_id}`` so the single-segment path ``/ws/overview``
    isn't captured by the session route (which would treat "overview" as a session
    id, accept, find no state, and silently idle).
    """
    from app.api.websocket import validate_websocket_origin

    if not validate_websocket_origin(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    # Cap concurrent overview watchers: each connection amplifies the per-event
    # overview rebuild cost, so refuse beyond the limit instead of letting it
    # grow unbounded. The check is enforced atomically with the registration
    # inside connect_overview (under the manager lock) so a burst of concurrent
    # handshakes can't each pass the limit before any registers.
    accepted = await get_manager().connect_overview(
        websocket, max_connections=_MAX_OVERVIEW_CONNECTIONS
    )
    if not accepted:
        await websocket.close(code=4013, reason="Too many overview connections")
        return
    try:
        # Send the current overview snapshot on connect. Built under the same
        # ``_sessions_lock`` used by the per-event broadcast so it reads a
        # consistent registry snapshot and can't race a concurrent event handler
        # resizing ``sessions`` mid-iteration.
        overview = await get_event_processor().build_overview_snapshot()
        await websocket.send_json(
            {
                "type": "state_update",
                "timestamp": overview.last_updated.isoformat(),
                "state": overview.model_dump(mode="json", by_alias=True),
            }
        )
        # Keep alive -- discard incoming messages
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.warning("Overview WebSocket error", exc_info=True)
    finally:
        await get_manager().disconnect_overview(websocket)


@router.websocket("/ws/multi")
async def websocket_multi(websocket: WebSocket) -> None:
    """Multi-session WebSocket: full agent detail for every live session.

    LOCAL PATCH. Mirrors ``/ws/overview`` exactly (same origin check,
    connection cap pattern, keep-alive loop), but the payload is each
    session's complete ``GameState`` (boss AND subagents) instead of
    boss-only summaries — this is what the multi-session office view
    consumes to render every active session's agents together.

    Declared BEFORE ``/ws/{session_id}`` so the single-segment path
    ``/ws/multi`` isn't captured by the session route.
    """
    from app.api.websocket import validate_websocket_origin

    if not validate_websocket_origin(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    accepted = await get_manager().connect_multi(websocket, max_connections=_MAX_MULTI_CONNECTIONS)
    if not accepted:
        await websocket.close(code=4013, reason="Too many multi-session connections")
        return
    try:
        # Send the current full snapshot on connect, under the same
        # ``_sessions_lock`` used by the per-event broadcast (see
        # build_multi_snapshot), for the same consistent-registry-read reason
        # as the overview connect path above.
        multi = await get_event_processor().build_multi_snapshot()
        await websocket.send_json(
            {
                "type": "state_update",
                "timestamp": multi.last_updated.isoformat(),
                "state": multi.model_dump(mode="json", by_alias=True),
            }
        )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.warning("Multi-session WebSocket error", exc_info=True)
    finally:
        await get_manager().disconnect_multi(websocket)


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    from app.api.websocket import validate_session_id, validate_websocket_origin

    if not validate_session_id(session_id):
        await websocket.close(code=4000, reason="Invalid session ID format")
        return

    if not validate_websocket_origin(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    await get_manager().connect(websocket, session_id)

    current_state = await get_event_processor().get_current_state(session_id)
    if current_state:
        await get_manager().send_personal_message(
            {
                "type": "state_update",
                "timestamp": current_state.last_updated.isoformat(),
                "state": current_state.model_dump(mode="json", by_alias=True),
            },
            websocket,
        )

    project_root = await get_event_processor().get_project_root(session_id)
    if project_root:
        git_service.configure(session_id=session_id, project_root=project_root)

    git_status = git_service.get_status(session_id=session_id)
    if git_status:
        await get_manager().send_personal_message(
            {
                "type": "git_status",
                "timestamp": git_status.last_updated.isoformat(),
                "gitStatus": git_status.model_dump(mode="json"),
            },
            websocket,
        )

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await get_manager().disconnect(websocket, session_id)
        git_service.remove_session(session_id)


@router.websocket("/ws/room/{room_id}")
async def websocket_room(websocket: WebSocket, room_id: str) -> None:
    """Room-level WebSocket: sends merged state for all sessions in a room."""
    from app.api.websocket import validate_session_id, validate_websocket_origin

    if not validate_session_id(room_id):
        await websocket.close(code=4000, reason="Invalid room ID format")
        return

    if not validate_websocket_origin(websocket):
        await websocket.close(code=4003, reason="Origin not allowed")
        return

    from app.core.room_orchestrator import RoomOrchestrator

    await get_manager().connect_room(websocket, room_id)
    try:
        # Send current room state on connect
        orch: RoomOrchestrator | None = get_event_processor().orchestrators.get(room_id)
        if orch:
            state = orch.merge()
            if state:
                await websocket.send_json(
                    {
                        "type": "state_update",
                        "timestamp": state.last_updated.isoformat(),
                        "state": state.model_dump(mode="json", by_alias=True),
                    }
                )
        # Keep alive -- discard incoming messages
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.warning("Room WebSocket error for %s", room_id, exc_info=True)
    finally:
        await get_manager().disconnect_room(websocket, room_id)
