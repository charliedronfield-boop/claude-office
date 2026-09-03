import type { IssueSeverity } from "@/systems/issueClassifier";

export const SEVERITY_BADGE_CLASSES: Record<IssueSeverity, string> = {
  critical: "border-red-500 bg-red-950/80 text-red-300",
  high: "border-orange-500 bg-orange-950/80 text-orange-300",
  low: "border-slate-500 bg-slate-800 text-slate-300",
};

export const SEVERITY_BORDER_CLASSES: Record<IssueSeverity, string> = {
  critical: "border-red-500",
  high: "border-orange-500",
  low: "border-slate-500",
};

export const SEVERITY_ICONS: Record<IssueSeverity, string> = {
  critical: "⚠️",
  high: "🔴",
  low: "🔵",
};
