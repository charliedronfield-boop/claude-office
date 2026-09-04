"""Tests for SendMessage -> agent_message mapping."""

from claude_office_hooks.event_mapper import map_event

SESSION_ID = "test-session-001"


def _map(raw: dict) -> dict:
    payload = map_event("pre_tool_use", {"session_id": SESSION_ID, **raw}, SESSION_ID)
    assert payload is not None
    return payload


class TestAgentMessage:
    def test_send_message_becomes_agent_message(self) -> None:
        payload = _map(
            {
                "tool_name": "SendMessage",
                "tool_use_id": "tu_msg",
                "tool_input": {
                    "to": "a5a60c7",
                    "message": "Keep the cold open under 15 seconds.",
                    "summary": "Hook under 15s",
                },
            }
        )
        assert payload["event_type"] == "agent_message"
        data = payload["data"]
        assert data["to"] == "a5a60c7"
        assert data["message_text"] == "Keep the cold open under 15 seconds."
        assert data["summary"] == "Hook under 15s"
        assert data["tool_use_id"] == "tu_msg"
        assert data["agent_id"] == "main"
        assert "tool_input" not in data

    def test_sender_inside_subagent_is_carried(self) -> None:
        payload = _map(
            {
                "tool_name": "SendMessage",
                "tool_input": {"to": "editor", "message": "hi"},
                "agent_id": "sa_1",
            }
        )
        assert payload["data"]["native_agent_id"] == "sa_1"

    def test_mcp_session_messaging_tool_is_recognised(self) -> None:
        payload = _map(
            {
                "tool_name": "mcp__ccd_session_mgmt__send_message",
                "tool_input": {"session_id": "sess_9", "message": "ping"},
            }
        )
        assert payload["event_type"] == "agent_message"
        assert payload["data"]["to"] == "sess_9"

    def test_long_messages_are_trimmed(self) -> None:
        payload = _map(
            {"tool_name": "SendMessage", "tool_input": {"to": "x", "message": "a" * 500}}
        )
        assert len(payload["data"]["message_text"]) == 240

    def test_other_tools_are_untouched(self) -> None:
        payload = _map({"tool_name": "Read", "tool_input": {"file_path": "/x"}})
        assert payload["event_type"] == "pre_tool_use"
