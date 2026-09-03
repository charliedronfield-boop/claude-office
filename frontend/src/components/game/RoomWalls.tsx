/**
 * RoomWalls Component
 *
 * Draws the cordoned role rooms: a tinted floor per room, partition walls
 * with doorways, the meeting-area rug, and a name placard above each room.
 * Geometry comes from officeRooms.ts so the visuals always match the
 * navigation-grid obstacles.
 */

import { type ReactNode, useCallback, useMemo } from "react";
import { Graphics, TextStyle } from "pixi.js";
import {
  DOOR_TILE_RECTS,
  MEETING_TABLE,
  ROOMS,
  ROOM_TOP_GY,
  TILE_PX,
  WALL_TILE_RECTS,
  tileRectToPixels,
} from "@/systems/officeRooms";
import { useRoomActivityStore } from "@/stores/roomActivityStore";

const WALL_COLOR = 0x3d3d3d;
const WALL_TRIM_COLOR = 0x4a4a4a;
const WALL_SHADOW_COLOR = 0x151515;
const WALL_TRIM_HEIGHT = 6;
const WALL_SHADOW_HEIGHT = 4;
/** Partitions start slightly above the floor line to meet the top wall's trim. */
const WALL_TOP_OVERLAP = 12;
const DOOR_MAT_COLOR = 0x6b4f2a;
const RUG_COLOR = 0x1e3a5f;
const ROOM_TINT_ALPHA = 0.07;
const PLACARD_WIDTH = 132;
const PLACARD_HEIGHT = 20;

function drawRooms(g: Graphics): void {
  g.clear();

  for (const room of ROOMS) {
    const floor = tileRectToPixels(room.interior);
    g.rect(floor.x, floor.y, floor.width, floor.height);
    g.fill({ color: room.accent, alpha: ROOM_TINT_ALPHA });
  }

  g.rect(
    MEETING_TABLE.rug.x,
    MEETING_TABLE.rug.y,
    MEETING_TABLE.rug.width,
    MEETING_TABLE.rug.height,
  );
  g.fill({ color: RUG_COLOR, alpha: 0.55 });
  g.rect(
    MEETING_TABLE.rug.x + 6,
    MEETING_TABLE.rug.y + 6,
    MEETING_TABLE.rug.width - 12,
    MEETING_TABLE.rug.height - 12,
  );
  g.stroke({ width: 2, color: 0x93c5fd, alpha: 0.35 });

  for (const door of DOOR_TILE_RECTS) {
    const mat = tileRectToPixels(door);
    g.rect(mat.x + 4, mat.y + 6, mat.width - 8, mat.height - 12);
    g.fill({ color: DOOR_MAT_COLOR, alpha: 0.6 });
  }

  for (const wall of WALL_TILE_RECTS) {
    const rect = tileRectToPixels(wall);
    const isBottomWall = wall.gy1 === wall.gy2;
    const top = isBottomWall ? rect.y : rect.y - WALL_TOP_OVERLAP;
    const height = rect.height + (rect.y - top);

    if (isBottomWall) {
      drawBottomWallWithDoors(g, rect.x, top, rect.width, height);
    } else {
      drawWallSegment(g, rect.x, top, rect.width, height);
    }
  }
}

function drawBottomWallWithDoors(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const gaps = DOOR_TILE_RECTS.map((door) => tileRectToPixels(door))
    .map((mat) => ({ start: mat.x, end: mat.x + mat.width }))
    .sort((a, b) => a.start - b.start);

  let cursor = x;
  for (const gap of gaps) {
    if (gap.start > cursor) {
      drawWallSegment(g, cursor, y, gap.start - cursor, height);
    }
    cursor = Math.max(cursor, gap.end);
  }
  if (cursor < x + width) {
    drawWallSegment(g, cursor, y, x + width - cursor, height);
  }
}

function drawWallSegment(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  g.rect(x, y, width, height);
  g.fill(WALL_COLOR);
  g.rect(x, y, width, WALL_TRIM_HEIGHT);
  g.fill(WALL_TRIM_COLOR);
  g.rect(x, y + height - WALL_SHADOW_HEIGHT, width, WALL_SHADOW_HEIGHT);
  g.fill(WALL_SHADOW_COLOR);
}

function drawPlacard(g: Graphics, accent: number): void {
  g.clear();
  g.roundRect(-PLACARD_WIDTH / 2, 0, PLACARD_WIDTH, PLACARD_HEIGHT, 4);
  g.fill({ color: 0x0f172a, alpha: 0.9 });
  g.stroke({ width: 2, color: accent });
}

const ACTIVITY_BADGE_WIDTH = 46;
const ACTIVITY_BADGE_HEIGHT = 14;

function drawActivityBadge(g: Graphics): void {
  g.clear();
  g.roundRect(0, 0, ACTIVITY_BADGE_WIDTH, ACTIVITY_BADGE_HEIGHT, 3);
  g.fill({ color: 0x000000, alpha: 0.55 });
}

export function RoomWalls(): ReactNode {
  const drawRoomsCallback = useCallback((g: Graphics) => drawRooms(g), []);
  const toolCalls = useRoomActivityStore((s) => s.toolCalls);

  const labelStyle = useMemo<Partial<TextStyle>>(
    () => ({
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: 22,
      fontWeight: "bold",
      fill: "#e2e8f0",
      letterSpacing: 1,
    }),
    [],
  );

  const activityStyle = useMemo<Partial<TextStyle>>(
    () => ({
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: 18,
      fill: "#93c5fd",
    }),
    [],
  );

  const placardY = ROOM_TOP_GY * TILE_PX + 4;

  return (
    <>
      <pixiGraphics draw={drawRoomsCallback} />
      {ROOMS.map((room) => {
        const floor = tileRectToPixels(room.interior);
        const centerX = floor.x + floor.width / 2;
        const count = toolCalls[room.id] ?? 0;
        return (
          <pixiContainer key={room.id} x={centerX} y={placardY}>
            <pixiGraphics draw={(g) => drawPlacard(g, room.accent)} />
            <pixiContainer x={0} y={PLACARD_HEIGHT / 2} scale={0.5}>
              <pixiText
                text={room.name.toUpperCase()}
                anchor={0.5}
                style={labelStyle}
                resolution={2}
              />
            </pixiContainer>

            {/* Activity badge: cumulative tool calls this session — a rough
                "how much work has happened here" proxy (see roomActivityStore). */}
            {count > 0 && (
              <pixiContainer
                x={PLACARD_WIDTH / 2 - 6}
                y={PLACARD_HEIGHT + 4}
              >
                <pixiGraphics draw={drawActivityBadge} />
                <pixiContainer
                  x={ACTIVITY_BADGE_WIDTH / 2}
                  y={ACTIVITY_BADGE_HEIGHT / 2}
                  scale={0.5}
                >
                  <pixiText
                    text={`⚙ ${count}`}
                    anchor={0.5}
                    style={activityStyle}
                    resolution={2}
                  />
                </pixiContainer>
              </pixiContainer>
            )}
          </pixiContainer>
        );
      })}
    </>
  );
}
