"use client";

import { useEffect } from "react";
import { apiFetch } from "@/utils/api";
import { useRoomConfigStore, type AgentTypeOverride, type RoomInfo } from "@/stores/roomConfigStore";

interface RoomsResponse {
  rooms?: Array<{
    id?: string;
    name?: string;
    accent?: string;
    keywords?: string[];
    desks?: number[];
  }>;
  agentTypeOverrides?: Array<{ agentType?: string; roomId?: string }>;
}

/**
 * Fetches the current room configuration (default + any stored override)
 * and stores it in roomConfigStore. Runs once on mount — mirrors
 * useFloorConfig.ts's building_config fetch. Also warms the backend's
 * synchronous in-process room cache (see office_rooms.py::load_rooms),
 * which is otherwise only warmed by this call — without it, a saved
 * room_config override never actually affects agent routing.
 */
export function useRoomConfig(): void {
  const setRoomConfig = useRoomConfigStore((s) => s.setRoomConfig);

  useEffect(() => {
    apiFetch("/api/v1/rooms")
      .then((res) => res.json())
      .then((data: RoomsResponse) => {
        const rooms: RoomInfo[] = (data.rooms ?? [])
          .filter((r): r is Required<typeof r> => Boolean(r.id && r.name && r.accent))
          .map((r) => ({
            id: r.id,
            name: r.name,
            accent: r.accent,
            keywords: r.keywords ?? [],
            desks: r.desks ?? [],
          }));
        const agentTypeOverrides: AgentTypeOverride[] = (data.agentTypeOverrides ?? [])
          .filter((o): o is Required<typeof o> => Boolean(o.agentType && o.roomId))
          .map((o) => ({ agentType: o.agentType, roomId: o.roomId }));
        setRoomConfig(rooms, agentTypeOverrides);
      })
      .catch(() => {
        // Leave the store unloaded — RoomWalls falls back to the static
        // officeRooms.ts defaults, and RoomsTab shows its own fetch error.
      });
  }, [setRoomConfig]);
}
