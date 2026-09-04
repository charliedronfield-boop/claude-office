"use client";

/**
 * PipelineMode - Mode 12: Production pipeline board.
 *
 * One column per room, left to right in production order (Scripting → Editing
 * → Thumbnails & SEO → Publishing), each showing who's currently at a desk
 * there and what they're doing. Not a per-video tracker (nothing in the
 * event pipeline identifies "which video" a task belongs to) — this is
 * honestly a room-occupancy view framed as pipeline stages, which is what
 * the room-by-role layout already gives us for free.
 */

import { Graphics } from "pixi.js";
import { useCallback, useMemo, type ReactNode } from "react";
import type { Agent } from "@/types";
import { ROOMS, getRoomForDesk } from "@/systems/officeRooms";

export interface PipelineModeProps {
  agents: Agent[];
}

const COLUMN_WIDTH = 330 / 4;
const CONTENT_TOP = 8;
const ROW_HEIGHT = 15;

export function PipelineMode({ agents }: PipelineModeProps): ReactNode {
  const byRoom = useMemo(() => {
    const map = new Map<string, Agent[]>(ROOMS.map((room) => [room.id, []]));
    for (const agent of agents) {
      const room = getRoomForDesk(agent.desk ?? null);
      if (room) map.get(room.id)?.push(agent);
    }
    return map;
  }, [agents]);

  const drawColumns = useCallback((g: Graphics) => {
    g.clear();
    ROOMS.forEach((room, i) => {
      const x = i * COLUMN_WIDTH;
      const accent = room.accent;
      g.rect(x, 0, COLUMN_WIDTH, 20);
      g.fill({ color: accent, alpha: 0.25 });
      if (i > 0) {
        g.moveTo(x, 0);
        g.lineTo(x, 160);
        g.stroke({ width: 1, color: 0xd1d5db });
      }
      // Arrow to the next stage.
      if (i < ROOMS.length - 1) {
        const arrowX = x + COLUMN_WIDTH;
        g.moveTo(arrowX - 4, 10);
        g.lineTo(arrowX + 4, 10);
        g.moveTo(arrowX + 1, 6);
        g.lineTo(arrowX + 4, 10);
        g.lineTo(arrowX + 1, 14);
        g.stroke({ width: 1.5, color: 0x9ca3af });
      }
    });
  }, []);

  return (
    <pixiContainer>
      <pixiGraphics draw={drawColumns} />

      {ROOMS.map((room, i) => {
        const x = i * COLUMN_WIDTH;
        const roomAgents = byRoom.get(room.id) ?? [];
        return (
          <pixiContainer key={room.id} x={x}>
            <pixiContainer x={COLUMN_WIDTH / 2} y={10} scale={0.55}>
              <pixiText
                text={room.name.toUpperCase()}
                anchor={0.5}
                style={{
                  fontFamily: '"Courier New", monospace',
                  fontSize: 12,
                  fontWeight: "bold",
                  fill: "#1f2937",
                  wordWrap: true,
                  wordWrapWidth: COLUMN_WIDTH * 1.8,
                  align: "center",
                }}
                resolution={2}
              />
            </pixiContainer>

            {roomAgents.length === 0 ? (
              <pixiContainer x={COLUMN_WIDTH / 2} y={CONTENT_TOP + 20} scale={0.55}>
                <pixiText
                  text="— empty —"
                  anchor={0.5}
                  style={{
                    fontFamily: '"Courier New", monospace',
                    fontSize: 10,
                    fill: "#9ca3af",
                  }}
                  resolution={2}
                />
              </pixiContainer>
            ) : (
              roomAgents.slice(0, 6).map((agent, row) => (
                <pixiContainer
                  key={agent.id}
                  x={4}
                  y={CONTENT_TOP + 22 + row * ROW_HEIGHT}
                >
                  <pixiGraphics
                    draw={(g: Graphics) => {
                      g.clear();
                      g.circle(3, 4, 3);
                      g.fill(
                        parseInt(agent.color.replace("#", ""), 16) || 0x999999,
                      );
                    }}
                  />
                  <pixiContainer x={9} y={0} scale={0.5}>
                    <pixiText
                      text={(agent.name ?? `#${agent.number}`).slice(0, 24)}
                      anchor={{ x: 0, y: 0.5 }}
                      y={8}
                      style={{
                        fontFamily: '"Courier New", monospace',
                        fontSize: 11,
                        fontWeight: "bold",
                        fill: "#1f2937",
                      }}
                      resolution={2}
                    />
                  </pixiContainer>
                </pixiContainer>
              ))
            )}
          </pixiContainer>
        );
      })}
    </pixiContainer>
  );
}
