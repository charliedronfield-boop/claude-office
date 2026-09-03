#!/usr/bin/env python3
import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Any

# Constants
HOOK_TYPES = [
    "SessionStart",
    "SessionEnd",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit",
    "PermissionRequest",
    "PermissionDenied",
    "Notification",
    "Stop",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
]


def get_settings_path() -> Path:
    """Get the path to the Claude settings file."""
    # Priority: Env var -> ~/.claude/settings.json
    if os.environ.get("CLAUDE_CONFIG_DIR"):
        return Path(os.environ["CLAUDE_CONFIG_DIR"]) / "settings.json"
    return Path.home() / ".claude" / "settings.json"


def load_settings(path: Path) -> dict[str, Any]:
    """Load settings from JSON file.

    A missing file returns ``{}`` (fresh install). A file that exists but
    fails to parse is a hard stop: returning ``{}`` here would cause the
    caller to write a near-empty dict back over the user's real config and
    silently wipe unrelated settings (permissions, env, model, statusline).
    """
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise SystemExit(
            f"ERROR: {path} exists but is not valid JSON ({e}).\n"
            "Refusing to continue: proceeding would overwrite your settings.\n"
            "Fix or move the file, then re-run install."
        ) from e


def save_settings(path: Path, settings: dict[str, Any]) -> None:
    """Save settings atomically, backing up the original once per run.

    Writes a temp file in the same directory then ``os.replace``s it into
    place, so a crash mid-write cannot leave a truncated ``settings.json``.
    The first mutation of an existing file is snapshotted to
    ``settings.json.bak``; the ``if not backup.exists()`` guard preserves
    the oldest known-good copy across repeated runs.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_suffix(".json.bak")
        if not backup.exists():
            shutil.copy2(path, backup)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)


# Every hook is fire-and-forget except PermissionRequest, which blocks
# waiting for a human to click Approve/Deny in the office UI (see
# app/core/permission_gate.py + claude_office_hooks/main.py). Its timeout
# must comfortably exceed PERMISSION_WAIT_TIMEOUT in config.py (default
# 110s) so Claude Code doesn't kill the process before the office UI can
# answer. Override with CLAUDE_OFFICE_PERMISSION_TIMEOUT at install time to
# match a custom PERMISSION_WAIT_TIMEOUT.
_DEFAULT_TIMEOUT = 2  # Seconds — every fire-and-forget hook.
_PERMISSION_HOOK_TIMEOUT = int(os.environ.get("CLAUDE_OFFICE_PERMISSION_TIMEOUT", "110")) + 20


def create_hook_config(hook_cmd: str, hook_type: str) -> dict[str, Any]:
    """Create the hook configuration dictionary.

    Args:
        hook_cmd: Path to the claude-office-hook command
        hook_type: The hook type in PascalCase (e.g., "PreToolUse")
    """
    # Convert PascalCase to snake_case for the event type argument
    event_type = convert_camel_to_snake(hook_type)

    timeout = _PERMISSION_HOOK_TIMEOUT if hook_type == "PermissionRequest" else _DEFAULT_TIMEOUT
    config = {
        "type": "command",
        "command": f"{hook_cmd} {event_type}",
        "timeout": timeout,
    }

    # Wrap in the structure expected by Claude Code
    # Structure:
    # "HookName": [
    #   {
    #     "matcher": ".*" (optional),
    #     "hooks": [ { "type": "command", ... } ]
    #   }
    # ]

    hook_entry: dict[str, Any] = {"hooks": [config]}

    # Hooks that support matchers (match all with ".*")
    if hook_type in [
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PermissionRequest",
        "PermissionDenied",
        "Notification",
        "SubagentStart",
        "SubagentStop",
    ]:
        hook_entry["matcher"] = ".*"

    return hook_entry


def is_same_hook(entry1: dict[str, Any], entry2: dict[str, Any]) -> bool:
    """Check if two hook entries invoke the same command (ignoring timeout)."""
    try:
        cmd1 = entry1.get("hooks", [])[0].get("command")
        cmd2 = entry2.get("hooks", [])[0].get("command")
        return cmd1 == cmd2
    except (IndexError, AttributeError):
        return False


def _entry_timeout(entry: dict[str, Any]) -> int | None:
    try:
        return entry.get("hooks", [])[0].get("timeout")
    except (IndexError, AttributeError):
        return None


def install_hooks(hook_cmd: str, dry_run: bool = False):
    """Install hooks into settings.

    Args:
        hook_cmd: Path to the claude-office-hook command
        dry_run: If True, don't actually save changes
    """
    settings_path = get_settings_path()
    print(f"Installing hooks to {settings_path}...")

    settings = load_settings(settings_path)
    hooks_config = settings.get("hooks", {})

    changes_made = False

    for hook_type in HOOK_TYPES:
        new_entry = create_hook_config(hook_cmd, hook_type)
        new_timeout = _entry_timeout(new_entry)
        event_type = convert_camel_to_snake(hook_type)

        current_list = hooks_config.get(hook_type, [])

        # Same command already installed — update its timeout in place if
        # the desired value has changed (e.g. PermissionRequest's timeout
        # was bumped so it can wait on the office UI), rather than skipping
        # it outright or appending a duplicate that would fire twice.
        existing_index = next(
            (i for i, existing in enumerate(current_list) if is_same_hook(existing, new_entry)),
            None,
        )
        if existing_index is not None:
            if _entry_timeout(current_list[existing_index]) != new_timeout:
                print(f"  [Update] {hook_type}: timeout -> {new_timeout}s")
                current_list[existing_index] = new_entry
                hooks_config[hook_type] = current_list
                changes_made = True
            else:
                print(f"  [Skip] {hook_type}: Hook already exists.")
            continue

        print(f"  [Add]  {hook_type}: {hook_cmd} {event_type}")
        current_list.append(new_entry)
        hooks_config[hook_type] = current_list
        changes_made = True

    if changes_made:
        settings["hooks"] = hooks_config
        if not dry_run:
            save_settings(settings_path, settings)
            print("Settings saved.")
        else:
            print("Dry run: No changes saved.")
    else:
        print("No changes needed.")


def uninstall_hooks(_hook_cmd: str, dry_run: bool = False) -> None:
    """Remove hooks from settings.

    Args:
        _hook_cmd: Path to the claude-office-hook command (unused, hooks identified by pattern)
        dry_run: If True, don't actually save changes
    """
    del _hook_cmd  # Unused - hooks identified by pattern match
    settings_path = get_settings_path()
    print(f"Uninstalling hooks from {settings_path}...")

    settings = load_settings(settings_path)
    hooks_config = settings.get("hooks", {})

    changes_made = False

    for hook_type in list(hooks_config.keys()):
        current_list = hooks_config[hook_type]
        original_len = len(current_list)

        # Filter out hooks that use our command (both new direct and old .sh wrappers)
        new_list: list[Any] = []
        for entry in current_list:
            try:
                cmd = entry.get("hooks", [])[0].get("command", "")
                # Match both "claude-office-hook" (new) and "claude-office/hooks/*.sh" (old)
                if "claude-office-hook" in cmd or "claude-office/hooks/" in cmd:
                    print(f"  [Remove] {hook_type}: {cmd}")
                    continue
            except (IndexError, AttributeError):
                pass
            new_list.append(entry)

        if len(new_list) < original_len:
            hooks_config[hook_type] = new_list
            changes_made = True

        # Clean up empty lists
        if not hooks_config[hook_type]:
            del hooks_config[hook_type]

    if changes_made:
        settings["hooks"] = hooks_config
        if not dry_run:
            save_settings(settings_path, settings)
            print("Settings saved.")
        else:
            print("Dry run: No changes saved.")
    else:
        print("No hooks found to remove.")


def convert_camel_to_snake(name: str) -> str:
    import re

    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def main():
    parser = argparse.ArgumentParser(description="Manage Claude Office hooks.")
    parser.add_argument("action", choices=["install", "uninstall"], help="Action to perform")
    parser.add_argument("--dry-run", action="store_true", help="Don't save changes")
    parser.add_argument("--hook-cmd", help="Path to claude-office-hook command", required=True)

    args = parser.parse_args()

    if args.action == "install":
        install_hooks(args.hook_cmd, args.dry_run)
    elif args.action == "uninstall":
        uninstall_hooks(args.hook_cmd, args.dry_run)


if __name__ == "__main__":
    main()
