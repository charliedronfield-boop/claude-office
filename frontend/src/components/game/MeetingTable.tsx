/**
 * MeetingTable Component
 *
 * A round table with four chairs in the meeting area. Rendered inside the
 * Y-sorted layer so agents standing above the table draw behind it and
 * agents below it draw in front. The rug beneath is drawn by RoomWalls.
 */

import { type ReactNode, useCallback, useMemo } from "react";
import { Graphics, TextStyle, Texture } from "pixi.js";
import { MEETING_TABLE, TILE_PX } from "@/systems/officeRooms";

interface MeetingTableProps {
  chairTexture: Texture | null;
}

const TABLE_TOP_COLOR = 0x9a6a3c;
const TABLE_EDGE_COLOR = 0x5c3a1e;
const TABLE_HIGHLIGHT_COLOR = 0xb8865a;
const CHAIR_SCALE = 0.1386;

function drawTable(g: Graphics): void {
  g.clear();
  const { block } = MEETING_TABLE;
  const width = (block.gx2 - block.gx1 + 1) * TILE_PX;
  const height = (block.gy2 - block.gy1 + 1) * TILE_PX;

  // Shadow, edge, then top — an oval reads as a proper meeting table.
  g.ellipse(2, 6, width / 2, height / 2);
  g.fill({ color: 0x000000, alpha: 0.3 });
  g.ellipse(0, 4, width / 2, height / 2);
  g.fill(TABLE_EDGE_COLOR);
  g.ellipse(0, 0, width / 2, height / 2);
  g.fill(TABLE_TOP_COLOR);
  g.ellipse(-8, -6, width / 2 - 16, height / 2 - 10);
  g.stroke({ width: 2, color: TABLE_HIGHLIGHT_COLOR, alpha: 0.5 });
}

export function MeetingTable({ chairTexture }: MeetingTableProps): ReactNode {
  const drawTableCallback = useCallback((g: Graphics) => drawTable(g), []);
  const { center, seats, block } = MEETING_TABLE;
  const tableBottomY = (block.gy2 + 1) * TILE_PX;

  const labelStyle = useMemo<Partial<TextStyle>>(
    () => ({
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: 18,
      fontWeight: "bold",
      fill: "#93c5fd",
      letterSpacing: 2,
    }),
    [],
  );

  return (
    <>
      {chairTexture &&
        seats.map((seat, index) => (
          <pixiContainer
            key={`meeting-chair-${index}`}
            x={seat.x}
            y={seat.y}
            zIndex={seat.y + 20}
          >
            <pixiSprite
              texture={chairTexture}
              anchor={0.5}
              x={0}
              y={30}
              scale={CHAIR_SCALE}
            />
          </pixiContainer>
        ))}
      <pixiContainer x={center.x} y={center.y} zIndex={tableBottomY}>
        <pixiGraphics draw={drawTableCallback} />
        <pixiContainer x={0} y={0} scale={0.5}>
          <pixiText
            text="MEETING"
            anchor={0.5}
            style={labelStyle}
            resolution={2}
          />
        </pixiContainer>
      </pixiContainer>
    </>
  );
}
