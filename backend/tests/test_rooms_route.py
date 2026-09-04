"""Tests for GET /rooms and PUT /preferences/room_config (end-to-end)."""

from fastapi.testclient import TestClient

from app.core.office_rooms import invalidate_rooms_cache
from app.core.state_machine import StateMachine
from app.main import app
from app.models.events import AgentEventData

client = TestClient(app)


def teardown_function() -> None:
    # Every test in this module mutates the room_config preference; leave a
    # clean slate (and an invalidated cache) for whatever runs next.
    client.delete("/api/v1/preferences/room_config")
    invalidate_rooms_cache()


class TestGetRooms:
    def test_returns_the_four_default_rooms_with_desks(self) -> None:
        response = client.get("/api/v1/rooms")
        assert response.status_code == 200
        rooms = response.json()["rooms"]
        assert [r["id"] for r in rooms] == [
            "scripting",
            "editing",
            "thumbnails_seo",
            "publishing",
        ]
        assert rooms[0]["desks"] == [1, 5]
        assert rooms[1]["name"] == "Editing"


class TestRoomConfigPreference:
    def test_put_then_get_reflects_the_override(self) -> None:
        put_response = client.put(
            "/api/v1/preferences/room_config",
            json={"value": '{"rooms":[{"id":"editing","name":"Post-Production"}]}'},
        )
        assert put_response.status_code == 200

        get_response = client.get("/api/v1/rooms")
        rooms = {r["id"]: r for r in get_response.json()["rooms"]}
        assert rooms["editing"]["name"] == "Post-Production"
        assert rooms["editing"]["accent"] == "#22C55E"  # untouched default
        assert rooms["scripting"]["name"] == "Scripting"  # untouched room

    def test_rejects_an_unknown_room_id(self) -> None:
        response = client.put(
            "/api/v1/preferences/room_config",
            json={"value": '{"rooms":[{"id":"marketing","name":"Marketing"}]}'},
        )
        assert response.status_code == 400
        assert "marketing" in response.json()["detail"]

    def test_rejects_malformed_json(self) -> None:
        response = client.put(
            "/api/v1/preferences/room_config",
            json={"value": "{not json"},
        )
        assert response.status_code == 400

    def test_delete_restores_the_defaults(self) -> None:
        client.put(
            "/api/v1/preferences/room_config",
            json={"value": '{"rooms":[{"id":"editing","name":"Post"}]}'},
        )
        assert client.get("/api/v1/rooms").json()["rooms"][1]["name"] == "Post"

        delete_response = client.delete("/api/v1/preferences/room_config")
        assert delete_response.status_code == 200

        rooms = client.get("/api/v1/rooms").json()["rooms"]
        assert rooms[1]["name"] == "Editing"


class TestAgentTypeOverridesPreference:
    def test_put_then_get_reflects_the_pin(self) -> None:
        response = client.put(
            "/api/v1/preferences/room_config",
            json={
                "value": (
                    '{"rooms":[],"agentTypeOverrides":'
                    '[{"agentType":"general-purpose","roomId":"publishing"}]}'
                )
            },
        )
        assert response.status_code == 200

        overrides = client.get("/api/v1/rooms").json()["agentTypeOverrides"]
        assert overrides == [{"agentType": "general-purpose", "roomId": "publishing"}]

    def test_rejects_a_pin_to_an_unknown_room(self) -> None:
        response = client.put(
            "/api/v1/preferences/room_config",
            json={
                "value": (
                    '{"rooms":[],"agentTypeOverrides":'
                    '[{"agentType":"general-purpose","roomId":"marketing"}]}'
                )
            },
        )
        assert response.status_code == 400
        assert "marketing" in response.json()["detail"]

    def test_rejects_a_pin_with_empty_agent_type(self) -> None:
        response = client.put(
            "/api/v1/preferences/room_config",
            json={
                "value": '{"rooms":[],"agentTypeOverrides":[{"agentType":"  ","roomId":"editing"}]}'
            },
        )
        assert response.status_code == 400

    def test_pin_takes_effect_for_newly_created_agents(self) -> None:
        # "general-purpose" matches no room's keywords, so it would otherwise
        # land wherever is emptiest — pinning it makes routing deterministic.
        put_response = client.put(
            "/api/v1/preferences/room_config",
            json={
                "value": (
                    '{"rooms":[],"agentTypeOverrides":'
                    '[{"agentType":"general-purpose","roomId":"publishing"}]}'
                )
            },
        )
        assert put_response.status_code == 200
        # GET /rooms is what warms the synchronous in-process cache that
        # create_agent reads — mirrors the real flow (frontend fetches once
        # at boot, see useRoomConfig.ts).
        assert client.get("/api/v1/rooms").status_code == 200

        sm = StateMachine()
        agent = sm.create_agent(AgentEventData(agent_id="a1", agent_type="general-purpose"))
        assert agent.room_id == "publishing"
