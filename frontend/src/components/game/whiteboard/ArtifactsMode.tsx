"use client";

/**
 * ArtifactsMode - Mode 13: recent Write/Edit file paths, newest first.
 *
 * Paths only, no content preview — see artifactStore.ts for why: reading
 * arbitrary local files by path and serving them to the browser is a real
 * new capability this feature doesn't need to take on to be useful.
 */

import { Graphics } from "pixi.js";
import { useCallback, type ReactNode } from "react";
import { ROOM_BY_ID } from "@/systems/officeRooms";
import type { Artifact } from "@/stores/artifactStore";

export interface ArtifactsModeProps {
  artifacts: Artifact[];
}

const ROW_HEIGHT = 15;
const MAX_ROWS = 9;
const PATH_MAX_CHARS = 34;

function shortenPath(path: string): string {
  if (path.length <= PATH_MAX_CHARS) return path;
  const parts = path.split("/");
  const file = parts.pop() ?? path;
  return file.length >= PATH_MAX_CHARS - 4
    ? `…${file.slice(-(PATH_MAX_CHARS - 1))}`
    : `…/${file}`;
}

export function ArtifactsMode({ artifacts }: ArtifactsModeProps): ReactNode {
  const drawRows = useCallback(
    (g: Graphics) => {
      g.clear();
      artifacts.slice(0, MAX_ROWS).forEach((_, row) => {
        if (row % 2 === 1) {
          g.rect(0, row * ROW_HEIGHT, 330, ROW_HEIGHT);
          g.fill({ color: 0x000000, alpha: 0.03 });
        }
      });
    },
    [artifacts],
  );

  return (
    <pixiContainer>
      <pixiGraphics draw={drawRows} />
      {artifacts.length === 0 ? (
        <pixiText
          text="No files written yet"
          x={165}
          y={70}
          anchor={0.5}
          style={{
            fontFamily: '"Courier New", monospace',
            fontSize: 11,
            fill: "#9ca3af",
          }}
          resolution={2}
        />
      ) : (
        artifacts.slice(0, MAX_ROWS).map((artifact, row) => {
          const room = ROOM_BY_ID.get(artifact.roomId);
          return (
            <pixiContainer key={artifact.id} x={4} y={row * ROW_HEIGHT + 2}>
              <pixiGraphics
                draw={(g: Graphics) => {
                  g.clear();
                  g.circle(3, 5, 3);
                  g.fill(room?.accent ?? 0x9ca3af);
                }}
              />
              <pixiContainer x={9} y={0} scale={0.5}>
                <pixiText
                  text={`${artifact.tool === "Write" ? "+" : "~"} ${shortenPath(artifact.path)}`}
                  anchor={{ x: 0, y: 0 }}
                  y={0}
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
          );
        })
      )}
    </pixiContainer>
  );
}
