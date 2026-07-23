/**
 * Navigation types for building/floor view system.
 *
 * "single" mode is the default — no building navigation, just the office.
 * "building" and "floor" modes activate when the user configures floors.
 */

/** Current view mode */
// LOCAL PATCH: "multi" shows every active session's agents together in one
// tiled office (see components/multi/MultiOfficeView.tsx) — distinct from
// "command" (Command Center), which only shows boss-level summaries.
export type ViewMode = "single" | "building" | "floor" | "command" | "multi";

/** Sentinel floor ID for the lobby (unmatched sessions) */
export const LOBBY_FLOOR_ID = "__lobby__";

/** Room configuration mapped to a repository */
export interface RoomConfig {
  id: string;
  repoName: string;
}

/** Floor configuration from building config */
export interface FloorConfig {
  id: string;
  name: string;
  floorNumber: number;
  accent: string;
  icon: string;
  rooms: RoomConfig[];
}

/** Full building configuration */
export interface BuildingConfig {
  buildingName: string;
  floors: FloorConfig[];
}

/** Direction of view transition animation */
export type TransitionDirection = "zoom-in" | "zoom-out" | null;
