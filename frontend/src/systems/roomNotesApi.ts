/**
 * Client for the shared knowledge board
 * (backend/app/api/routes/room_notes.py). Not API-key gated — a note can't
 * execute anything, so apiFetch is used only for consistent base-URL
 * resolution, not because a key is required.
 */

import { apiFetch } from "@/utils/api";

export interface RoomNote {
  id: number;
  roomId: string;
  text: string;
  source: "user" | "chat";
  author: string | null;
  createdAt: string;
}

export async function fetchRoomNotes(): Promise<RoomNote[]> {
  const res = await apiFetch("/api/v1/room-notes");
  if (!res.ok) return [];
  const data = (await res.json()) as { notes: RoomNote[] };
  return data.notes;
}

export async function postRoomNote(
  roomId: string,
  text: string,
): Promise<RoomNote | null> {
  try {
    const res = await apiFetch("/api/v1/room-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, text }),
    });
    if (!res.ok) return null;
    return (await res.json()) as RoomNote;
  } catch {
    return null;
  }
}

export async function deleteRoomNote(id: number): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/v1/room-notes/${id}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}
