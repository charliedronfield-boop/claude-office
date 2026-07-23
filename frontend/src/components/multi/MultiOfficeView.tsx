/**
 * MultiOfficeView — LOCAL PATCH
 *
 * Shows every active Claude Code session's boss AND agents together in one
 * shared canvas, tiled one small "mini-office" per session. This is
 * deliberately additive: it does not touch gameStore, agentMachineService,
 * or the single-session OfficeGame flow at all — it has its own store
 * (multiOfficeStore) fed by its own WebSocket connection (/ws/multi, via
 * useMultiWebSocket), and reuses the same BossSprite/AgentSprite render
 * components with simple grid positioning instead of the full desk/queue/
 * elevator choreography (similar in spirit to how Command Center is a
 * deliberately simpler view than the full office, not a rework of it).
 */

"use client";

import { Application, extend } from "@pixi/react";
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { useMemo } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { BossSprite } from "@/components/game/BossSprite";
import { AgentSprite } from "@/components/game/AgentSprite";
import { useOfficeTextures, type OfficeTextures } from "@/hooks/useOfficeTextures";
import { useMultiWebSocket } from "@/hooks/useMultiWebSocket";
import {
  useMultiOfficeStore,
  selectMultiOfficeSessions,
  selectMultiOfficeConnected,
} from "@/stores/multiOfficeStore";
import type { GameState } from "@/types";

extend({ Container, Graphics, Text });

const TILE_WIDTH = 340;
// Taller than a first pass — leaves headroom above the boss for its
// nameplate (even with renderBubble off) and room below the agent grid for
// two full rows without clipping the tile's bottom border.
const TILE_HEIGHT = 320;
const TILE_COLUMNS = 3;
const TILE_GAP = 20;
const BOSS_LOCAL_POSITION = { x: 60, y: 100 };
const AGENT_GRID_ORIGIN = { x: 40, y: 180 };
const AGENT_GRID_COLUMNS = 4;
const AGENT_SPACING = 68;
const MAX_VISIBLE_AGENTS_PER_TILE = 8;
const BACKGROUND_COLOR = 0x111318;
const TILE_FILL = 0x1c1f26;
const TILE_BORDER = 0x33384a;

const labelStyle = new TextStyle({
  fontSize: 14,
  fill: 0xffffff,
  fontWeight: "bold",
});
const statusStyle = new TextStyle({ fontSize: 12, fill: 0x9aa3b5 });
// Defined as a function (not a module-scope const like the styles above) as
// a workaround: a module-scope `taskStyle` const reproducibly hit a
// "ReferenceError: taskStyle is not defined" at runtime in this dev
// environment despite both the source and the compiled Turbopack chunk
// being correct (confirmed by inspecting the served bundle directly) —
// some Turbopack module-instantiation quirk, not a real scoping bug.
// Constructing it fresh per-tile sidesteps it entirely; TextStyle
// construction is cheap enough that this isn't worth memoizing.
function makeTaskStyle(): TextStyle {
  return new TextStyle({ fontSize: 11, fill: 0x7fe0c4 });
}
const overflowStyle = new TextStyle({ fontSize: 12, fill: 0xf4c07a });

function drawTileBackground(g: Graphics): void {
  g.clear();
  g.rect(0, 0, TILE_WIDTH, TILE_HEIGHT)
    .fill({ color: TILE_FILL })
    .stroke({ width: 2, color: TILE_BORDER });
}

interface SessionTileProps {
  sessionId: string;
  gameState: GameState;
  originX: number;
  originY: number;
  textures: OfficeTextures;
}

function SessionTile({
  sessionId,
  gameState,
  originX,
  originY,
  textures,
}: SessionTileProps) {
  const agents = gameState.agents ?? [];
  const visibleAgents = agents.slice(0, MAX_VISIBLE_AGENTS_PER_TILE);
  const overflowCount = agents.length - visibleAgents.length;
  const label = sessionId.length > 12 ? `${sessionId.slice(0, 12)}…` : sessionId;

  return (
    <pixiContainer x={originX} y={originY}>
      <pixiGraphics draw={drawTileBackground} />
      <pixiText text={label} x={12} y={8} style={labelStyle} />
      <pixiText
        text={`${agents.length} agent${agents.length === 1 ? "" : "s"} — ${gameState.boss.state}`}
        x={12}
        y={26}
        style={statusStyle}
      />
      {gameState.boss.currentTask && (
        <pixiText
          text={gameState.boss.currentTask}
          x={12}
          y={42}
          style={makeTaskStyle()}
        />
      )}
      {/* renderBubble is off deliberately: BossSprite's speech bubble is sized
          for the full single-session canvas (lots of headroom above the
          boss), and overflowed above these much smaller tiles. currentTask
          above (a position/height we fully control) conveys the same info. */}
      <BossSprite
        position={BOSS_LOCAL_POSITION}
        state={gameState.boss.state}
        bubble={null}
        inUseBy={null}
        currentTask={gameState.boss.currentTask ?? null}
        chairTexture={textures.chair}
        deskTexture={textures.desk}
        keyboardTexture={textures.keyboard}
        monitorTexture={textures.monitor}
        phoneTexture={textures.phone}
        headsetTexture={textures.headset}
        sunglassesTexture={textures.sunglasses}
        renderBubble={false}
        isTyping={gameState.boss.state === "working"}
      />
      {visibleAgents.map((agent, index) => {
        const col = index % AGENT_GRID_COLUMNS;
        const row = Math.floor(index / AGENT_GRID_COLUMNS);
        return (
          <AgentSprite
            key={agent.id}
            id={agent.id}
            name={agent.name ?? null}
            color={agent.color}
            number={agent.number}
            position={{
              x: AGENT_GRID_ORIGIN.x + col * AGENT_SPACING,
              y: AGENT_GRID_ORIGIN.y + row * AGENT_SPACING,
            }}
            phase="idle"
            bubble={agent.bubble ?? null}
            headsetTexture={textures.headset}
            sunglassesTexture={textures.sunglasses}
            renderBubble={false}
            renderLabel
          />
        );
      })}
      {overflowCount > 0 && (
        <pixiText
          text={`+${overflowCount} more`}
          x={12}
          y={TILE_HEIGHT - 22}
          style={overflowStyle}
        />
      )}
    </pixiContainer>
  );
}

export interface MultiOfficeViewProps {
  /** Only connects the WebSocket and renders while true. */
  enabled: boolean;
}

export function MultiOfficeView({ enabled }: MultiOfficeViewProps) {
  useMultiWebSocket({ enabled });
  const sessions = useMultiOfficeStore(selectMultiOfficeSessions);
  const connected = useMultiOfficeStore(selectMultiOfficeConnected);
  const { textures, loaded: spritesLoaded } = useOfficeTextures();

  const sessionIds = useMemo(() => Object.keys(sessions).sort(), [sessions]);

  const { canvasWidth, canvasHeight } = useMemo(() => {
    const rows = Math.max(1, Math.ceil(sessionIds.length / TILE_COLUMNS));
    return {
      canvasWidth: TILE_COLUMNS * (TILE_WIDTH + TILE_GAP) + TILE_GAP,
      canvasHeight: rows * (TILE_HEIGHT + TILE_GAP) + TILE_GAP,
    };
  }, [sessionIds.length]);

  if (!enabled) return null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `#${BACKGROUND_COLOR.toString(16)}`,
      }}
    >
      <TransformWrapper minScale={0.3} maxScale={2} centerOnInit>
        <TransformComponent wrapperClass="w-full h-full" contentClass="w-full h-full">
          <Application
            width={canvasWidth}
            height={canvasHeight}
            backgroundColor={BACKGROUND_COLOR}
            autoDensity
            resolution={
              typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
            }
          >
            <pixiContainer>
              {!spritesLoaded && (
                <pixiText text="Loading…" x={20} y={20} style={labelStyle} />
              )}
              {spritesLoaded && sessionIds.length === 0 && (
                <pixiText
                  text={connected ? "No active sessions" : "Connecting…"}
                  x={20}
                  y={20}
                  style={labelStyle}
                />
              )}
              {spritesLoaded &&
                sessionIds.map((sessionId, index) => {
                  const col = index % TILE_COLUMNS;
                  const row = Math.floor(index / TILE_COLUMNS);
                  return (
                    <SessionTile
                      key={sessionId}
                      sessionId={sessionId}
                      gameState={sessions[sessionId]}
                      originX={TILE_GAP + col * (TILE_WIDTH + TILE_GAP)}
                      originY={TILE_GAP + row * (TILE_HEIGHT + TILE_GAP)}
                      textures={textures}
                    />
                  );
                })}
            </pixiContainer>
          </Application>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
