"use client";

/**
 * Live room configuration (names/accents/keywords + agent-type pins), fetched
 * once at boot by useRoomConfig.ts. Backs the RoomsTab settings UI and lets
 * RoomWalls display the configured name/accent instead of the static
 * officeRooms.ts defaults — mirrors navigationStore's buildingConfig.
 */

import { create } from "zustand";

export interface RoomInfo {
  id: string;
  name: string;
  /** "#rrggbb" — same wire format as BuildingTab's floor accent. */
  accent: string;
  keywords: string[];
  desks: number[];
}

export interface AgentTypeOverride {
  agentType: string;
  roomId: string;
}

interface RoomConfigState {
  rooms: RoomInfo[];
  agentTypeOverrides: AgentTypeOverride[];
  /** False until the first GET /api/v1/rooms response lands. */
  loaded: boolean;
  setRoomConfig: (rooms: RoomInfo[], agentTypeOverrides: AgentTypeOverride[]) => void;
}

export const useRoomConfigStore = create<RoomConfigState>()((set) => ({
  rooms: [],
  agentTypeOverrides: [],
  loaded: false,
  setRoomConfig: (rooms, agentTypeOverrides) => set({ rooms, agentTypeOverrides, loaded: true }),
}));
