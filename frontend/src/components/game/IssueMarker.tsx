/**
 * IssueMarker - a pulsing red "!" badge above a character that has an open
 * issue, so the problem is visible on the office floor as well as in the panel.
 */

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Graphics } from "pixi.js";
import type { Position } from "@/types";

interface IssueMarkerProps {
  position: Position;
  /** Vertical offset from the character's position to the badge centre. */
  yOffset?: number;
}

const RADIUS = 9;

function drawBadge(g: Graphics): void {
  g.clear();
  g.circle(0, 0, RADIUS + 2);
  g.fill({ color: 0x000000, alpha: 0.35 });
  g.circle(0, 0, RADIUS);
  g.fill(0xdc2626);
  g.stroke({ width: 2, color: 0xfecaca });
}

export function IssueMarker({
  position,
  yOffset = -70,
}: IssueMarkerProps): ReactNode {
  const draw = useCallback((g: Graphics) => drawBadge(g), []);
  const [bob, setBob] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setBob(Math.sin((now - start) / 250) * 3);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <pixiContainer x={position.x} y={position.y + yOffset + bob}>
      <pixiGraphics draw={draw} />
      <pixiText
        text="!"
        anchor={0.5}
        y={-1}
        style={{
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: 14,
          fontWeight: "bold",
          fill: "#ffffff",
        }}
        resolution={2}
      />
    </pixiContainer>
  );
}
