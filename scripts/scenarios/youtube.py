"""YouTube production scenario.

Exercises the role-based office:
1. Session starts, boss receives a "produce this week's video" prompt.
2. Four subagents are spawned with YouTube ``agent_type`` values so each one
   is routed into its own room (Scripting, Editing, Thumbnails & SEO,
   Publishing).
3. Agents work for a while with realistic tool calls, then finish.
4. Session ends.
"""

from __future__ import annotations

import random
import threading
import time
from pathlib import Path

from scripts.scenarios._base import SimulationContext

CREW: list[tuple[str, str, str, str]] = [
    # (agent_id, agent_type, display name, task)
    (
        "yt_scripter",
        "script-writer",
        "Script Writer",
        "Write a 10-minute script with a strong hook for the Q4 product breakdown video",
    ),
    (
        "yt_editor",
        "video-editor",
        "Video Editor",
        "Assemble the rough cut, add B-roll and clean up the audio track",
    ),
    (
        "yt_thumbs",
        "thumbnail-designer",
        "Thumbnail Designer",
        "Design three thumbnail variants and draft SEO title/tag options",
    ),
    (
        "yt_publisher",
        "publisher",
        "Publisher",
        "Schedule the upload, write the description and pin the community post",
    ),
]

TOOLS: dict[str, list[tuple[str, dict[str, str]]]] = {
    "yt_scripter": [
        ("Read", {"file_path": "research/product-notes.md"}),
        ("Write", {"file_path": "scripts/q4-breakdown.md"}),
        ("Edit", {"file_path": "scripts/q4-breakdown.md"}),
    ],
    "yt_editor": [
        ("Bash", {"command": "ffmpeg -i raw/take1.mov -vf scale=1920:1080 cut.mp4"}),
        ("Bash", {"command": "ffmpeg -i cut.mp4 -af loudnorm mastered.mp4"}),
        ("Read", {"file_path": "edits/timeline.json"}),
    ],
    "yt_thumbs": [
        ("Read", {"file_path": "brand/thumbnail-guidelines.md"}),
        ("Write", {"file_path": "thumbnails/variant-a.png"}),
        ("Grep", {"pattern": "keywords", "path": "seo/"}),
    ],
    "yt_publisher": [
        ("Read", {"file_path": "publish/description-template.md"}),
        ("Write", {"file_path": "publish/description.md"}),
        ("Bash", {"command": "yt upload --schedule 'Fri 16:00' mastered.mp4"}),
    ],
}


def _agent_workflow(
    ctx: SimulationContext,
    agent_id: str,
    agent_type: str,
    agent_name: str,
    task: str,
    start_delay: float,
) -> None:
    time.sleep(start_delay)
    tokens = ctx.increment_context(input_delta=random.randint(2000, 4000))
    ctx.log(f"[{agent_name}] Spawned as {agent_type}")
    ctx.send_event(
        "subagent_start",
        {
            "agent_id": agent_id,
            "agent_name": agent_name,
            "agent_type": agent_type,
            "task_description": task,
            "speech_content": {"boss": f"{agent_name}, you're up.", "agent": "On it!"},
            **tokens,
        },
    )

    # Give the arrival choreography time to seat the agent in its room.
    time.sleep(25 + start_delay)

    for tool_name, tool_input in TOOLS[agent_id]:
        tokens = ctx.increment_context(
            input_delta=random.randint(1500, 3000),
            output_delta=random.randint(500, 1500),
        )
        ctx.send_event(
            "pre_tool_use",
            {"tool_name": tool_name, "tool_input": tool_input, "agent_id": agent_id, **tokens},
        )
        time.sleep(random.uniform(4.0, 7.0))
        ctx.send_event(
            "post_tool_use",
            {"tool_name": tool_name, "tool_input": tool_input, "agent_id": agent_id},
        )
        # Long quiet stretch so idle wandering has a chance to kick in.
        time.sleep(random.uniform(20.0, 35.0))

    ctx.log(f"[{agent_name}] Finished.")
    ctx.send_event(
        "subagent_stop",
        {
            "agent_id": agent_id,
            "success": True,
            "speech_content": {"agent": "All done!", "boss": f"Nice work, {agent_name}."},
        },
    )


def run(ctx: SimulationContext) -> None:
    """Execute the YouTube production scenario against *ctx*."""
    ctx.reset(initial_fraction=0.1)
    ctx.log(f"[youtube] Session start: {ctx.session_id}")
    ctx.send_event(
        "session_start",
        {
            "project_name": "YouTubeStudio",
            "working_dir": str(Path(__file__).parent.parent.parent),
        },
    )
    time.sleep(1)

    ctx.send_event(
        "user_prompt_submit",
        {"prompt": "Produce this week's video: script, edit, thumbnails and schedule the upload."},
    )
    time.sleep(2)

    threads = [
        threading.Thread(
            target=_agent_workflow,
            args=(ctx, agent_id, agent_type, name, task, index * 6.0),
        )
        for index, (agent_id, agent_type, name, task) in enumerate(CREW)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    time.sleep(3)
    ctx.send_event("stop", {"speech_content": {"boss_phone": "Video is scheduled. Great work!"}})
    time.sleep(5)
    ctx.send_event("session_end")
    ctx.log("[youtube] Simulation complete.")
