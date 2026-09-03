/**
 * NotesPanel - the shared knowledge board.
 *
 * One corkboard per room: pin a note yourself, or watch real inter-agent
 * chats pin themselves automatically (see room_notes.py). The boss's next
 * prompt sees the accumulated board as context (best-effort, see
 * hooks/README.md).
 */

"use client";

import { useEffect, useState } from "react";
import { StickyNote, Send, Trash2, User, MessagesSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ROOMS } from "@/systems/officeRooms";
import {
  deleteRoomNote,
  fetchRoomNotes,
  postRoomNote,
  type RoomNote,
} from "@/systems/roomNotesApi";
import { useTranslation } from "@/hooks/useTranslation";

const POLL_INTERVAL_MS = 8000;

export function NotesPanel() {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<RoomNote[]>([]);
  const [roomId, setRoomId] = useState(ROOMS[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const reload = () => void fetchRoomNotes().then(setNotes);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !roomId || sending) return;
    setSending(true);
    const created = await postRoomNote(roomId, text);
    setSending(false);
    if (created) {
      setNotes((prev) => [created, ...prev]);
      setDraft("");
    }
  };

  const handleDelete = async (id: number) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    void deleteRoomNote(id);
  };

  const roomName = (id: string) =>
    ROOMS.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden font-mono text-xs">
      <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 text-slate-300 font-bold uppercase tracking-wider">
          <StickyNote size={14} className="text-amber-400" />
          {t("notes.title")}
        </div>
        <div className="text-slate-500">{notes.length}</div>
      </div>

      <div className="flex-grow overflow-y-auto p-2 space-y-1.5">
        {notes.length === 0 ? (
          <div className="text-slate-600 italic p-4 text-center">
            {t("notes.empty")}
          </div>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="px-2 py-1.5 rounded border-l-2 border-amber-700/60 bg-amber-950/10 group"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-amber-400/80 mb-0.5">
                {note.source === "chat" ? (
                  <MessagesSquare size={10} />
                ) : (
                  <User size={10} />
                )}
                <span className="font-bold">{roomName(note.roomId)}</span>
                <span className="ml-auto text-slate-600">
                  {formatDistanceToNow(new Date(note.createdAt), {
                    addSuffix: true,
                  })}
                </span>
                <button
                  onClick={() => void handleDelete(note.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity"
                  aria-label={t("notes.delete")}
                >
                  <Trash2 size={10} />
                </button>
              </div>
              <div className="text-slate-200 text-[11px] whitespace-pre-wrap leading-snug">
                {note.text}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex-shrink-0 border-t border-slate-800 p-2 space-y-1.5"
      >
        <select
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200"
        >
          {ROOMS.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("notes.placeholder")}
            maxLength={500}
            className="flex-grow bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className="px-2.5 py-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white rounded flex items-center justify-center"
            aria-label={t("notes.send")}
          >
            <Send size={12} />
          </button>
        </div>
      </form>
    </div>
  );
}
