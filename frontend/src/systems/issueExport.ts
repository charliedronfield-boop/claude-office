/**
 * Pure serializers for exporting the Issues panel's history — CSV for a
 * spreadsheet, Markdown for a quick paste into notes/a PR description.
 * Includes every issue ever seen this session (open, resolved, dismissed),
 * oldest first, since this is "for your records" rather than the live view.
 */

import type { Issue } from "./issueClassifier";

const CSV_HEADERS = [
  "createdAt",
  "severity",
  "kind",
  "title",
  "description",
  "agent",
  "toolName",
  "status",
] as const;

function statusOf(issue: Issue): "open" | "resolved" | "dismissed" {
  if (issue.dismissed) return "dismissed";
  return issue.resolvedAt !== null ? "resolved" : "open";
}

function chronological(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => a.createdAt - b.createdAt);
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function issuesToCSV(issues: Issue[]): string {
  const rows = chronological(issues).map((issue) =>
    [
      new Date(issue.createdAt).toISOString(),
      issue.severity,
      issue.kind,
      issue.title,
      issue.description,
      issue.agentName ?? issue.agentId ?? "",
      issue.toolName ?? "",
      statusOf(issue),
    ]
      .map(csvField)
      .join(","),
  );
  return [CSV_HEADERS.join(","), ...rows].join("\n");
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function issuesToMarkdown(issues: Issue[]): string {
  const ordered = chronological(issues);
  if (ordered.length === 0) return "# Issues\n\nNo issues recorded this session.\n";

  const header = "| Time | Severity | Title | Agent | Status |";
  const divider = "|---|---|---|---|---|";
  const rows = ordered.map((issue) => {
    const time = new Date(issue.createdAt).toLocaleTimeString();
    const agent = markdownCell(issue.agentName ?? issue.agentId ?? "—");
    return `| ${time} | ${issue.severity} | ${markdownCell(issue.title)} | ${agent} | ${statusOf(issue)} |`;
  });
  return ["# Issues", "", header, divider, ...rows].join("\n") + "\n";
}

/** Triggers a browser download of `content` as a file named `filename`. */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
