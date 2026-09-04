"use client";

/**
 * RoomStatsMode - Mode 14: pass/fail tool-call counts per room, this session.
 *
 * A per-room complement to SafetyBoardMode's single global streak — shows
 * which room (if any) is having a rough time rather than only whether the
 * whole session has hit an error recently. Purely a frontend tally
 * (roomStatsStore), driven by the same post_tool_use `success` field the
 * Issues panel already classifies on — no new backend signal.
 */

import { Graphics } from "pixi.js";
import { useCallback, type ReactNode } from "react";
import { ROOMS } from "@/systems/officeRooms";
import { useRoomStatsStore } from "@/stores/roomStatsStore";

const ROW_HEIGHT = 36;
const ROW_TOP = 8;
const BAR_X = 112;
const BAR_WIDTH = 140;
const BAR_HEIGHT = 10;
const COUNT_X = BAR_X + BAR_WIDTH + 8;

export function RoomStatsMode(): ReactNode {
  const success = useRoomStatsStore((s) => s.success);
  const failure = useRoomStatsStore((s) => s.failure);

  const drawBars = useCallback(
    (g: Graphics) => {
      g.clear();
      ROOMS.forEach((room, i) => {
        const ok = success[room.id] ?? 0;
        const bad = failure[room.id] ?? 0;
        const total = ok + bad;
        const y = ROW_TOP + i * ROW_HEIGHT;
        const okWidth = total > 0 ? (ok / total) * BAR_WIDTH : 0;

        g.rect(BAR_X, y, BAR_WIDTH, BAR_HEIGHT);
        g.fill({ color: 0xe5e7eb });
        if (okWidth > 0) {
          g.rect(BAR_X, y, okWidth, BAR_HEIGHT);
          g.fill({ color: 0x22c55e });
        }
        if (BAR_WIDTH - okWidth > 0 && bad > 0) {
          g.rect(BAR_X + okWidth, y, BAR_WIDTH - okWidth, BAR_HEIGHT);
          g.fill({ color: 0xef4444 });
        }
      });
    },
    [success, failure],
  );

  return (
    <pixiContainer>
      <pixiGraphics draw={drawBars} />
      {ROOMS.map((room, i) => {
        const ok = success[room.id] ?? 0;
        const bad = failure[room.id] ?? 0;
        const total = ok + bad;
        const y = ROW_TOP + i * ROW_HEIGHT + BAR_HEIGHT / 2;
        return (
          <pixiContainer key={room.id}>
            <pixiContainer x={4} y={y} scale={0.5}>
              <pixiText
                text={room.name}
                anchor={{ x: 0, y: 0.5 }}
                style={{
                  fontFamily: '"Courier New", monospace',
                  fontSize: 11,
                  fontWeight: "bold",
                  fill: "#1f2937",
                  wordWrap: true,
                  wordWrapWidth: (BAR_X - 4) * 2,
                }}
                resolution={2}
              />
            </pixiContainer>
            <pixiContainer x={COUNT_X} y={y} scale={0.5}>
              <pixiText
                text={total === 0 ? "—" : `${ok}/${total}`}
                anchor={{ x: 0, y: 0.5 }}
                style={{
                  fontFamily: '"Courier New", monospace',
                  fontSize: 11,
                  fill: total === 0 ? "#9ca3af" : bad > 0 ? "#b91c1c" : "#15803d",
                }}
                resolution={2}
              />
            </pixiContainer>
          </pixiContainer>
        );
      })}
    </pixiContainer>
  );
}
