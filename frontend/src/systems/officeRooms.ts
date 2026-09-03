/**
 * Role-based rooms: cordoned desk columns with doorways, plus the meeting table.
 *
 * Mirrors `backend/app/core/office_rooms.py` (role → room mapping) and adds
 * the tile geometry used by both the navigation grid (obstacles) and the
 * RoomWalls / MeetingTable renderers, so walls always match pathfinding.
 *
 * Tile units: 32px, matching `navigationGrid.TILE_SIZE` (not imported to
 * avoid a circular dependency — navigationGrid consumes this module).
 */

import type { Position } from "@/types";

export const TILE_PX = 32;

/** Inclusive tile rectangle. */
export interface TileRect {
  gx1: number;
  gy1: number;
  gx2: number;
  gy2: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Room {
  id: string;
  name: string;
  accent: number;
  column: number;
  desks: number[];
  /** Walkable interior (between the partition walls, above the bottom wall). */
  interior: TileRect;
  /** Door gap in the bottom wall (same gy as ROOM_BOTTOM_WALL_GY). */
  door: TileRect;
  /** Two facing spots in the open area at the top of the room for a chat. */
  chatSpots: [Position, Position];
}

// ============================================================================
// GEOMETRY
// ============================================================================

/** First floor tile row below the top wall (the nav grid marks gy < 8 as wall). */
export const ROOM_TOP_GY = 8;
/** Bottom wall row; rooms are open to the corridor below it via their door. */
export const ROOM_BOTTOM_WALL_GY = 24;
/** Partition wall columns: outer left, three dividers, outer right. */
const WALL_GX = [5, 12, 20, 28, 36] as const;
const DOOR_WIDTH_TILES = 3;
/** Rows of the open area used for wandering and chats (clear of desks/seats). */
const OPEN_AREA_GY = { from: 9, to: 12 } as const;
const CHAT_SPOT_GY = 10.5;
const CHAT_SPOT_HALF_GAP = 28;
const DESK_COLUMN_CENTER_X = [256, 512, 768, 1024] as const;
const DESKS_PER_ROW = 4;

const ROOM_DEFS = [
  { id: "scripting", name: "Scripting", accent: 0x3b82f6 },
  { id: "editing", name: "Editing", accent: 0x22c55e },
  { id: "thumbnails_seo", name: "Thumbnails & SEO", accent: 0xa855f7 },
  { id: "publishing", name: "Publishing", accent: 0xf97316 },
] as const;

export const ROOMS: Room[] = ROOM_DEFS.map((def, column) => {
  const leftWall = WALL_GX[column];
  const rightWall = WALL_GX[column + 1];
  const centerX = DESK_COLUMN_CENTER_X[column];
  return {
    id: def.id,
    name: def.name,
    accent: def.accent,
    column,
    desks: [column + 1, column + 1 + DESKS_PER_ROW],
    interior: {
      gx1: leftWall + 1,
      gy1: ROOM_TOP_GY,
      gx2: rightWall - 1,
      gy2: ROOM_BOTTOM_WALL_GY - 1,
    },
    // The door sits at the room's right edge, where the free corridor beside
    // the desks leads up to the seats.
    door: {
      gx1: rightWall - DOOR_WIDTH_TILES,
      gy1: ROOM_BOTTOM_WALL_GY,
      gx2: rightWall - 1,
      gy2: ROOM_BOTTOM_WALL_GY,
    },
    chatSpots: [
      { x: centerX - CHAT_SPOT_HALF_GAP, y: CHAT_SPOT_GY * TILE_PX },
      { x: centerX + CHAT_SPOT_HALF_GAP, y: CHAT_SPOT_GY * TILE_PX },
    ],
  };
});

export const ROOM_BY_ID: ReadonlyMap<string, Room> = new Map(
  ROOMS.map((room) => [room.id, room]),
);

const ROOM_BY_DESK: ReadonlyMap<number, Room> = new Map(
  ROOMS.flatMap((room) => room.desks.map((desk) => [desk, room] as const)),
);

export function getRoomForDesk(desk: number | null): Room | null {
  return desk === null ? null : (ROOM_BY_DESK.get(desk) ?? null);
}

/** Vertical partitions plus the bottom wall, as tile rectangles. */
export const WALL_TILE_RECTS: TileRect[] = [
  ...WALL_GX.map((gx) => ({
    gx1: gx,
    gy1: ROOM_TOP_GY,
    gx2: gx,
    gy2: ROOM_BOTTOM_WALL_GY,
  })),
  {
    gx1: WALL_GX[0],
    gy1: ROOM_BOTTOM_WALL_GY,
    gx2: WALL_GX[WALL_GX.length - 1],
    gy2: ROOM_BOTTOM_WALL_GY,
  },
];

export const DOOR_TILE_RECTS: TileRect[] = ROOMS.map((room) => room.door);

// ============================================================================
// MEETING TABLE
// ============================================================================

export interface MeetingTable {
  center: Position;
  /** Impassable footprint of the table itself. */
  block: TileRect;
  /** Where agents stand when they join a meeting (left, right, top, bottom). */
  seats: Position[];
  /** Decorative rug under the table and chairs. */
  rug: PixelRect;
}

export const MEETING_TABLE: MeetingTable = {
  center: { x: 1008, y: 864 },
  block: { gx1: 30, gy1: 26, gx2: 32, gy2: 27 },
  seats: [
    { x: 944, y: 864 },
    { x: 1072, y: 864 },
    { x: 1008, y: 816 },
    { x: 1008, y: 912 },
  ],
  rug: { x: 912, y: 792, width: 192, height: 144 },
};

/** Where an agent stands when the boss pulls it aside (just above the boss desk). */
export const BOSS_CHAT_SPOT: Position = { x: 640, y: 826 };

// ============================================================================
// HELPERS
// ============================================================================

export function tileRectToPixels(rect: TileRect): PixelRect {
  return {
    x: rect.gx1 * TILE_PX,
    y: rect.gy1 * TILE_PX,
    width: (rect.gx2 - rect.gx1 + 1) * TILE_PX,
    height: (rect.gy2 - rect.gy1 + 1) * TILE_PX,
  };
}

export function tileCenter(gx: number, gy: number): Position {
  return { x: gx * TILE_PX + TILE_PX / 2, y: gy * TILE_PX + TILE_PX / 2 };
}

/**
 * Tiles an idle agent may stroll to inside its room: the open area above the
 * desks, one tile in from each wall so sprites never overlap the partitions.
 */
export function wanderTiles(room: Room): Position[] {
  const tiles: Position[] = [];
  for (let gy = OPEN_AREA_GY.from; gy <= OPEN_AREA_GY.to; gy++) {
    for (let gx = room.interior.gx1 + 1; gx <= room.interior.gx2 - 1; gx++) {
      tiles.push(tileCenter(gx, gy));
    }
  }
  return tiles;
}

export function isInsideRoom(room: Room, position: Position): boolean {
  const gx = Math.floor(position.x / TILE_PX);
  const gy = Math.floor(position.y / TILE_PX);
  const { interior } = room;
  return (
    gx >= interior.gx1 &&
    gx <= interior.gx2 &&
    gy >= interior.gy1 &&
    gy <= interior.gy2
  );
}
