/**
 * IssuesPanel - the "something needs you" list.
 *
 * Open issues (tool failures, blocked tools, agents waiting on you, ...) are
 * tappable cards; tapping opens IssueDetailModal with the explanation and the
 * fix actions. Resolved issues stay below, dimmed, for context.
 */

"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  useIssuesStore,
  selectOpenIssues,
  selectResolvedIssues,
} from "@/stores/issuesStore";
import type { Issue } from "@/systems/issueClassifier";
import { IssueDetailModal } from "@/components/game/IssueDetailModal";
import {
  SEVERITY_BORDER_CLASSES,
  SEVERITY_ICONS,
} from "@/components/game/issueStyles";
import { useTranslation } from "@/hooks/useTranslation";

const MAX_RESOLVED_SHOWN = 20;

export function IssuesPanel() {
  const { t } = useTranslation();
  const openIssues = useIssuesStore(useShallow(selectOpenIssues));
  const resolvedIssues = useIssuesStore(useShallow(selectResolvedIssues));
  const [selected, setSelected] = useState<Issue | null>(null);

  return (
    <>
      <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden font-mono text-xs">
        <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-slate-300 font-bold uppercase tracking-wider">
            <AlertTriangle
              size={14}
              className={openIssues.length ? "text-red-500" : "text-slate-600"}
            />
            {t("issues.title")}
          </div>
          <div className="text-slate-500">
            {t("issues.openCount", { count: openIssues.length })}
          </div>
        </div>

        <div className="flex-grow overflow-y-auto p-2 space-y-1">
          {openIssues.length === 0 && resolvedIssues.length === 0 ? (
            <div className="text-slate-600 italic p-4 text-center">
              {t("issues.empty")}
            </div>
          ) : (
            <>
              {openIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onClick={() => setSelected(issue)}
                />
              ))}

              {resolvedIssues.length > 0 && (
                <div className="pt-2">
                  <div className="text-slate-600 text-[10px] uppercase tracking-widest px-2 pb-1 flex items-center gap-1">
                    <CheckCircle2 size={10} />
                    {t("issues.resolved")}
                  </div>
                  {resolvedIssues.slice(0, MAX_RESOLVED_SHOWN).map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onClick={() => setSelected(issue)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selected && (
        <IssueDetailModal issue={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function IssueCard({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  const { t } = useTranslation();
  const resolved = issue.resolvedAt !== null;
  const actor =
    issue.agentId === "main" || !issue.agentId
      ? t("issues.boss")
      : (issue.agentName ?? issue.agentId);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`px-2 py-1.5 rounded border-l-2 cursor-pointer transition-colors hover:bg-white/5 ${
        resolved
          ? "border-slate-700 opacity-50"
          : SEVERITY_BORDER_CLASSES[issue.severity]
      }`}
    >
      <div className="flex gap-2 items-center">
        <span className="text-[10px]">
          {resolved ? "✅" : SEVERITY_ICONS[issue.severity]}
        </span>
        <span className="text-slate-100 font-bold text-[11px] truncate">
          {issue.title}
        </span>
        <span className="ml-auto text-slate-500 flex-shrink-0">
          {format(issue.createdAt, "HH:mm:ss")}
        </span>
      </div>
      <div
        className="text-slate-400 text-[10px] truncate"
        title={issue.description}
      >
        <span className="text-blue-400">{actor}</span> · {issue.description}
      </div>
    </div>
  );
}
