import hmac
import ipaddress
import re
from urllib.parse import urlparse

from fastapi import WebSocket

# ``ConnectionManager`` and the ``manager`` singleton live in the domain layer
# (``app.core.connection_manager``) so that ``core/`` and ``services/`` need not
# import from ``app.api`` (ARC-011). They are re-exported here for backward
# compatibility with transport-level consumers (``app.main``, route handlers).
from app.core.connection_manager import (  # noqa: F401
    ConnectionManager as ConnectionManager,
)
from app.core.connection_manager import (
    get_manager as get_manager,
)
from app.core.connection_manager import (
    manager as manager,
)
from app.core.connection_manager import (
    override_manager as override_manager,
)

# Valid session/room IDs: alphanumeric, dashes, underscores only
_VALID_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")

# Loopback hosts permitted for browser WebSocket handshakes. The allowlist is
# derived from ``settings.BACKEND_CORS_ORIGINS`` at call time but filtered to
# these hosts so a CORS-config change can never widen the WS trust boundary
# beyond the local machine (QA-014).
#
# LOCAL PATCH: the filter below (``_is_local_ws_host``) additionally accepts
# private-network (RFC1918) hostnames, so the WS stream — which only ever
# carries read-only visualization data — can reach a phone on the same home
# Wi-Fi. This is a deliberate, scoped widening from "loopback only" to "this
# trusted LAN only"; it still cannot reach beyond the local private network,
# preserving the QA-014 property in spirit. Do not carry forward to a
# shared/untrusted network.
_LOCALHOST_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def _is_local_ws_host(hostname: str | None) -> bool:
    """True if *hostname* is loopback or a private-network (LAN) address.

    Excludes the unspecified address (0.0.0.0 / ::) even though Python's
    ``is_private`` counts it as private: it's a bind-any-interface meta
    address, never a real client's origin host, and QA-014's own test suite
    (test_security_hardening.py) asserts it stays rejected even when present
    in BACKEND_CORS_ORIGINS.
    """
    if hostname in _LOCALHOST_HOSTS:
        return True
    if hostname is None:
        return False
    try:
        ip = ipaddress.ip_address(hostname)
        return ip.is_private and not ip.is_unspecified
    except ValueError:
        return False


def _allowed_ws_origins() -> frozenset[str]:
    """Origins permitted for WebSocket connections, derived from settings.

    Filtered to loopback and private-network (LAN) hosts (LOCAL PATCH) so a
    CORS-config change can only ever widen the WS trust boundary to the
    user's own local network — never to the public internet.
    """
    from app.config import get_settings

    return frozenset(
        origin.rstrip("/")
        for origin in get_settings().BACKEND_CORS_ORIGINS
        if _is_local_ws_host(urlparse(origin).hostname)
    )


def validate_websocket_origin(websocket: WebSocket) -> bool:
    """Check the Origin header on a WebSocket handshake.

    Browser connections must come from an allowed localhost origin.
    Non-browser connections (no Origin header) must present a valid
    X-API-Key matching the *effective* API key (either user-configured
    or the per-launch auto-generated token).  This prevents arbitrary
    local processes from subscribing to the session-state stream when
    no explicit key is configured.
    """
    origin = websocket.headers.get("origin")
    if origin is not None:
        return origin.rstrip("/") in _allowed_ws_origins()

    # Non-browser clients (no Origin) — always require the effective API key
    from app.config import get_settings

    key = get_settings().effective_api_key
    provided = websocket.headers.get("x-api-key", "")
    return hmac.compare_digest(provided, key)


def validate_session_id(session_id: str) -> bool:
    """Return True if *session_id* matches the expected format."""
    return bool(_VALID_ID_PATTERN.match(session_id))
