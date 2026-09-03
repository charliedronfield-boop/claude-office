"""Tests for how failures and denials surface on the office characters."""

from datetime import UTC, datetime

from app.core.state_machine import StateMachine
from app.models.events import (
    AgentEventData,
    EventType,
    LifecycleEvent,
    LifecycleEventData,
    ToolEvent,
    ToolEventData,
)

SESSION = "sess_issues"


def _tool_failure(agent_id: str = "main", native_agent_id: str | None = None) -> ToolEvent:
    return ToolEvent(
        event_type=EventType.POST_TOOL_USE,
        session_id=SESSION,
        timestamp=datetime.now(UTC),
        data=ToolEventData(
            tool_name="Bash",
            tool_input={"command": "pytest"},
            success=False,
            error_type="tool_failure",
            message="exit code 1: 3 tests failed",
            agent_id=agent_id,
            native_agent_id=native_agent_id,
        ),
    )


def _denied(tool_name: str = "Write") -> LifecycleEvent:
    return LifecycleEvent(
        event_type=EventType.ERROR,
        session_id=SESSION,
        timestamp=datetime.now(UTC),
        data=LifecycleEventData(
            error_type="permission_denied",
            tool_name=tool_name,
            tool_input={"file_path": "/etc/hosts"},
            message="Write to /etc/hosts blocked",
            agent_id="main",
        ),
    )


class TestToolFailure:
    def test_failure_puts_bubble_on_boss_and_whiteboard(self) -> None:
        sm = StateMachine()
        sm.transition(_tool_failure())
        assert sm.boss_bubble is not None
        assert sm.boss_bubble.icon == "❌"
        assert "Bash failed" in sm.boss_bubble.text
        assert sm.whiteboard.news_items[0].category == "error"
        assert sm.tool_uses_since_compaction == 1

    def test_failure_inside_subagent_targets_that_agent(self) -> None:
        sm = StateMachine()
        agent = sm.create_agent(AgentEventData(agent_id="subagent_1", agent_type="editor"))
        agent.native_id = "a5a60c7"
        sm.agents[agent.id] = agent

        sm.transition(_tool_failure(agent_id="main", native_agent_id="a5a60c7"))
        assert sm.boss_bubble is None
        assert agent.bubble is not None
        assert agent.bubble.icon == "❌"

    def test_successful_tool_use_leaves_no_problem_bubble(self) -> None:
        sm = StateMachine()
        event = _tool_failure()
        event.data.success = True
        sm.transition(event)
        assert sm.boss_bubble is None


class TestErrorEvents:
    def test_permission_denied_shows_blocked_bubble(self) -> None:
        sm = StateMachine()
        sm.transition(_denied())
        assert sm.boss_bubble is not None
        assert sm.boss_bubble.icon == "⛔"
        assert "blocked" in sm.boss_bubble.text
        assert sm.whiteboard.news_items[0].headline.startswith("Permission denied")

    def test_other_errors_use_generic_icon(self) -> None:
        sm = StateMachine()
        event = _denied()
        event.data.error_type = "stop_failure"
        event.data.message = "429 rate limit"
        sm.transition(event)
        assert sm.boss_bubble is not None
        assert sm.boss_bubble.icon == "💥"
