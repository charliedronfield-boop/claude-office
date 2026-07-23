"use client";

/**
 * useMultiWebSocket — LOCAL PATCH.
 *
 * Connects to the global `/ws/multi` feed that carries full per-session game
 * state (boss AND agents) for every live session — the Multi Office view.
 * Separate from useWebSocketEvents (session-bound) and useOverviewWebSocket
 * (boss-only summaries for Command Center). Mirrors useOverviewWebSocket's
 * reconnect/backoff/connection-id-guard pattern exactly, just against
 * multiOfficeStore and the /ws/multi payload shape instead.
 */

import { useCallback, useEffect, useRef } from "react";
import { useMultiOfficeStore } from "@/stores/multiOfficeStore";
import type { GameState } from "@/types";

export function useMultiWebSocket({ enabled }: { enabled: boolean }): void {
  const wsRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const retryCountRef = useRef(0);
  const enabledRef = useRef(enabled);
  const connectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const setSessions = useMultiOfficeStore((s) => s.setSessions);
  const setConnected = useMultiOfficeStore((s) => s.setConnected);

  const connect = useCallback(() => {
    connectionIdRef.current++;
    const thisConnectionId = connectionIdRef.current;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl =
      process.env.NEXT_PUBLIC_WS_URL ||
      `${wsScheme}://${window.location.hostname}:8000`;
    const ws = new WebSocket(`${wsUrl}/ws/multi`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (connectionIdRef.current !== thisConnectionId) {
        ws.close();
        return;
      }
      retryCountRef.current = 0;
      setConnected(true);
    };

    ws.onmessage = (event) => {
      if (connectionIdRef.current !== thisConnectionId) return;
      try {
        const msg = JSON.parse(event.data) as {
          type?: string;
          state?: { sessions?: Record<string, GameState> };
        };
        if (msg.type === "state_update") {
          if (
            msg.state &&
            typeof msg.state.sessions === "object" &&
            msg.state.sessions !== null
          ) {
            setSessions(msg.state.sessions);
          } else {
            console.warn("[multi WS] ignoring malformed state_update frame");
          }
        }
      } catch {
        // Ignore malformed frames.
      }
    };

    ws.onerror = () => {
      if (connectionIdRef.current !== thisConnectionId) return;
      console.warn("[multi WS] connection error — will retry");
    };

    ws.onclose = () => {
      if (connectionIdRef.current !== thisConnectionId) return;
      setConnected(false);
      if (enabledRef.current) {
        // Exponential backoff with random jitter (0-500ms), same as
        // useOverviewWebSocket, so many clients don't reconnect in lockstep.
        const baseDelay = Math.min(
          1000 * Math.pow(2, retryCountRef.current),
          30000,
        );
        const delay = baseDelay + Math.random() * 500;
        retryCountRef.current++;
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (enabledRef.current) connectRef.current?.();
        }, delay);
      }
    };
  }, [setConnected, setSessions]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!enabled) {
      connectionIdRef.current++;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setConnected(false);
      useMultiOfficeStore.getState().clear();
      return;
    }

    connect();

    const connectionIdAtSetup = connectionIdRef;
    return () => {
      connectionIdAtSetup.current++;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setConnected(false);
      useMultiOfficeStore.getState().clear();
    };
  }, [enabled, connect, setConnected]);
}
