"""Tests for the failure hooks: PostToolUseFailure, PermissionDenied, StopFailure."""

from claude_office_hooks.event_mapper import map_event

SESSION_ID = "test-session-001"


def _map(event_type: str, raw: dict) -> dict:
    payload = map_event(event_type, {"session_id": SESSION_ID, **raw}, SESSION_ID)
    assert payload is not None
    return payload


class TestPostToolUseFailure:
    def test_maps_to_failed_post_tool_use(self) -> None:
        payload = _map(
            "post_tool_use_failure",
            {
                "tool_name": "Bash",
                "tool_use_id": "tu_1",
                "tool_input": {"command": "pytest"},
                "error": "exit code 1: 3 tests failed",
            },
        )
        assert payload["event_type"] == "post_tool_use"
        data = payload["data"]
        assert data["success"] is False
        assert data["error_type"] == "tool_failure"
        assert data["tool_name"] == "Bash"
        assert data["tool_input"] == {"command": "pytest"}
        assert data["message"] == "exit code 1: 3 tests failed"
        assert data["tool_use_id"] == "tu_1"
        assert data["agent_id"] == "main"

    def test_error_text_falls_back_to_tool_response(self) -> None:
        payload = _map(
            "post_tool_use_failure",
            {"tool_name": "Read", "tool_response": {"error": "ENOENT: no such file"}},
        )
        assert payload["data"]["message"] == "ENOENT: no such file"

    def test_error_text_defaults_when_nothing_usable(self) -> None:
        payload = _map("post_tool_use_failure", {"tool_name": "Edit", "tool_response": {}})
        assert payload["data"]["message"] == "Edit failed"

    def test_subagent_id_is_carried_as_native_agent_id(self) -> None:
        payload = _map(
            "post_tool_use_failure",
            {"tool_name": "Bash", "agent_id": "a5a60c7", "error": "boom"},
        )
        assert payload["data"]["native_agent_id"] == "a5a60c7"


class TestPermissionDenied:
    def test_maps_to_error_with_tool_context(self) -> None:
        payload = _map(
            "permission_denied",
            {
                "tool_name": "Bash",
                "tool_input": {"command": "rm -rf build"},
                "reason": "Destructive command blocked by auto mode",
            },
        )
        assert payload["event_type"] == "error"
        data = payload["data"]
        assert data["error_type"] == "permission_denied"
        assert data["tool_name"] == "Bash"
        assert data["tool_input"] == {"command": "rm -rf build"}
        assert data["reason"] == "Destructive command blocked by auto mode"
        assert data["message"] == "Destructive command blocked by auto mode"

    def test_message_defaults_to_tool_name(self) -> None:
        payload = _map("permission_denied", {"tool_name": "Write"})
        assert payload["data"]["message"] == "Permission denied for Write"


class TestStopFailure:
    def test_maps_to_error(self) -> None:
        payload = _map("stop_failure", {"error": "429 rate limit exceeded"})
        assert payload["event_type"] == "error"
        assert payload["data"]["error_type"] == "stop_failure"
        assert payload["data"]["message"] == "429 rate limit exceeded"

    def test_message_defaults_when_missing(self) -> None:
        payload = _map("stop_failure", {})
        assert payload["data"]["message"] == "Claude stopped with an error"
