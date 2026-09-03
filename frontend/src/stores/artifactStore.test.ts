import { describe, it, expect, beforeEach } from "vitest";
import { useArtifactStore } from "./artifactStore";

describe("artifactStore", () => {
  beforeEach(() => useArtifactStore.getState().reset());

  it("adds an artifact to the front of the list", () => {
    const store = useArtifactStore.getState();
    store.add({ roomId: "editing", path: "cut.mp4", tool: "Write", agentName: "Algo AI" });
    store.add({ roomId: "scripting", path: "script.md", tool: "Edit", agentName: "The Writer" });

    const artifacts = useArtifactStore.getState().artifacts;
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].path).toBe("script.md"); // most recent first
    expect(artifacts[1].path).toBe("cut.mp4");
  });

  it("caps the list at 40 entries, dropping the oldest", () => {
    const store = useArtifactStore.getState();
    for (let i = 0; i < 45; i++) {
      store.add({ roomId: "editing", path: `file-${i}.mp4`, tool: "Write", agentName: null });
    }
    const artifacts = useArtifactStore.getState().artifacts;
    expect(artifacts).toHaveLength(40);
    expect(artifacts[0].path).toBe("file-44.mp4");
    expect(artifacts[39].path).toBe("file-5.mp4");
  });

  it("reset clears the list", () => {
    const store = useArtifactStore.getState();
    store.add({ roomId: "editing", path: "x", tool: "Write", agentName: null });
    store.reset();
    expect(useArtifactStore.getState().artifacts).toEqual([]);
  });
});
