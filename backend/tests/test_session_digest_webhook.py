"""Tests for the optional end-of-session digest webhook
(Settings.SESSION_DIGEST_WEBHOOK_URL).

Exercised only through EventProcessor.process_event() (the public API) —
_notify_session_digest is a fire-and-forget implementation detail, not
something a caller invokes directly.
"""

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from app.config import get_settings
from app.core.event_processor import EventProcessor
from app.models.events import (
    AgentMessageEvent,
    AgentMessageEventData,
    EventType,
    SessionEvent,
    SessionEventData,
    ToolEvent,
    ToolEventData,
)

SESSION = "sess_digest"


@pytest.fixture
def digest_url() -> Iterator[str]:
    settings = get_settings()
    original = settings.SESSION_DIGEST_WEBHOOK_URL
    configured = "https://example.invalid/digest"
    settings.SESSION_DIGEST_WEBHOOK_URL = configured
    yield configured
    settings.SESSION_DIGEST_WEBHOOK_URL = original


def _start() -> SessionEvent:
    return SessionEvent(
        event_type=EventType.SESSION_START,
        session_id=SESSION,
        timestamp=datetime.now(UTC),
        data=SessionEventData(agent_id="main"),
    )


def _tool_call(success: bool) -> ToolEvent:
    return ToolEvent(
        event_type=EventType.POST_TOOL_USE,
        session_id=SESSION,
        timestamp=datetime.now(UTC),
        data=ToolEventData(tool_name="Bash", success=success, agent_id="main"),
    )


def _chat() -> AgentMessageEvent:
    return AgentMessageEvent(
        event_type=EventType.AGENT_MESSAGE,
        session_id=SESSION,
        timestamp=datetime.now(UTC),
        data=AgentMessageEventData(agent_id="main", to="a1", message_text="hi"),
    )


def _end() -> SessionEvent:
    return SessionEvent(
        event_type=EventType.SESSION_END,
        session_id=SESSION,
        timestamp=datetime.now(UTC),
        data=SessionEventData(agent_id="main"),
    )


async def _process_and_flush(ep: EventProcessor, *events: object) -> None:
    for event in events:
        await ep.process_event(event)  # type: ignore[arg-type]
    # _notify_session_digest schedules a background task; give the event
    # loop a couple of ticks to run it before asserting on the mock.
    await asyncio.sleep(0)
    await asyncio.sleep(0)


class TestSessionDigestWebhook:
    @pytest.mark.asyncio
    async def test_noop_when_no_url_configured(self) -> None:
        settings = get_settings()
        original = settings.SESSION_DIGEST_WEBHOOK_URL
        settings.SESSION_DIGEST_WEBHOOK_URL = ""
        try:
            with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
                await _process_and_flush(EventProcessor(), _start(), _end())
                assert mock_post.await_count == 0
        finally:
            settings.SESSION_DIGEST_WEBHOOK_URL = original

    @pytest.mark.asyncio
    async def test_posts_a_tally_at_session_end(self, digest_url: str) -> None:
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            await _process_and_flush(
                EventProcessor(),
                _start(),
                _tool_call(True),
                _tool_call(True),
                _tool_call(False),
                _chat(),
                _end(),
            )

        mock_post.assert_awaited_once()
        call = mock_post.await_args
        assert call is not None
        assert call.args[0] == digest_url
        assert call.kwargs["json"]["sessionId"] == SESSION
        text = call.kwargs["json"]["text"]
        assert "3 tool call" in text
        assert "1 failed" in text
        assert "1 chat" in text

    @pytest.mark.asyncio
    async def test_only_fires_at_session_end_not_on_every_event(self, digest_url: str) -> None:
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            await _process_and_flush(EventProcessor(), _start(), _tool_call(True))
        assert mock_post.await_count == 0

    @pytest.mark.asyncio
    async def test_a_failed_post_never_raises(self, digest_url: str) -> None:
        with patch(
            "httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=RuntimeError("boom")
        ):
            await _process_and_flush(EventProcessor(), _start(), _end())
        # Reaching here without an unhandled exception is the assertion.
