"""Tests for the PermissionGate approve/deny bridge."""

import asyncio

import pytest

from app.core.permission_gate import PermissionGate


class TestRegisterAndGet:
    def test_register_creates_a_pending_entry(self) -> None:
        gate = PermissionGate()
        pending = gate.register("tu_1", "sess_1", "agent_1", "Bash", {"command": "ls"})
        assert pending.tool_use_id == "tu_1"
        assert pending.decision is None
        assert gate.get("tu_1") is pending

    def test_register_is_idempotent_while_undecided(self) -> None:
        gate = PermissionGate()
        first = gate.register("tu_1", "sess_1", "a1", "Bash", None)
        second = gate.register("tu_1", "sess_1", "a1", "Bash", None)
        assert first is second

    def test_register_after_decision_starts_fresh(self) -> None:
        gate = PermissionGate()
        first = gate.register("tu_1", "sess_1", "a1", "Bash", None)
        gate.decide("tu_1", "allow", None)
        second = gate.register("tu_1", "sess_1", "a1", "Bash", None)
        assert second is not first
        assert second.decision is None


class TestDecide:
    def test_decide_unknown_id_returns_none(self) -> None:
        gate = PermissionGate()
        assert gate.decide("nope", "allow", None) is None

    def test_decide_twice_only_the_first_counts(self) -> None:
        gate = PermissionGate()
        gate.register("tu_1", "sess_1", "a1", "Bash", None)
        first = gate.decide("tu_1", "allow", "looks fine")
        second = gate.decide("tu_1", "deny", "changed my mind")
        assert first is not None
        assert first.decision == "allow"
        assert second is None
        assert gate.get("tu_1").decision == "allow"  # type: ignore[union-attr]


class TestWait:
    @pytest.mark.asyncio
    async def test_wait_unknown_id_returns_none(self) -> None:
        gate = PermissionGate()
        assert await gate.wait("nope", timeout=0.05) is None

    @pytest.mark.asyncio
    async def test_wait_times_out_with_no_decision(self) -> None:
        gate = PermissionGate()
        gate.register("tu_1", "sess_1", "a1", "Bash", None)
        pending = await gate.wait("tu_1", timeout=0.05)
        assert pending is not None
        assert pending.decision is None

    @pytest.mark.asyncio
    async def test_wait_wakes_up_as_soon_as_decided(self) -> None:
        gate = PermissionGate()
        gate.register("tu_1", "sess_1", "a1", "Bash", None)

        async def decide_soon() -> None:
            await asyncio.sleep(0.02)
            gate.decide("tu_1", "deny", "nah")

        task = asyncio.create_task(decide_soon())
        pending = await gate.wait("tu_1", timeout=5)
        await task
        assert pending is not None
        assert pending.decision == "deny"
        assert pending.reason == "nah"

    @pytest.mark.asyncio
    async def test_multiple_waiters_all_see_the_decision(self) -> None:
        """Registering doesn't consume state — a retried event POST is safe."""
        gate = PermissionGate()
        gate.register("tu_1", "sess_1", "a1", "Bash", None)
        gate.register("tu_1", "sess_1", "a1", "Bash", None)  # duplicate event POST

        async def decide_soon() -> None:
            await asyncio.sleep(0.02)
            gate.decide("tu_1", "allow", None)

        task = asyncio.create_task(decide_soon())
        results = await asyncio.gather(
            gate.wait("tu_1", timeout=5),
            gate.wait("tu_1", timeout=5),
        )
        await task
        assert all(r is not None and r.decision == "allow" for r in results)


class TestListPending:
    def test_lists_only_undecided_entries_optionally_scoped_to_a_session(self) -> None:
        gate = PermissionGate()
        gate.register("tu_1", "sess_1", "a1", "Bash", None)
        gate.register("tu_2", "sess_2", "a2", "Write", None)
        gate.decide("tu_2", "allow", None)

        assert [p.tool_use_id for p in gate.list_pending()] == ["tu_1"]
        assert gate.list_pending(session_id="sess_2") == []
        assert [p.tool_use_id for p in gate.list_pending(session_id="sess_1")] == ["tu_1"]
