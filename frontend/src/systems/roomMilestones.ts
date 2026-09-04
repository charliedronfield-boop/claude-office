/**
 * Room achievement tiers — a lightweight "reward" on top of roomStatsStore's
 * pass/fail tally: once a room racks up enough successful tool calls this
 * session, a small badge shows on its placard. Not per-agent desk items (the
 * `/desk-accessory` skill needs an image-generation MCP this session doesn't
 * have) — a per-room milestone reusing data already tracked for the Room
 * Stats whiteboard mode, so no new backend signal or generated art either.
 */

export type MilestoneTier = "🥉" | "🥈" | "🏆" | null;

/** Ordered high-to-low so the first threshold met wins. */
const TIERS: readonly [threshold: number, tier: MilestoneTier][] = [
  [30, "🏆"],
  [15, "🥈"],
  [5, "🥉"],
];

/** Returns the highest tier `successCount` has reached, or null if under 5. */
export function milestoneTier(successCount: number): MilestoneTier {
  for (const [threshold, tier] of TIERS) {
    if (successCount >= threshold) return tier;
  }
  return null;
}
