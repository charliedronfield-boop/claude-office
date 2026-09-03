"""Tests for role-based room resolution and desk assignment."""

from app.core.office_rooms import DESK_TO_ROOM, ROOMS, pick_desk, resolve_room
from app.core.state_machine import StateMachine
from app.models.events import AgentEventData


class TestResolveRoom:
    def test_keyword_match_is_case_insensitive(self) -> None:
        assert resolve_room("Script-Writer") == "scripting"
        assert resolve_room("video-editor") == "editing"
        assert resolve_room("thumbnail-designer") == "thumbnails_seo"
        assert resolve_room("SEO") == "thumbnails_seo"
        assert resolve_room("publisher") == "publishing"

    def test_unknown_role_goes_to_emptiest_room(self) -> None:
        assert resolve_room("general-purpose", used_desks=()) == "scripting"
        # Scripting has one desk taken -> editing is now emptier.
        assert resolve_room("general-purpose", used_desks=(1,)) == "editing"
        # Every room has one desk taken -> tie broken by lowest column.
        assert resolve_room(None, used_desks=(1, 2, 3, 4)) == "scripting"

    def test_every_desk_belongs_to_exactly_one_room(self) -> None:
        assert sorted(DESK_TO_ROOM) == list(range(1, 9))
        assert {room.id for room in ROOMS} == set(DESK_TO_ROOM.values())


class TestPickDesk:
    def test_prefers_lowest_free_desk_in_room(self) -> None:
        assert pick_desk("editing", used_desks=()) == 2
        assert pick_desk("editing", used_desks=(2,)) == 6

    def test_overflows_to_lowest_free_desk_anywhere(self) -> None:
        assert pick_desk("editing", used_desks=(2, 6)) == 1
        assert pick_desk("editing", used_desks=(1, 2, 6)) == 3

    def test_returns_none_when_office_is_full(self) -> None:
        assert pick_desk("editing", used_desks=range(1, 9)) is None


class TestCreateAgentRooms:
    def test_agent_lands_in_role_room(self) -> None:
        sm = StateMachine()
        agent = sm.create_agent(
            AgentEventData(agent_id="a1", agent_name="Editor", agent_type="video-editor")
        )
        assert agent.role_type == "video-editor"
        assert agent.room_id == "editing"
        assert agent.desk == 2

    def test_desks_are_reused_after_departure(self) -> None:
        sm = StateMachine()
        first = sm.create_agent(AgentEventData(agent_id="a1", agent_type="scripter"))
        sm.agents[first.id] = first
        second = sm.create_agent(AgentEventData(agent_id="a2", agent_type="scripter"))
        sm.agents[second.id] = second
        assert (first.desk, second.desk) == (1, 5)

        sm.remove_agent(first.id)
        third = sm.create_agent(AgentEventData(agent_id="a3", agent_type="scripter"))
        assert third.desk == 1

    def test_overflow_reports_room_of_actual_desk(self) -> None:
        sm = StateMachine()
        for agent_id in ("a1", "a2"):
            agent = sm.create_agent(AgentEventData(agent_id=agent_id, agent_type="scripter"))
            sm.agents[agent.id] = agent
        overflow = sm.create_agent(AgentEventData(agent_id="a3", agent_type="scripter"))
        assert overflow.desk == 2
        assert overflow.room_id == "editing"
