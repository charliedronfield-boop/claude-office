/**
 * ReplayControls - watch a finished (or in-progress) session play back.
 *
 * Wires up the previously-dormant replay subsystem: GET .../replay already
 * existed on the backend, and isReplaying/replaySpeed/replayEvents/
 * currentReplayIndex already existed on the store (webSocketController.ts
 * already skips connecting the live WS while isReplaying is true) — nothing
 * fetched the endpoint or stepped through the frames until now.
 *
 * Deliberately not a scrub/seek timeline or a video export: frames step
 * forward at a fixed interval (scaled by speed) through the exact same
 * reconcileState() pipeline the live WebSocket uses, so every existing
 * visual (arrivals, chats, issues, whiteboard) replays for free. "Export as
 * a video" would need a real encoding pipeline, out of scope here.
 */

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Play, Pause, X, History } from "lucide-react";
import { useGameStore, selectSessionId } from "@/stores/gameStore";
import { agentMachineService } from "@/machines/agentMachineService";
import { reconcileState, type ReconcilerContext } from "@/systems/stateReconciler";
import { resetSpawnIndex } from "@/systems/queuePositions";
import { resetFrontendState } from "@/hooks/useWebSocketEvents";
import { apiFetch } from "@/utils/api";
import { useTranslation } from "@/hooks/useTranslation";
import type { ReplayFrame } from "@/stores/gameStore";

const BASE_INTERVAL_MS = 350;
const SPEEDS = [1, 4, 15] as const;

async function fetchReplay(sessionId: string): Promise<ReplayFrame[]> {
  const res = await apiFetch(`/api/v1/sessions/${sessionId}/replay`);
  if (!res.ok) throw new Error(`Replay fetch failed: ${res.status}`);
  return (await res.json()) as ReplayFrame[];
}

export function ReplayControls(): ReactNode {
  const { t } = useTranslation();
  const sessionId = useGameStore(selectSessionId);
  const isReplaying = useGameStore((s) => s.isReplaying);
  const replayEvents = useGameStore((s) => s.replayEvents);
  const currentReplayIndex = useGameStore((s) => s.currentReplayIndex);
  const setReplayEvents = useGameStore((s) => s.setReplayEvents);
  const setReplayIndex = useGameStore((s) => s.setReplayIndex);
  const setReplaying = useGameStore((s) => s.setReplaying);
  const resetForReplay = useGameStore((s) => s.resetForReplay);
  const addEventLog = useGameStore((s) => s.addEventLog);

  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<ReconcilerContext | null>(null);

  const startReplay = useCallback(async () => {
    if (!sessionId || sessionId === "None" || loading) return;
    setLoading(true);
    setError(null);
    try {
      const frames = await fetchReplay(sessionId);
      if (frames.length === 0) {
        setError(t("replay.empty"));
        return;
      }
      agentMachineService.reset();
      resetSpawnIndex();
      resetForReplay();
      ctxRef.current = {
        currentSessionId: sessionId,
        processedAgents: new Set(),
        lastSeenBubbleText: new Map(),
        initialQueueSyncDone: { current: null },
      };
      setReplayEvents(frames);
      setReplayIndex(0);
      setPaused(false);
    } catch {
      setError(t("replay.fetchFailed"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, loading, resetForReplay, setReplayEvents, setReplayIndex, t]);

  const exitReplay = useCallback(() => {
    resetFrontendState();
    setReplaying(false);
    ctxRef.current = null;
  }, [setReplaying]);

  // Stepper: advances one frame per tick through the exact same
  // reconciliation pipeline the live WebSocket uses.
  useEffect(() => {
    if (!isReplaying || paused || replayEvents.length === 0) return;
    if (currentReplayIndex >= replayEvents.length) return;

    const timer = setTimeout(() => {
      const frame = replayEvents[currentReplayIndex];
      const ctx = ctxRef.current;
      if (frame && ctx) {
        reconcileState(frame.state, ctx);
        addEventLog(frame.event);
      }
      setReplayIndex(currentReplayIndex + 1);
    }, BASE_INTERVAL_MS / speed);

    return () => clearTimeout(timer);
  }, [
    isReplaying,
    paused,
    speed,
    replayEvents,
    currentReplayIndex,
    addEventLog,
    setReplayIndex,
  ]);

  const finished =
    isReplaying &&
    replayEvents.length > 0 &&
    currentReplayIndex >= replayEvents.length;

  if (!isReplaying) {
    return (
      <button
        onClick={() => void startReplay()}
        disabled={!sessionId || sessionId === "None" || loading}
        title={t("replay.start")}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-1.5 px-3 py-2 bg-slate-800/90 hover:bg-slate-700 disabled:opacity-40 border border-slate-600 rounded-lg text-slate-200 text-xs font-mono shadow-lg backdrop-blur-sm"
      >
        <History size={13} />
        {loading ? t("replay.loading") : t("replay.start")}
        {error && <span className="text-red-400 ml-1">· {error}</span>}
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-3 py-2 bg-slate-900/95 border border-slate-600 rounded-lg text-xs font-mono shadow-lg backdrop-blur-sm">
      <button
        onClick={() => setPaused((p) => !p)}
        disabled={finished}
        className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200"
        aria-label={paused ? t("replay.play") : t("replay.pause")}
      >
        {paused || finished ? <Play size={12} /> : <Pause size={12} />}
      </button>

      <span className="text-slate-400 tabular-nums">
        {Math.min(currentReplayIndex, replayEvents.length)}/{replayEvents.length}
      </span>

      <div className="flex items-center gap-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-1.5 py-1 rounded text-[10px] ${
              speed === s
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      {finished && (
        <span className="text-emerald-400">{t("replay.finished")}</span>
      )}

      <button
        onClick={exitReplay}
        title={t("replay.exit")}
        className="p-1.5 rounded bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-300"
        aria-label={t("replay.exit")}
      >
        <X size={12} />
      </button>
    </div>
  );
}
