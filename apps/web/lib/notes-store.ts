import { cookies } from "next/headers";
import { addEdit, type Note, notesWith, NOTES_COOKIE, parseEdits } from "./demo/notes";

/** Notas da demo com as edições deste visitante (cookie), aplicadas como versões novas. */
export async function currentNotes(): Promise<Note[]> {
  return notesWith(parseEdits((await cookies()).get(NOTES_COOKIE)?.value));
}

export async function saveNoteEdit(id: string, body: string, by: string, at: string): Promise<void> {
  const jar = await cookies();
  const edits = addEdit(parseEdits(jar.get(NOTES_COOKIE)?.value), id, { body, by, at });
  jar.set(NOTES_COOKIE, JSON.stringify(edits), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
}

