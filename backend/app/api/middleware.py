"""HTTP middleware for the Claude Office backend.

Moved out of ``app.main`` in ARC-023. The trust boundary and auth behavior
live here: ``LocalhostOnlyMiddleware`` restricts access to the loopback
interface, and ``ApiKeyMiddleware`` gates state-changing endpoints behind
either an explicit user-configured key or the per-launch auto-generated
token (SEC-001 / SEC-002 / SEC-006). Logic is unchanged from the prior
inline version in ``main.py``.

LOCAL PATCH: ``LocalhostOnlyMiddleware`` additionally allows read-only (GET)
requests from the user's own private network (RFC1918), so the visualizer
can be viewed from a phone on the same home Wi-Fi. State-changing requests
(POST/PUT/PATCH/DELETE) — including subprocess execution and clipboard
writes — still require true loopback regardless of network origin. This is
a deliberate, scoped widening for a trusted home LAN, not a fix upstream;
do not carry it forward to a shared/untrusted network.
"""

import hmac
import ipaddress

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings

# Resolved once at import time, mirroring the previous ``main.py`` pattern.
# ``Settings`` is a pydantic-settings singleton; subsequent ``get_settings()``
# calls return the same instance, so call-time attribute access is identical.
settings = get_settings()

_LOCALHOST_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})


def _is_private_network_host(host: str) -> bool:
    """True if *host* is a private-network (LAN) IP address.

    Covers RFC1918 (10/8, 172.16/12, 192.168/16) plus link-local/ULA ranges
    via ``ipaddress``'s ``is_private``. Used only to widen read-only (GET)
    access for LAN viewing — never applied to state-changing requests.

    Excludes the unspecified address (0.0.0.0 / ::) even though ``is_private``
    counts it as private — it's a bind-any-interface meta address, never a
    real client's source IP, and excluding it keeps this consistent with the
    WebSocket-layer equivalent (``_is_local_ws_host`` in ``app/api/websocket.py``).
    """
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private and not ip.is_unspecified
    except ValueError:
        return False


class LocalhostOnlyMiddleware(BaseHTTPMiddleware):
    """Restrict state-changing requests to loopback; allow read-only (GET)
    requests from the local private network too (LOCAL PATCH, for LAN/phone
    viewing — see module docstring).

    This is a local-only development tool, not deployed to the public internet.
    Endpoints with real side effects (including subprocess execution and
    clipboard writes) are always restricted to the loopback interface,
    regardless of network origin.

    ``"testclient"`` is the sentinel host used by Starlette's test transport
    and cannot appear on a real TCP connection, so it is safe to allow.
    """

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        client_host = request.client.host if request.client else None

        if client_host in _LOCALHOST_HOSTS:
            return await call_next(request)

        if (
            request.method == "GET"
            and client_host is not None
            and _is_private_network_host(client_host)
        ):
            return await call_next(request)

        return JSONResponse(
            status_code=403,
            content={"detail": "Access denied: localhost only"},
        )


# Paths that do NOT require an API key (health checks, interactive docs).
# The OpenAPI schema URL is checked separately in the middleware because it is
# served under settings.API_V1_STR (e.g. /api/v1/openapi.json), not /openapi.json.
_NO_AUTH_PATHS = frozenset({"/health", "/docs", "/redoc"})


def _is_state_changing(path: str, method: str) -> bool:
    """Return True if the request targets a destructive or side-effecting endpoint.

    Covers global destructive operations (clearing all sessions, running a
    simulation) and per-session OS side effects (terminal activation + clipboard
    write via ``/focus``). Other per-session mutations remain open in the default
    configuration and are fully gated when an explicit key is set (handled by
    ``settings.has_explicit_key`` in the middleware).
    """
    prefix = settings.API_V1_STR + "/sessions"
    return (
        (path == prefix and method == "DELETE")
        or (path == f"{prefix}/simulate" and method == "POST")
        or (path.startswith(f"{prefix}/") and path.endswith("/focus") and method == "POST")
    )


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """Validate X-API-Key header for protected endpoints.

    * When ``CLAUDE_OFFICE_API_KEY`` is explicitly set, ALL non-public paths
      require the key (existing behaviour).
    * When the key is empty (default), state-changing endpoints still require
      the per-launch auto-generated token (``settings.effective_api_key``).
      Read-only paths remain open for backwards compatibility.
    """

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        if request.method == "OPTIONS":
            return await call_next(request)

        # Skip auth for public paths and WebSocket handshakes
        if (
            request.url.path in _NO_AUTH_PATHS
            or request.url.path == f"{settings.API_V1_STR}/openapi.json"
            or request.url.path.startswith("/ws/")
        ):
            return await call_next(request)

        # Determine whether auth is required for this request
        requires_auth = settings.has_explicit_key or _is_state_changing(
            request.url.path, request.method
        )

        if not requires_auth:
            return await call_next(request)

        provided = request.headers.get("X-API-Key", "")
        if not hmac.compare_digest(provided, settings.effective_api_key):
            return JSONResponse(status_code=401, content={"detail": "Invalid API key"})

        return await call_next(request)
