import { describe, it, expect } from "vitest";
import { playCriticalIssueChime } from "./audioCues";

describe("playCriticalIssueChime", () => {
  it("never throws, even without a window/AudioContext (this test suite runs in Node)", () => {
    expect(() => playCriticalIssueChime()).not.toThrow();
  });
});
