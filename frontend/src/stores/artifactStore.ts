"use client";

/**
 * Tracks recent Write/Edit file paths per room — "what's been produced
 * where" for the Artifacts whiteboard mode. Deliberately paths only, no
 * file content: reading arbitrary local files by path and serving them to
 * the browser is a real new capability with its own security surface (path
 * traversal, sensitive file exposure) that this feature doesn't need to
 * take on to be useful — a scannable list of recent writes already answers
 * "what got written where" at a glance.
 */

import { create } from "zustand";

export interface Artifact {
  id: string;
  roomId: string;
  path: string;
  tool: string;
  agentName: string | null;
  createdAt: number;
}

const MAX_ARTIFACTS = 40;

interface ArtifactState {
  artifacts: Artifact[]; // newest first
  add: (artifact: Omit<Artifact, "id" | "createdAt">) => void;
  reset: () => void;
}

export const useArtifactStore = create<ArtifactState>()((set) => ({
  artifacts: [],

  add: (artifact) =>
    set((state) => ({
      artifacts: [
        { ...artifact, id: `${Date.now()}-${Math.random()}`, createdAt: Date.now() },
        ...state.artifacts,
      ].slice(0, MAX_ARTIFACTS),
    })),

  reset: () => set({ artifacts: [] }),
}));

export const ARTIFACT_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit"]);
