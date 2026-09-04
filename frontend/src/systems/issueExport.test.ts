import { describe, it, expect } from "vitest";
import { issuesToCSV, issuesToMarkdown } from "./issueExport";
import type { Issue } from "./issueClassifier";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "i1",
    kind: "tool_failure",
    severity: "high",
    title: "Bash failed",
    description: "exit code 1",
    suggestion: "check the terminal",
    agentId: "a1",
    agentName: "Editor",
    toolName: "Bash",
    toolInput: null,
    toolUseId: null,
    eventType: "post_tool_use",
    createdAt: 1000,
    resolvedAt: null,
    dismissed: false,
    ...overrides,
  };
}

describe("issuesToCSV", () => {
  it("emits a header row plus one row per issue", () => {
    const csv = issuesToCSV([makeIssue()]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "createdAt,severity,kind,title,description,agent,toolName,status",
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Bash failed");
    expect(lines[1]).toContain("open");
  });

  it("quotes fields containing commas or quotes", () => {
    const csv = issuesToCSV([
      makeIssue({ description: 'has, a comma and a "quote"' }),
    ]);
    expect(csv).toContain('"has, a comma and a ""quote"""');
  });

  it("orders rows chronologically regardless of input order", () => {
    const csv = issuesToCSV([
      makeIssue({ id: "later", createdAt: 2000, title: "Second" }),
      makeIssue({ id: "earlier", createdAt: 1000, title: "First" }),
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toContain("First");
    expect(lines[2]).toContain("Second");
  });

  it("reports dismissed and resolved status correctly", () => {
    const csv = issuesToCSV([
      makeIssue({ id: "a", dismissed: true, resolvedAt: 500 }),
      makeIssue({ id: "b", resolvedAt: 500 }),
      makeIssue({ id: "c" }),
    ]);
    const lines = csv.split("\n").slice(1);
    expect(lines[0]).toContain("dismissed");
    expect(lines[1]).toContain("resolved");
    expect(lines[2]).toContain("open");
  });
});

describe("issuesToMarkdown", () => {
  it("renders a table with one row per issue", () => {
    const md = issuesToMarkdown([makeIssue(), makeIssue({ id: "i2" })]);
    expect(md).toContain("| Time | Severity | Title | Agent | Status |");
    expect(md.split("\n").filter((l) => l.startsWith("| "))).toHaveLength(3); // header + 2 rows
  });

  it("escapes pipe characters in cell content", () => {
    const md = issuesToMarkdown([makeIssue({ title: "a | b" })]);
    expect(md).toContain("a \\| b");
  });

  it("handles an empty issue list without crashing", () => {
    const md = issuesToMarkdown([]);
    expect(md).toContain("No issues recorded");
  });
});
