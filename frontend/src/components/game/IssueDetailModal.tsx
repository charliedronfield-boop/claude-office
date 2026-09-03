/**
 * IssueDetailModal - explains one issue and offers the actions that fix it:
 * jump to the terminal, copy the error text, or mark it as fixed.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { X, TerminalSquare, Copy, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import type { Issue } from "@/systems/issueClassifier";
import { useIssuesStore } from "@/stores/issuesStore";
import { useAttentionStore } from "@/stores/attentionStore";
import { useGameStore, selectSessionId, selectAgents } from "@/stores/gameStore";
import { useTranslation } from "@/hooks/useTranslation";
import { getRoomForDesk } from "@/systems/officeRooms";
import { SEVERITY_BADGE_CLASSES, SEVERITY_ICONS } from "./issueStyles";

interface IssueDetailModalProps {
  issue: Issue;
  onClose: () => void;
}

export function IssueDetailModal({ issue, onClose }: IssueDetailModalProps) {
  const { t } = useTranslation();
  const sessionId = useGameStore(selectSessionId);
  const agents = useGameStore(selectAgents);
  const focusAgentTerminal = useAttentionStore((s) => s.focusAgentTerminal);
  const resolveIssue = useIssuesStore((s) => s.resolveIssue);
  const [copied, setCopied] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const agent = issue.agentId ? agents.get(issue.agentId) : undefined;
  const room = agent ? getRoomForDesk(agent.desk) : null;
  const actorLabel =
    issue.agentId === "main" || !issue.agentId
      ? t("issues.boss")
      : (issue.agentName ?? agent?.name ?? issue.agentId);

  const handleOpenTerminal = () => {
    if (!sessionId) return;
    void focusAgentTerminal(sessionId, issue.agentId);
  };

  const handleCopy = async () => {
    const text = [issue.title, issue.description, issue.toolInput ? JSON.stringify(issue.toolInput, null, 2) : ""]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the text is still visible on screen.
    }
  };

  const handleMarkFixed = () => {
    resolveIssue(issue.id);
    onClose();
  };

  const isOpen = issue.resolvedAt === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={issue.title}
        className="relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden font-mono text-xs"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-950 flex-shrink-0">
          <span
            className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${SEVERITY_BADGE_CLASSES[issue.severity]}`}
          >
            {SEVERITY_ICONS[issue.severity]} {t(`issues.severity.${issue.severity}`)}
          </span>
          <span className="text-slate-200 text-[12px] font-bold truncate">
            {issue.title}
          </span>
          <span className="text-slate-500 text-[11px] flex-shrink-0">
            {format(issue.createdAt, "HH:mm:ss")}
          </span>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 text-slate-500 hover:text-white hover:bg-slate-700 rounded transition-colors"
            aria-label={t("modal.close")}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-grow overflow-y-auto p-4 space-y-3">
          <Section label={t("issues.whatHappened")}>
            <div className="text-slate-200 text-[12px] whitespace-pre-wrap leading-relaxed">
              {issue.description}
            </div>
          </Section>

          <Section label={t("issues.suggestedFix")}>
            <div className="text-emerald-300 text-[12px] whitespace-pre-wrap leading-relaxed bg-emerald-950/30 border border-emerald-900/50 rounded p-2">
              {issue.suggestion}
            </div>
          </Section>

          <Section label={t("issues.agent")}>
            <div className="text-blue-300 text-[12px]">
              {actorLabel}
              {room && <span className="text-slate-500"> · {room.name}</span>}
            </div>
          </Section>

          {issue.toolName && (
            <Section label={t("issues.tool")}>
              <div className="text-amber-300 text-[12px]">{issue.toolName}</div>
            </Section>
          )}

          {issue.toolInput && (
            <Section label={t("issues.toolInput")}>
              <pre className="text-slate-300 text-[11px] bg-slate-800 rounded p-3 border border-slate-700 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
                {JSON.stringify(issue.toolInput, null, 2)}
              </pre>
            </Section>
          )}

          {issue.resolvedAt !== null && (
            <div className="text-slate-500 text-[11px]">
              {t("issues.resolvedAt")} {format(issue.resolvedAt, "HH:mm:ss")}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-slate-700 bg-slate-950 flex flex-wrap gap-2 justify-end">
          <button
            onClick={handleOpenTerminal}
            disabled={!sessionId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-xs font-bold rounded transition-colors"
          >
            <TerminalSquare size={13} />
            {t("issues.openTerminal")}
          </button>
          <button
            onClick={() => void handleCopy()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded transition-colors"
          >
            <Copy size={13} />
            {copied ? t("issues.copied") : t("issues.copyError")}
          </button>
          {isOpen && (
            <button
              onClick={handleMarkFixed}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded transition-colors"
            >
              <CheckCircle2 size={13} />
              {t("issues.markFixed")}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded transition-colors"
          >
            {t("modal.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
