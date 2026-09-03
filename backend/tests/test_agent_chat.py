"""Tests for agent_message handling: who chats with whom, and where."""

from datetime import UTC, datetime, timedelta

from app.core.state_machine import StateMachine
from app.models.agents import AgentState, ChatKind, ChatLocation
from app.models.events import (
    AgentEventData,
    AgentMessageEvent,
    AgentMessageEventData,
    EventType,
    ToolEvent,
    ToolEventData,
)

SESSION = "sess_chat"


def _message(
    sender: str,
    to: str,
    text: str = "hello",
    *,
    native: str | None = None,
    at: datetime | None = None,
    tool_use_id: str | None = None,
) -> AgentMessageEvent:
    return AgentMessageEvent(
        event_type=EventType.AGENT_MESSAGE,
        session_id=SESSION,
        timestamp=at or datetime.now(UTC),
        data=AgentMessageEventData(
            agent_id=sender,
            native_agent_id=native,
            to=to,
            message_text=text,
            tool_use_id=tool_use_id,
        ),
    )


def _office() -> StateMachine:
    sm = StateMachine()
    for agent_id, agent_type in (
        ("scripter", "script-writer"),
        ("editor", "video-editor"),
        ("outliner", "outline-writer"),
    ):
        agent = sm.create_agent(AgentEventData(agent_id=agent_id, agent_type=agent_type))
        agent.state = AgentState.WORKING
        sm.agents[agent.id] = agent
    return sm


class TestBossChats:
    def test_boss_to_agent_pulls_agent_to_the_boss_desk(self) -> None:
        sm = _office()
        sm.transition(_message("main", "editor", "Trim the intro", tool_use_id="tu_1"))

        editor = sm.agents["editor"]
        assert editor.state == AgentState.CHATTING
        assert editor.active_chat is not None
        assert editor.active_chat.id == "tu_1"
        assert editor.active_chat.partner_id == "main"
        assert editor.active_chat.kind == ChatKind.BOSS
        assert editor.active_chat.location == ChatLocation.BOSS_DESK
        assert editor.active_chat.is_speaker is False

        assert sm.boss_active_chat is not None
        assert sm.boss_active_chat.partner_id == "editor"
        assert sm.boss_active_chat.is_speaker is True
        assert sm.boss_bubble is not None
        assert sm.boss_bubble.text == "Trim the intro"

    def test_boss_messaging_two_agents_quickly_becomes_a_meeting(self) -> None:
        sm = _office()
        now = datetime.now(UTC)
        sm.transition(_message("main", "editor", at=now))
        sm.transition(_message("main", "scripter", at=now + timedelta(seconds=5)))

        for key in ("editor", "scripter"):
            chat = sm.agents[key].active_chat
            assert chat is not None
            assert chat.kind == ChatKind.MEETING
            assert chat.location == ChatLocation.MEETING_TABLE
        assert sm.boss_active_chat is not None
        assert sm.boss_active_chat.kind == ChatKind.MEETING

    def test_boss_messages_far_apart_stay_separate_chats(self) -> None:
        sm = _office()
        now = datetime.now(UTC)
        sm.transition(_message("main", "editor", at=now))
        sm.transition(_message("main", "scripter", at=now + timedelta(seconds=40)))
        chat = sm.agents["scripter"].active_chat
        assert chat is not None
        assert chat.kind == ChatKind.BOSS

    def test_agent_to_boss_walks_over_and_speaks(self) -> None:
        sm = _office()
        sm.transition(_message("editor", "main", "Cut is ready"))
        chat = sm.agents["editor"].active_chat
        assert chat is not None
        assert chat.location == ChatLocation.BOSS_DESK
        assert chat.is_speaker is True
        assert sm.boss_active_chat is not None
        assert sm.boss_active_chat.is_speaker is False


class TestPeerChats:
    def test_same_room_chat_happens_in_the_room(self) -> None:
        sm = _office()
        sm.transition(_message("scripter", "outliner"))
        chat = sm.agents["outliner"].active_chat
        assert chat is not None
        assert chat.kind == ChatKind.PEER
        assert chat.location == ChatLocation.ROOM

    def test_cross_room_chat_meets_at_the_table(self) -> None:
        sm = _office()
        sm.transition(_message("scripter", "editor"))
        assert sm.agents["scripter"].active_chat is not None
        assert sm.agents["scripter"].active_chat.location == ChatLocation.MEETING_TABLE
        assert sm.agents["editor"].active_chat is not None
        assert sm.agents["editor"].active_chat.is_speaker is False

    def test_sender_resolved_from_native_id(self) -> None:
        sm = _office()
        sm.agents["scripter"].native_id = "nat_1"
        sm.transition(_message("main", "editor", native="nat_1"))
        assert sm.agents["scripter"].active_chat is not None
        assert sm.agents["scripter"].active_chat.is_speaker is True
        assert sm.boss_active_chat is None


class TestRecipientResolution:
    def test_matches_name_and_role_case_insensitively(self) -> None:
        sm = _office()
        sm.agents["editor"].name = "Video Editor"
        assert sm.resolve_recipient("video editor") == "editor"
        assert sm.resolve_recipient("VIDEO-EDITOR") == "editor"
        assert sm.resolve_recipient("Editor") == "editor"
        assert sm.resolve_recipient("boss") == "main"
        assert sm.resolve_recipient("nobody-here") is None

    def test_unknown_recipient_only_logs_news(self) -> None:
        sm = _office()
        sm.transition(_message("main", "nobody"))
        assert sm.boss_active_chat is None
        assert all(agent.active_chat is None for agent in sm.agents.values())
        assert sm.whiteboard.news_items[0].category == "chat"


class TestChatLifecycle:
    def test_next_tool_call_ends_the_chat(self) -> None:
        sm = _office()
        sm.transition(_message("main", "editor"))
        sm.transition(
            ToolEvent(
                event_type=EventType.PRE_TOOL_USE,
                session_id=SESSION,
                timestamp=datetime.now(UTC),
                data=ToolEventData(tool_name="Read", agent_id="editor"),
            )
        )
        assert sm.agents["editor"].active_chat is None
        assert sm.agents["editor"].state == AgentState.WORKING

    def test_stale_chats_expire_on_snapshot(self) -> None:
        sm = _office()
        old = datetime.now(UTC) - timedelta(seconds=120)
        sm.transition(_message("main", "editor", at=old))
        assert sm.agents["editor"].active_chat is not None

        state = sm.to_game_state(SESSION)
        assert state.boss.active_chat is None
        assert sm.agents["editor"].active_chat is None
        assert sm.agents["editor"].state == AgentState.WORKING
