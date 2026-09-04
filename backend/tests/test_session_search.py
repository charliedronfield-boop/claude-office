"""Tests for GET /sessions/search — free-text search across every session's
persisted event history.
"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.core.event_processor import EventProcessor
from app.main import app
from app.models.events import EventType, SessionEvent, SessionEventData, ToolEvent, ToolEventData

client = TestClient(app)


def _start(session_id: str) -> SessionEvent:
    return SessionEvent(
        event_type=EventType.SESSION_START,
        session_id=session_id,
        timestamp=datetime.now(UTC),
        data=SessionEventData(agent_id="main"),
    )


def _tool_call(session_id: str, message: str, *, success: bool = True) -> ToolEvent:
    return ToolEvent(
        event_type=EventType.POST_TOOL_USE,
        session_id=session_id,
        timestamp=datetime.now(UTC),
        data=ToolEventData(tool_name="Bash", success=success, message=message, agent_id="main"),
    )


@pytest.mark.asyncio
class TestSessionSearch:
    async def test_finds_a_match_by_message_text(self) -> None:
        ep = EventProcessor()
        await ep.process_event(_start("sess_search_a"))
        await ep.process_event(
            _tool_call("sess_search_a", "publish failed: quota exceeded", success=False)
        )

        response = client.get("/api/v1/sessions/search", params={"q": "quota exceeded"})
        assert response.status_code == 200
        results = response.json()
        assert any(r["sessionId"] == "sess_search_a" for r in results)
        match = next(r for r in results if r["sessionId"] == "sess_search_a")
        assert "quota exceeded" in match["snippet"]
        assert match["eventType"] == "post_tool_use"

    async def test_search_is_case_insensitive(self) -> None:
        ep = EventProcessor()
        await ep.process_event(_start("sess_search_b"))
        await ep.process_event(_tool_call("sess_search_b", "Thumbnail Render Complete"))

        response = client.get("/api/v1/sessions/search", params={"q": "thumbnail render"})
        assert response.status_code == 200
        assert any(r["sessionId"] == "sess_search_b" for r in response.json())

    async def test_no_match_returns_an_empty_list(self) -> None:
        response = client.get(
            "/api/v1/sessions/search", params={"q": "definitely-not-a-real-string-xyz"}
        )
        assert response.status_code == 200
        assert response.json() == []

    async def test_event_type_filter_narrows_results(self) -> None:
        ep = EventProcessor()
        await ep.process_event(_start("sess_search_c"))
        await ep.process_event(_tool_call("sess_search_c", "narrow-filter-marker"))

        matching = client.get(
            "/api/v1/sessions/search",
            params={"q": "narrow-filter-marker", "event_type": "post_tool_use"},
        )
        assert any(r["sessionId"] == "sess_search_c" for r in matching.json())

        non_matching = client.get(
            "/api/v1/sessions/search",
            params={"q": "narrow-filter-marker", "event_type": "session_end"},
        )
        assert non_matching.json() == []

    async def test_requires_a_query(self) -> None:
        response = client.get("/api/v1/sessions/search")
        assert response.status_code == 422

    async def test_results_are_newest_first(self) -> None:
        ep = EventProcessor()
        await ep.process_event(_start("sess_search_d"))
        await ep.process_event(_tool_call("sess_search_d", "order-marker first"))
        await ep.process_event(_tool_call("sess_search_d", "order-marker second"))

        response = client.get("/api/v1/sessions/search", params={"q": "order-marker"})
        results = [r for r in response.json() if r["sessionId"] == "sess_search_d"]
        assert len(results) == 2
        assert results[0]["snippet"].endswith("second")
        assert results[1]["snippet"].endswith("first")
