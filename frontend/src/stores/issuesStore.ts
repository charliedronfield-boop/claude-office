"use client";

import { create } from "zustand";
import {
  WAITING_KINDS,
  type Issue,
  type IssueKind,
} from "@/systems/issueClassifier";

const MAX_ISSUES = 200;

interface IssuesState {
  issues: Issue[];
  /** Wall-clock ms of the last critical issue added (drives tab auto-focus). */
  lastCriticalAt: number | null;

  addIssue: (issue: Issue) => void;
  resolveIssue: (id: string) => void;
  dismissIssue: (id: string) => void;
  /** Resolve open waiting-type issues for an agent (or every agent when null). */
  resolveWaitingFor: (agentId: string | null) => void;
  resolveKindFor: (kind: IssueKind, agentId: string | null) => void;
  reset: () => void;
}

function isOpen(issue: Issue): boolean {
  return issue.resolvedAt === null && !issue.dismissed;
}

function isDuplicate(existing: Issue, incoming: Issue): boolean {
  return (
    isOpen(existing) &&
    existing.kind === incoming.kind &&
    existing.agentId === incoming.agentId &&
    existing.toolName === incoming.toolName &&
    existing.description === incoming.description
  );
}

export const useIssuesStore = create<IssuesState>()((set) => ({
  issues: [],
  lastCriticalAt: null,

  addIssue: (issue) =>
    set((state) => {
      if (state.issues.some((existing) => isDuplicate(existing, issue))) {
        return state;
      }
      return {
        issues: [issue, ...state.issues].slice(0, MAX_ISSUES),
        lastCriticalAt:
          issue.severity === "critical" ? Date.now() : state.lastCriticalAt,
      };
    }),

  resolveIssue: (id) =>
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === id && issue.resolvedAt === null
          ? { ...issue, resolvedAt: Date.now() }
          : issue,
      ),
    })),

  dismissIssue: (id) =>
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === id ? { ...issue, dismissed: true } : issue,
      ),
    })),

  resolveWaitingFor: (agentId) =>
    set((state) => {
      const now = Date.now();
      let changed = false;
      const issues = state.issues.map((issue) => {
        const matchesAgent = agentId === null || issue.agentId === agentId;
        if (isOpen(issue) && WAITING_KINDS.has(issue.kind) && matchesAgent) {
          changed = true;
          return { ...issue, resolvedAt: now };
        }
        return issue;
      });
      return changed ? { issues } : state;
    }),

  resolveKindFor: (kind, agentId) =>
    set((state) => {
      const now = Date.now();
      let changed = false;
      const issues = state.issues.map((issue) => {
        if (isOpen(issue) && issue.kind === kind && issue.agentId === agentId) {
          changed = true;
          return { ...issue, resolvedAt: now };
        }
        return issue;
      });
      return changed ? { issues } : state;
    }),

  reset: () => set({ issues: [], lastCriticalAt: null }),
}));

// ============================================================================
// SELECTORS
// ============================================================================

export const selectOpenIssues = (state: IssuesState): Issue[] =>
  state.issues.filter(isOpen);

export const selectResolvedIssues = (state: IssuesState): Issue[] =>
  state.issues.filter((issue) => issue.resolvedAt !== null && !issue.dismissed);

export const selectOpenCount = (state: IssuesState): number =>
  state.issues.reduce((count, issue) => count + (isOpen(issue) ? 1 : 0), 0);

export const selectHasOpenCritical = (state: IssuesState): boolean =>
  state.issues.some((issue) => isOpen(issue) && issue.severity === "critical");

export const selectLastCriticalAt = (state: IssuesState): number | null =>
  state.lastCriticalAt;

export const selectOpenIssueAgentIds = (state: IssuesState): string[] =>
  Array.from(
    new Set(
      state.issues
        .filter((issue) => isOpen(issue) && issue.agentId)
        .map((issue) => issue.agentId as string),
    ),
  );

export const hasOpenIssue = (state: IssuesState, agentId: string): boolean =>
  state.issues.some((issue) => isOpen(issue) && issue.agentId === agentId);
