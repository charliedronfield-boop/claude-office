import { describe, it, expect } from "vitest";
import { milestoneTier } from "./roomMilestones";

describe("milestoneTier", () => {
  it("returns null below the lowest threshold", () => {
    expect(milestoneTier(0)).toBeNull();
    expect(milestoneTier(4)).toBeNull();
  });

  it("returns bronze at the first threshold", () => {
    expect(milestoneTier(5)).toBe("🥉");
    expect(milestoneTier(14)).toBe("🥉");
  });

  it("returns silver at the second threshold", () => {
    expect(milestoneTier(15)).toBe("🥈");
    expect(milestoneTier(29)).toBe("🥈");
  });

  it("returns gold at the top threshold and beyond", () => {
    expect(milestoneTier(30)).toBe("🏆");
    expect(milestoneTier(1000)).toBe("🏆");
  });
});
