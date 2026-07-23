/**
 * Minimal API helper for authenticated requests to the backend.
 *
 * The backend no longer returns the API key over HTTP (SEC-001). Instead the
 * key is delivered out-of-band via a ?token= launch URL printed to the server
 * console; initApiKeyFromBrowser captures it into sessionStorage.
 *
 * LOCAL PATCH: the API base now derives from window.location.hostname at
 * call time (matching useWebSocketEvents.ts's existing WS URL logic) instead
 * of a hardcoded "localhost". A static NEXT_PUBLIC_API_URL still wins when
 * set, but nothing needs to be pinned to one LAN IP: viewed via localhost
 * (Mac's own display, or a second monitor on the same Mac) it correctly
 * stays on localhost, and viewed via the Mac's LAN IP (a phone, another
 * device on the network) it correctly follows to that IP too. Pinning
 * NEXT_PUBLIC_API_URL to a single LAN IP previously broke localhost viewers
 * on this same Mac, since connecting to your own machine's external-facing
 * IP from itself isn't always reliable (firewall/VPN-dependent "hairpin"
 * routing).
 */

function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
}

const KEY_STORAGE = "claude-office-api-key";

let _apiKey: string | null = null;

/** Store the API key (called from the token intake in page.tsx). */
export function setApiKey(key: string): void {
  _apiKey = key;
}

/** Retrieve the cached API key. */
export function getApiKey(): string | null {
  return _apiKey;
}

/** Read ?token= from the URL (stripping it from history) or sessionStorage. */
export function initApiKeyFromBrowser(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    setApiKey(token);
    try {
      sessionStorage.setItem(KEY_STORAGE, token);
    } catch {
      // sessionStorage may be unavailable (private mode); key stays in-memory.
    }
    params.delete("token");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : ""),
    );
    return;
  }
  try {
    const stored = sessionStorage.getItem(KEY_STORAGE);
    if (stored) setApiKey(stored);
  } catch {
    // sessionStorage unavailable; key remains unset until next ?token= intake.
  }
}

/** Fetch wrapper that attaches X-API-Key when available. */
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (_apiKey) {
    headers.set("X-API-Key", _apiKey);
  }
  return fetch(`${getApiBase()}${path}`, { ...init, headers });
}
