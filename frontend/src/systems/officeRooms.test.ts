import { describe, it, expect } from "vitest";
import { findPath } from "./astar";
import { NavigationGrid, TileType } from "./navigationGrid";
import {
  DOOR_TILE_RECTS,
  MEETING_TABLE,
  ROOMS,
  ROOM_BOTTOM_WALL_GY,
  WALL_TILE_RECTS,
  getRoomForDesk,
  isInsideRoom,
  wanderTiles,
} from "./officeRooms";
import { BOSS_SLOT_LEFT, ARRIVAL_QUEUE_POSITIONS } from "./queuePositions";
import { getDeskPosition } from "@/machines/positionHelpers";

const grid = new NavigationGrid();

describe("officeRooms geometry", () => {
  it("marks partition walls as impassable and doors as floor", () => {
    for (const wall of WALL_TILE_RECTS) {
      expect(grid.getStaticTile(wall.gx1, wall.gy1)).toBe(TileType.WALL);
    }
    for (const door of DOOR_TILE_RECTS) {
      for (let gx = door.gx1; gx <= door.gx2; gx++) {
        expect(grid.getStaticTile(gx, door.gy1)).toBe(TileType.FLOOR);
      }
    }
    expect(
      grid.getStaticTile(MEETING_TABLE.block.gx1, MEETING_TABLE.block.gy1),
    ).toBe(TileType.WALL);
  });

  it("assigns every desk to exactly one room", () => {
    const seen = new Set<number>();
    for (const room of ROOMS) {
      for (const desk of room.desks) {
        expect(seen.has(desk)).toBe(false);
        seen.add(desk);
        expect(getRoomForDesk(desk)?.id).toBe(room.id);
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("officeRooms reachability", () => {
  it("reaches every desk seat from the boss slot through its room door", () => {
    for (let desk = 1; desk <= 8; desk++) {
      const room = getRoomForDesk(desk)!;
      const path = findPath(
        BOSS_SLOT_LEFT,
        getDeskPosition(desk),
        undefined,
        grid,
      );
      expect(path.length, `desk ${desk}`).toBeGreaterThan(0);

      const doorTile = path.find((p) => p.gy === ROOM_BOTTOM_WALL_GY);
      expect(doorTile, `desk ${desk} crosses the bottom wall`).toBeDefined();
      expect(doorTile!.gx).toBeGreaterThanOrEqual(room.door.gx1);
      expect(doorTile!.gx).toBeLessThanOrEqual(room.door.gx2);
    }
  });

  it("keeps in-room paths inside the room", () => {
    for (const room of ROOMS) {
      const seat = getDeskPosition(room.desks[0]);
      for (const tile of wanderTiles(room)) {
        expect(isInsideRoom(room, tile)).toBe(true);
        const path = findPath(seat, tile, undefined, grid);
        expect(path.length, `${room.id} → ${tile.x},${tile.y}`).toBeGreaterThan(
          0,
        );
        for (const step of path) {
          expect(step.gx).toBeGreaterThanOrEqual(room.interior.gx1);
          expect(step.gx).toBeLessThanOrEqual(room.interior.gx2);
          expect(step.gy).toBeLessThan(ROOM_BOTTOM_WALL_GY);
        }
      }
    }
  });

  it("reaches the meeting seats and the arrival queue from a desk", () => {
    const seat = getDeskPosition(1);
    for (const meetingSeat of MEETING_TABLE.seats) {
      expect(
        findPath(seat, meetingSeat, undefined, grid).length,
      ).toBeGreaterThan(0);
    }
    expect(
      findPath(seat, ARRIVAL_QUEUE_POSITIONS[0], undefined, grid).length,
    ).toBeGreaterThan(0);
  });
});
