"""Tests for role-based room resolution and desk assignment."""

from app.core.office_rooms import (
    ALL_DESKS,
    DEFAULT_ROOMS,
    RoomConfigOverrides,
    RoomOverride,
    apply_overrides,
    desk_to_room,
    get_cached_rooms,
    invalidate_rooms_cache,
    pick_desk,
    resolve_room,
)
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
        mapping = {desk: desk_to_room(desk) for desk in ALL_DESKS}
        assert sorted(mapping) == list(range(1, 9))
        assert {room.id for room in DEFAULT_ROOMS} == set(mapping.values())
        assert all(room_id is not None for room_id in mapping.values())


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


class TestRoomOverrides:
    def test_unset_fields_keep_the_default(self) -> None:
        overrides = RoomConfigOverrides(rooms=[RoomOverride(id="editing", name="Post-Production")])
        merged = apply_overrides(overrides)
        editing = next(r for r in merged if r.id == "editing")
        assert editing.name == "Post-Production"
        assert editing.accent == "#22C55E"  # untouched default
        assert editing.keywords == DEFAULT_ROOMS[1].keywords  # untouched default

        # Every other room is untouched entirely.
        assert merged[0] == DEFAULT_ROOMS[0]
        assert merged[2] == DEFAULT_ROOMS[2]
        assert merged[3] == DEFAULT_ROOMS[3]

    def test_keywords_override_replaces_the_whole_list(self) -> None:
        overrides = RoomConfigOverrides(rooms=[RoomOverride(id="scripting", keywords=["novelist"])])
        merged = apply_overrides(overrides)
        scripting = next(r for r in merged if r.id == "scripting")
        assert scripting.keywords == ("novelist",)

    def test_slot_order_and_columns_are_preserved_regardless_of_override_order(self) -> None:
        overrides = RoomConfigOverrides(
            rooms=[
                RoomOverride(id="publishing", name="Distribution"),
                RoomOverride(id="scripting", name="Writing"),
            ]
        )
        merged = apply_overrides(overrides)
        assert [r.id for r in merged] == [r.id for r in DEFAULT_ROOMS]
        assert [r.column for r in merged] == [r.column for r in DEFAULT_ROOMS]

    def test_routing_and_desk_assignment_follow_overridden_keywords(self) -> None:
        overrides = RoomConfigOverrides(
            rooms=[RoomOverride(id="thumbnails_seo", name="Design", keywords=["design"])]
        )
        rooms = apply_overrides(overrides)
        # "thumbnail-creator" (unlike "thumbnail-designer") has no substring
        # match against the overridden keyword list, so it must no longer
        # route to this room once "thumb" is dropped from its keywords.
        assert resolve_room("thumbnail-creator", rooms=rooms) != "thumbnails_seo"
        assert resolve_room("design-lead", rooms=rooms) == "thumbnails_seo"
        assert pick_desk("thumbnails_seo", used_desks=(), rooms=rooms) == 3

    def test_json_round_trip(self) -> None:
        payload = '{"rooms":[{"id":"editing","name":"Post"}]}'
        overrides = RoomConfigOverrides.from_json(payload)
        assert overrides.rooms == [RoomOverride(id="editing", name="Post")]


class TestCachedRooms:
    def test_falls_back_to_defaults_when_nothing_cached(self) -> None:
        # Other tests/routes in this process may have already warmed the
        # cache (get_cached_rooms is a process-wide singleton) — this test
        # only asserts the *fallback* behavior, so force that state first.
        invalidate_rooms_cache()
        try:
            assert get_cached_rooms() == DEFAULT_ROOMS
        finally:
            invalidate_rooms_cache()
