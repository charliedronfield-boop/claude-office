"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useRoomConfigStore } from "@/stores/roomConfigStore";
import { useTranslation } from "@/hooks/useTranslation";
import { apiFetch } from "@/utils/api";

// ============================================================================
// TYPES
// ============================================================================

interface RoomFormData {
  id: string;
  name: string;
  accent: string;
  keywords: string; // comma-separated, for editing
}

interface PinFormData {
  key: string; // stable React key — form-local, not sent to the backend
  agentType: string;
  roomId: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function generateKey(): string {
  return `pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toFormData(
  rooms: { id: string; name: string; accent: string; keywords: string[] }[],
): RoomFormData[] {
  return rooms.map((r) => ({
    id: r.id,
    name: r.name,
    accent: r.accent,
    keywords: r.keywords.join(", "),
  }));
}

function toPinFormData(overrides: { agentType: string; roomId: string }[]): PinFormData[] {
  return overrides.map((o) => ({ key: generateKey(), agentType: o.agentType, roomId: o.roomId }));
}

// ============================================================================
// ROOMS TAB COMPONENT
// ============================================================================

export function RoomsTab({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}): ReactNode {
  const liveRooms = useRoomConfigStore((s) => s.rooms);
  const liveOverrides = useRoomConfigStore((s) => s.agentTypeOverrides);
  const setRoomConfig = useRoomConfigStore((s) => s.setRoomConfig);
  const { t } = useTranslation();

  const [rooms, setRooms] = useState<RoomFormData[]>([]);
  const [pins, setPins] = useState<PinFormData[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<{
    rooms: RoomFormData[];
    pins: PinFormData[];
  } | null>(null);

  // Initialize the form once the live config has loaded.
  useEffect(() => {
    if (liveRooms.length === 0) return;
    const roomData = toFormData(liveRooms);
    const pinData = toPinFormData(liveOverrides);
    setRooms(roomData);
    setPins(pinData);
    setInitialData({ rooms: roomData, pins: pinData });
    // Only ever seed the form once per mount — re-running on every live
    // update would clobber in-progress edits when the store refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRooms.length > 0]);

  // Detect dirty state.
  useEffect(() => {
    if (!initialData) {
      onDirtyChange?.(false);
      return;
    }
    const roomsDirty = rooms.some(
      (r, i) =>
        r.name !== initialData.rooms[i]?.name ||
        r.accent !== initialData.rooms[i]?.accent ||
        r.keywords !== initialData.rooms[i]?.keywords,
    );
    const pinsDirty =
      pins.length !== initialData.pins.length ||
      pins.some(
        (p, i) =>
          p.agentType !== initialData.pins[i]?.agentType ||
          p.roomId !== initialData.pins[i]?.roomId,
      );
    onDirtyChange?.(roomsDirty || pinsDirty);
  }, [rooms, pins, initialData, onDirtyChange]);

  const handleUpdateRoom = (roomId: string, updates: Partial<RoomFormData>) => {
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, ...updates } : r)));
  };

  const handleAddPin = () => {
    setPins((prev) => [
      ...prev,
      { key: generateKey(), agentType: "", roomId: rooms[0]?.id ?? "" },
    ]);
  };

  const handleRemovePin = (key: string) => {
    setPins((prev) => prev.filter((p) => p.key !== key));
  };

  const handleUpdatePin = (key: string, updates: Partial<PinFormData>) => {
    setPins((prev) => prev.map((p) => (p.key === key ? { ...p, ...updates } : p)));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);

    const config = {
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        accent: r.accent,
        keywords: r.keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      })),
      agentTypeOverrides: pins
        .filter((p) => p.agentType.trim())
        .map((p) => ({ agentType: p.agentType.trim(), roomId: p.roomId })),
    };

    try {
      const res = await apiFetch("/api/v1/preferences/room_config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(config) }),
      });

      if (res.ok) {
        // Re-fetch rather than optimistically merge — the backend is the
        // source of truth for which room each field resolved against.
        const roomsRes = await apiFetch("/api/v1/rooms");
        const data = await roomsRes.json();
        setRoomConfig(data.rooms ?? [], data.agentTypeOverrides ?? []);
        const roomData = toFormData(data.rooms ?? []);
        const pinData = toPinFormData(data.agentTypeOverrides ?? []);
        setRooms(roomData);
        setPins(pinData);
        setInitialData({ rooms: roomData, pins: pinData });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const body = await res.json().catch(() => null);
        setSaveError(
          body?.detail
            ? String(body.detail)
            : t("settings.rooms.saveFailed", {
                status: res.status,
                statusText: res.statusText,
              }),
        );
      }
    } catch {
      setSaveError(t("settings.rooms.saveUnreachable"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-slate-500 text-xs">{t("settings.rooms.hint")}</p>

      {/* Rooms list — the four slots are fixed, only name/accent/keywords are editable */}
      <div className="space-y-3">
        {rooms.map((room) => (
          <div
            key={room.id}
            className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
                  {t("settings.rooms.roomName")}
                </label>
                <input
                  type="text"
                  value={room.name}
                  onChange={(e) => handleUpdateRoom(room.id, { name: e.target.value })}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs font-mono focus:border-purple-500 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
                  {t("settings.rooms.accentColor")}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={room.accent}
                    onChange={(e) => handleUpdateRoom(room.id, { accent: e.target.value })}
                    className="w-8 h-8 border border-slate-700 rounded cursor-pointer bg-transparent"
                  />
                  <span className="text-xs font-mono text-slate-500">{room.accent}</span>
                </div>
              </div>
              <div className="col-span-2">
                <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
                  {t("settings.rooms.keywords")}
                </label>
                <input
                  type="text"
                  value={room.keywords}
                  onChange={(e) => handleUpdateRoom(room.id, { keywords: e.target.value })}
                  placeholder={t("settings.rooms.keywordsPlaceholder")}
                  className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs font-mono focus:border-purple-500 focus:outline-none transition-colors"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Agent-type pins */}
      <div className="pt-4 border-t border-slate-800">
        <label className="block text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">
          {t("settings.rooms.pins")}
        </label>
        <p className="text-slate-600 text-[11px] mb-3">{t("settings.rooms.pinsHint")}</p>

        {pins.length === 0 ? (
          <p className="text-slate-600 text-sm font-mono py-3 text-center border border-dashed border-slate-800 rounded-lg">
            {t("settings.rooms.noPins")}
          </p>
        ) : (
          <div className="space-y-2">
            {pins.map((pin) => (
              <div key={pin.key} className="flex items-center gap-2">
                <input
                  type="text"
                  value={pin.agentType}
                  onChange={(e) => handleUpdatePin(pin.key, { agentType: e.target.value })}
                  placeholder={t("settings.rooms.pinAgentTypePlaceholder")}
                  aria-label={t("settings.rooms.pinAgentType")}
                  className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs font-mono focus:border-purple-500 focus:outline-none transition-colors"
                />
                <select
                  value={pin.roomId}
                  onChange={(e) => handleUpdatePin(pin.key, { roomId: e.target.value })}
                  aria-label={t("settings.rooms.pinRoom")}
                  className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs font-mono focus:border-purple-500 focus:outline-none transition-colors"
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleRemovePin(pin.key)}
                  className="text-xs text-rose-500/70 hover:text-rose-400 font-mono transition-colors px-1"
                >
                  {t("settings.rooms.removePin")}
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleAddPin}
          className="mt-3 w-full py-2 border border-dashed border-slate-700 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:border-slate-600 font-mono transition-colors"
        >
          {t("settings.rooms.addPin")}
        </button>
      </div>

      {/* Save button */}
      <div className="pt-4 border-t border-slate-800 space-y-2">
        {saveError && <p className="text-xs font-mono text-rose-400 text-center">{saveError}</p>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-2.5 rounded-lg text-sm font-bold transition-colors ${
            saved
              ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-400"
              : saving
                ? "bg-slate-700 border border-slate-600 text-slate-400 cursor-not-allowed"
                : "bg-purple-500/20 border border-purple-500/50 text-purple-300 hover:bg-purple-500/30"
          }`}
        >
          {saved
            ? t("settings.rooms.saved")
            : saving
              ? t("settings.rooms.saving")
              : t("settings.rooms.save")}
        </button>
      </div>
    </div>
  );
}
