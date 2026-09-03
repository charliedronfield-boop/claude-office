"""Tests for the /permissions approve/deny routes (end-to-end through the app)."""

from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.permission_gate import get_permission_gate
from app.main import app

client = TestClient(app)
# POST .../decide is state-changing (a real approve/deny) and is gated by
# ApiKeyMiddleware the same way /focus and /sessions/simulate are — see
# test_security_hardening.py::TestStateChangingEndpointAuth for the auth
# behavior itself; these tests just need the header to reach the handler.
_AUTH_HEADERS = {"X-API-Key": get_settings().effective_api_key}


class TestWaitRoute:
    def test_unknown_id_returns_no_decision_quickly(self) -> None:
        response = client.get("/api/v1/permissions/route_unknown/wait?timeout=0.05")
        assert response.status_code == 200
        assert response.json() == {"decision": None, "found": False}

    def test_returns_the_decision_once_made(self) -> None:
        gate = get_permission_gate()
        gate.register("route_tu_1", "sess_1", "main", "Bash", {"command": "ls"})
        gate.decide("route_tu_1", "allow", "looked safe")

        response = client.get("/api/v1/permissions/route_tu_1/wait?timeout=1")
        assert response.status_code == 200
        assert response.json() == {"decision": "allow", "reason": "looked safe", "found": True}

    def test_timeout_is_capped_at_the_server_maximum(self) -> None:
        # A request for an absurd timeout must not be honoured verbatim —
        # FastAPI's Query(le=MAX_WAIT_SECONDS) rejects it outright.
        response = client.get("/api/v1/permissions/route_tu_2/wait?timeout=999999")
        assert response.status_code == 422


class TestDecideRoute:
    def test_decide_allow_marks_the_pending_request(self) -> None:
        gate = get_permission_gate()
        gate.register("route_tu_3", "sess_1", "main", "Write", {"file_path": "/x"})

        response = client.post(
            "/api/v1/permissions/route_tu_3/decide",
            json={"decision": "allow"},
            headers=_AUTH_HEADERS,
        )
        assert response.status_code == 200
        assert response.json() == {
            "status": "decided",
            "toolUseId": "route_tu_3",
            "decision": "allow",
        }
        assert gate.get("route_tu_3").decision == "allow"  # type: ignore[union-attr]

    def test_decide_unknown_id_is_a_no_op_not_an_error(self) -> None:
        response = client.post(
            "/api/v1/permissions/route_never_registered/decide",
            json={"decision": "deny"},
            headers=_AUTH_HEADERS,
        )
        assert response.status_code == 200
        assert response.json()["status"] == "not_found"

    def test_rejects_a_decision_outside_the_allow_deny_enum(self) -> None:
        gate = get_permission_gate()
        gate.register("route_tu_4", "sess_1", "main", "Bash", None)
        response = client.post(
            "/api/v1/permissions/route_tu_4/decide",
            json={"decision": "maybe"},
            headers=_AUTH_HEADERS,
        )
        assert response.status_code == 422


class TestListPendingRoute:
    def test_lists_only_undecided_requests(self) -> None:
        gate = get_permission_gate()
        gate.register("route_tu_5", "sess_list", "a1", "Bash", {"command": "ls"})
        gate.register("route_tu_6", "sess_list", "a2", "Write", None)
        gate.decide("route_tu_6", "allow", None)

        response = client.get("/api/v1/permissions?session_id=sess_list")
        assert response.status_code == 200
        ids = [entry["toolUseId"] for entry in response.json()["pending"]]
        assert ids == ["route_tu_5"]
