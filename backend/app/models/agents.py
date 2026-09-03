from enum import StrEnum

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.models.common import BubbleContent

__all__ = [
    "AgentState",
    "BossState",
    "Agent",
    "Boss",
    "ChatInfo",
    "ChatKind",
    "ChatLocation",
    "ElevatorState",
    "PhoneState",
    "OfficeState",
]


class AgentState(StrEnum):
    """Visual states for agent characters."""

    ARRIVING = "arriving"
    REPORTING = "reporting"
    WALKING_TO_DESK = "walking_to_desk"
    WORKING = "working"
    THINKING = "thinking"
    WAITING_PERMISSION = "waiting_permission"
    COMPLETED = "completed"
    WAITING = "waiting"
    REPORTING_DONE = "reporting_done"
    LEAVING = "leaving"
    IN_ELEVATOR = "in_elevator"
    IDLE = "idle"
    CHATTING = "chatting"


class ChatKind(StrEnum):
    """Who is talking to whom."""

    PEER = "peer"  # agent <-> agent
    BOSS = "boss"  # boss <-> one agent
    MEETING = "meeting"  # boss addressing several agents


class ChatLocation(StrEnum):
    """Where the characters meet for the chat."""

    ROOM = "room"  # both agents share a room: chat in its open area
    MEETING_TABLE = "meeting_table"  # cross-room chats and group syncs
    BOSS_DESK = "boss_desk"  # the agent comes over to the boss


class ChatInfo(BaseModel):
    """An in-progress conversation attached to a character."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    partner_id: str  # agent id, or "main" for the boss
    partner_name: str | None = None
    text: str
    kind: ChatKind
    location: ChatLocation
    is_speaker: bool
    started_at: str  # ISO timestamp


class BossState(StrEnum):
    """Visual states for the boss character."""

    IDLE = "idle"
    PHONE_RINGING = "phone_ringing"
    ON_PHONE = "on_phone"
    RECEIVING = "receiving"
    WORKING = "working"
    DELEGATING = "delegating"
    WAITING_PERMISSION = "waiting_permission"
    REVIEWING = "reviewing"
    COMPLETING = "completing"


class Agent(BaseModel):
    """Represents a subagent in the office visualization."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    native_id: str | None = None  # Native Claude agent ID (e.g., "a5a60c7")
    name: str | None = None
    color: str
    number: int
    state: AgentState
    desk: int | None = None
    bubble: BubbleContent | None = None
    current_task: str | None = None
    position: dict[str, int] = {"x": 0, "y": 0}
    role_type: str | None = None  # subagent_type the agent was spawned with
    room_id: str | None = None  # office_rooms.Room.id derived from the assigned desk
    active_chat: ChatInfo | None = None
    # Agent Teams character hierarchy (Phase 4)
    character_type: str | None = None  # "lead" | "teammate" | "subagent"
    parent_session_id: str | None = None  # session that owns this character
    parent_id: str | None = None  # for subagents: parent lead/teammate id


class Boss(BaseModel):
    """Represents the main Claude agent (boss) in the office visualization."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    state: BossState
    current_task: str | None = None
    bubble: BubbleContent | None = None
    position: dict[str, int] = {"x": 640, "y": 830}
    active_chat: ChatInfo | None = None


class ElevatorState(StrEnum):
    """Visual states for the elevator."""

    CLOSED = "closed"
    ARRIVING = "arriving"
    OPEN = "open"
    DEPARTING = "departing"


class PhoneState(StrEnum):
    """Visual states for the boss's phone."""

    IDLE = "idle"
    RINGING = "ringing"
    IN_USE = "in_use"


class OfficeState(BaseModel):
    """Represents the overall state of the office environment."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    desk_count: int = 8
    elevator_state: ElevatorState = ElevatorState.CLOSED
    phone_state: PhoneState = PhoneState.IDLE
    context_utilization: float = 0.0
    tool_uses_since_compaction: int = 0
    print_report: bool = False
