"""Tests for the shared knowledge board (room_notes.py + its routes)."""

import asyncio
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.room_notes import (
    MAX_NOTE_LENGTH,
    MAX_NOTES_PER_ROOM,
    add_note,
    build_context_block,
    delete_note,
    list_notes,
)
from app.core.state_machine import StateMachine
from app.db.database import AsyncSessionLocal
from app.db.models import RoomNoteRecord
from app.main import app
from app.models.events import AgentEventData, AgentMessageEvent, AgentMessageEventData, EventType

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_room_notes() -> None:  # pyright: ignore[reportUnusedFunction]
    """The shared test DB (see conftest.db_session) has no per-test rollback,
    so every test in this module starts from an empty room_notes table."""

    async def _clear() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RoomNoteRecord))
            await db.commit()

    asyncio.run(_clear())


class TestAddAndListNotes:
    @pytest.mark.asyncio
    async def test_add_then_list_round_trips(self, db_session: AsyncSession) -> None:
        note = await add_note(db_session, "editing", "Trim the cold open to 12s", source="user")
        assert note.room_id == "editing"
        assert note.text == "Trim the cold open to 12s"
        assert note.source == "user"

        notes = await list_notes(db_session, room_id="editing")
        assert [n.id for n in notes] == [note.id]

    @pytest.mark.asyncio
    async def test_notes_are_trimmed_to_max_length(self, db_session: AsyncSession) -> None:
        note = await add_note(db_session, "editing", "x" * 900, source="user")
        assert len(note.text) == MAX_NOTE_LENGTH

    @pytest.mark.asyncio
    async def test_list_scoped_to_room_excludes_other_rooms(self, db_session: AsyncSession) -> None:
        await add_note(db_session, "editing", "for editors", source="user")
        await add_note(db_session, "scripting", "for scripters", source="user")
        editing_notes = await list_notes(db_session, room_id="editing")
        assert [n.text for n in editing_notes] == ["for editors"]

    @pytest.mark.asyncio
    async def test_old_notes_are_pruned_beyond_the_cap(self, db_session: AsyncSession) -> None:
        for i in range(MAX_NOTES_PER_ROOM + 5):
            await add_note(db_session, "editing", f"note {i}", source="user")
        notes = await list_notes(db_session, room_id="editing", limit=MAX_NOTES_PER_ROOM + 10)
        assert len(notes) == MAX_NOTES_PER_ROOM
        # The most recent ones survive (highest indices), oldest are pruned.
        assert notes[0].text == f"note {MAX_NOTES_PER_ROOM + 4}"


class TestDeleteNote:
    @pytest.mark.asyncio
    async def test_delete_removes_it(self, db_session: AsyncSession) -> None:
        note = await add_note(db_session, "editing", "temp", source="user")
        assert await delete_note(db_session, note.id) is True
        assert await list_notes(db_session, room_id="editing") == []

    @pytest.mark.asyncio
    async def test_delete_unknown_id_returns_false(self, db_session: AsyncSession) -> None:
        assert await delete_note(db_session, 999999) is False


class TestContextBlock:
    @pytest.mark.asyncio
    async def test_empty_board_returns_none(self, db_session: AsyncSession) -> None:
        assert await build_context_block(db_session) is None

    @pytest.mark.asyncio
    async def test_renders_notes_oldest_first_with_room_tags(
        self, db_session: AsyncSession
    ) -> None:
        await add_note(db_session, "editing", "first", source="user")
        await add_note(db_session, "scripting", "second", source="chat")
        block = await build_context_block(db_session)
        assert block is not None
        assert block.index("[editing] first") < block.index("[scripting] second")


class TestAgentMessageWritesANote:
    def test_chat_resolver_inputs_point_at_the_recipient_room(self) -> None:
        """sm.transition() resolves the visual/chat side; EventProcessor (async,
        DB-backed — see TestAgentMessageEndToEnd below) does the note write."""
        sm = StateMachine()
        scripter = sm.create_agent(AgentEventData(agent_id="scripter", agent_type="script-writer"))
        sm.agents[scripter.id] = scripter
        editor = sm.create_agent(AgentEventData(agent_id="editor", agent_type="video-editor"))
        sm.agents[editor.id] = editor

        event = AgentMessageEvent(
            event_type=EventType.AGENT_MESSAGE,
            session_id="sess_notes",
            timestamp=datetime.now(UTC),
            data=AgentMessageEventData(
                agent_id="scripter", to="editor", message_text="Cold open is 12s now"
            ),
        )
        sm.transition(event)
        assert sm.agents["editor"].room_id == "editing"


class TestAgentMessageEndToEnd:
    """A real agent_message POST (through /events, the hook's own path) pins a note."""

    def test_chat_between_agents_creates_a_note_in_the_recipient_room(self) -> None:
        session_id = "sess_notes_e2e"
        now = datetime.now(UTC).isoformat()

        client.post(
            "/api/v1/events",
            json={
                "event_type": "subagent_start",
                "session_id": session_id,
                "timestamp": now,
                "data": {"agent_id": "e2e_scripter", "agent_type": "script-writer"},
            },
        )
        client.post(
            "/api/v1/events",
            json={
                "event_type": "subagent_start",
                "session_id": session_id,
                "timestamp": now,
                "data": {"agent_id": "e2e_editor", "agent_type": "video-editor"},
            },
        )
        response = client.post(
            "/api/v1/events",
            json={
                "event_type": "agent_message",
                "session_id": session_id,
                "timestamp": now,
                "data": {
                    "agent_id": "e2e_scripter",
                    "to": "e2e_editor",
                    "message_text": "Cold open is 12s now, matches the script",
                },
            },
        )
        assert response.status_code == 200

        notes = client.get("/api/v1/room-notes?room_id=editing").json()["notes"]
        assert any("Cold open is 12s now" in n["text"] for n in notes)


class TestRoomNotesRoute:
    def test_post_then_get_round_trips(self) -> None:
        response = client.post(
            "/api/v1/room-notes",
            json={"roomId": "editing", "text": "Route-level note"},
        )
        assert response.status_code == 200
        created = response.json()
        assert created["roomId"] == "editing"
        assert created["text"] == "Route-level note"
        assert created["source"] == "user"

        listed = client.get("/api/v1/room-notes?room_id=editing").json()["notes"]
        assert any(n["id"] == created["id"] for n in listed)

        delete_response = client.delete(f"/api/v1/room-notes/{created['id']}")
        assert delete_response.status_code == 200

    def test_rejects_an_unknown_room_id(self) -> None:
        response = client.post("/api/v1/room-notes", json={"roomId": "marketing", "text": "nope"})
        assert response.status_code == 400

    def test_created_at_is_a_timezone_aware_utc_string(self) -> None:
        """A naive isoformat() string (no Z/+00:00) parses as *local* time in
        JS's `new Date(...)`, which would misdisplay every note's age by the
        viewer's UTC offset. SQLite drops tzinfo on round-trip even for a
        DateTime(timezone=True) column, so this only catches a regression if
        the route stops re-attaching it (see NoteOut.from_record)."""
        response = client.post("/api/v1/room-notes", json={"roomId": "editing", "text": "tz check"})
        created_at = response.json()["createdAt"]
        assert created_at.endswith("+00:00") or created_at.endswith("Z")

    def test_context_endpoint_returns_a_string_or_null(self) -> None:
        response = client.get("/api/v1/room-notes/context")
        assert response.status_code == 200
        assert "context" in response.json()

    def test_delete_unknown_note_is_404(self) -> None:
        response = client.delete("/api/v1/room-notes/999999999")
        assert response.status_code == 404

    def test_no_api_key_required(self) -> None:
        """Notes can't execute anything, so they're intentionally ungated."""
        response = client.post(
            "/api/v1/room-notes", json={"roomId": "editing", "text": "no key needed"}
        )
        assert response.status_code == 200
