/**
 * A short synthesized chime for critical issues (permission denials, turn
 * failures, needs-approval) — so one doesn't depend on the tab being
 * focused/visible to notice. Web Audio oscillator, not an audio asset: no
 * file to ship, no licensing to think about.
 *
 * Best-effort throughout: browsers gate AudioContext until a user gesture
 * has happened on the page, and this must never throw into a WS event
 * handler over something as unimportant as a missed beep.
 */

let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined" || !window.AudioContext) return null;
  if (!sharedContext) sharedContext = new window.AudioContext();
  return sharedContext;
}

/** Two quick descending tones — an alert, not a doorbell. */
export function playCriticalIssueChime(): void {
  try {
    const ctx = getContext();
    if (!ctx) return;
    void ctx.resume();

    const now = ctx.currentTime;
    const notes: [freq: number, start: number][] = [
      [880, 0],
      [660, 0.09],
    ];
    for (const [freq, offset] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.15, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.16);
    }
  } catch {
    // Best-effort — a blocked/unsupported AudioContext is not an error.
  }
}
