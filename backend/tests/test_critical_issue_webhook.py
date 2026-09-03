"""Tests for the optional critical-issue webhook (Settings.CRITICAL_ISSUE_WEBHOOK_URL).

Exercised only through EventProcessor.process_event() (the public API) —
_notify_critical_issue is a fire-and-forget implementation detail, not
something a caller invokes directly.
"""

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from app.config import get_settings
from app.core.event_processor import EventProcessor
from app.models.events import EventType, LifecycleEvent, LifecycleEventData


@pytest.fixture
def webhook_url() -> Iterator[str]:
    settings = get_settings()
    original = settings.CRITICAL_ISSUE_WEBHOOK_URL
    configured = "https://example.invalid/hook"
    settings.CRITICAL_ISSUE_WEBHOOK_URL = configured
    yield configured
    settings.CRITICAL_ISSUE_WEBHOOK_URL = original


def _error_event(error_type: str) -> LifecycleEvent:
    return LifecycleEvent(
        event_type=EventType.ERROR,
        session_id="sess_webhook",
        timestamp=datetime.now(UTC),
        data=LifecycleEventData(error_type=error_type, message="something broke", agent_id="main"),
    )


async def _process_and_flush(ep: EventProcessor, event: LifecycleEvent) -> None:
    await ep.process_event(event)
    # _notify_critical_issue schedules a background task; give the event
    # loop a couple of ticks to run it before asserting on the mock.
    await asyncio.sleep(0)
    await asyncio.sleep(0)


class TestCriticalIssueWebhook:
    @pytest.mark.asyncio
    async def test_noop_when_no_url_configured(self) -> None:
        settings = get_settings()
        original = settings.CRITICAL_ISSUE_WEBHOOK_URL
        settings.CRITICAL_ISSUE_WEBHOOK_URL = ""
        try:
            with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
                await _process_and_flush(EventProcessor(), _error_event("permission_denied"))
                assert mock_post.await_count == 0
        finally:
            settings.CRITICAL_ISSUE_WEBHOOK_URL = original

    @pytest.mark.asyncio
    async def test_permission_denied_posts_the_message(self, webhook_url: str) -> None:
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            await _process_and_flush(EventProcessor(), _error_event("permission_denied"))

        mock_post.assert_awaited_once()
        call = mock_post.await_args
        assert call is not None
        assert call.args[0] == webhook_url
        assert call.kwargs["json"]["sessionId"] == "sess_webhook"
        assert "something broke" in call.kwargs["json"]["text"]

    @pytest.mark.asyncio
    async def test_stop_failure_also_notifies(self, webhook_url: str) -> None:
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            await _process_and_flush(EventProcessor(), _error_event("stop_failure"))
        mock_post.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_other_error_types_do_not_notify(self, webhook_url: str) -> None:
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            await _process_and_flush(EventProcessor(), _error_event("tool_failure"))
        assert mock_post.await_count == 0

    @pytest.mark.asyncio
    async def test_a_failed_post_never_raises(self, webhook_url: str) -> None:
        with patch(
            "httpx.AsyncClient.post", new_callable=AsyncMock, side_effect=RuntimeError("boom")
        ):
            await _process_and_flush(EventProcessor(), _error_event("permission_denied"))
        # Reaching here without an unhandled exception is the assertion.
