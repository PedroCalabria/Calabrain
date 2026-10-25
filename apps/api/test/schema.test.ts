import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool, schema } from "../src/db/client.ts";

afterAll(async () => {
  await pool.end();
});

async function makeUser() {
  const id = crypto.randomUUID();
  await db.insert(schema.users).values({ id, name: "Test", email: `${id}@example.com` });
  return id;
}

describe("phase 1 schema rules", () => {
  it("caps a session's recording limit at 30 minutes and defaults to 15 (RF12)", async () => {
    const userId = await makeUser();
    const [subject] = await db.insert(schema.subjects).values({ userId, title: "Distributed Systems" }).returning();
    const [session] = await db
      .insert(schema.studySessions)
      .values({ subjectId: subject!.id, title: "Ch. 5 · Replication" })
      .returning();
    expect(session!.recordingLimitMin).toBe(15);

    await expect(
      db.update(schema.studySessions).set({ recordingLimitMin: 31 }).where(eq(schema.studySessions.id, session!.id)),
    ).rejects.toThrow();
    await db.update(schema.studySessions).set({ recordingLimitMin: 30 }).where(eq(schema.studySessions.id, session!.id));
  });

  it("keeps note version numbers unique per note", async () => {
    const userId = await makeUser();
    const [subject] = await db.insert(schema.subjects).values({ userId, title: "S" }).returning();
    const [session] = await db.insert(schema.studySessions).values({ subjectId: subject!.id, title: "T" }).returning();
    const [note] = await db.insert(schema.notes).values({ sessionId: session!.id, title: "Leader election" }).returning();
    const v = { noteId: note!.id, version: 1, contentJson: {}, contentText: "", source: "editor" as const };
    await db.insert(schema.noteVersions).values(v);
    await expect(db.insert(schema.noteVersions).values(v)).rejects.toThrow();
  });

  it("allows one recording per attempt and numbers attempts per session", async () => {
    const userId = await makeUser();
    const [subject] = await db.insert(schema.subjects).values({ userId, title: "S" }).returning();
    const [session] = await db.insert(schema.studySessions).values({ subjectId: subject!.id, title: "T" }).returning();
    const [attempt] = await db.insert(schema.attempts).values({ sessionId: session!.id, number: 1 }).returning();
    await expect(db.insert(schema.attempts).values({ sessionId: session!.id, number: 1 })).rejects.toThrow();

    const rec = { attemptId: attempt!.id, storageKey: "k", mime: "video/mp4", sizeBytes: 1 };
    await db.insert(schema.recordings).values(rec);
    await expect(db.insert(schema.recordings).values(rec)).rejects.toThrow();
  });

  it("removes a user's content when the account is deleted", async () => {
    const userId = await makeUser();
    await db.insert(schema.subjects).values({ userId, title: "S" });
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const left = await db.select().from(schema.subjects).where(eq(schema.subjects.userId, userId));
    expect(left).toHaveLength(0);
  });
});
