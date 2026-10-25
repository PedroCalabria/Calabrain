import { z } from "zod";
import { limits } from "./limits.ts";

const title = (what: string) =>
  z
    .string()
    .trim()
    .min(1, { message: `Give the ${what} a name.` })
    .max(160, { message: "Use at most 160 characters." });

const id = z.uuid({ message: "Invalid id." });
const position = z.number().int().min(0);

// --- Subjects
export const createSubjectSchema = z.object({
  title: title("subject"),
  description: z.string().trim().max(1000, { message: "Use at most 1,000 characters." }).optional(),
});
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;

export const updateSubjectSchema = z
  .object({
    title: title("subject"),
    description: z.string().trim().max(1000, { message: "Use at most 1,000 characters." }).nullable(),
    position,
  })
  .partial();
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;

// --- Folders
export const createFolderSchema = z.object({
  subjectId: id,
  parentId: id.nullable().optional(),
  title: title("folder"),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

/** Moving a folder = new parentId and/or position (index among its new siblings). */
export const updateFolderSchema = z
  .object({ title: title("folder"), parentId: id.nullable(), position })
  .partial();
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

// --- Sessions
export const recordingLimitSchema = z
  .number()
  .int()
  .min(1, { message: "Use at least 1 minute." })
  .max(limits.recordingMaxMinutes, { message: `Use at most ${limits.recordingMaxMinutes} minutes.` });

export const createSessionSchema = z.object({
  subjectId: id,
  folderId: id.nullable().optional(),
  title: title("session"),
  recordingLimitMin: recordingLimitSchema.optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = z
  .object({ title: title("session"), folderId: id.nullable(), position, recordingLimitMin: recordingLimitSchema })
  .partial();
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

// --- Responses
export interface SubjectSummary {
  id: string;
  title: string;
  description: string | null;
  position: number;
  folderCount: number;
  sessionCount: number;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FolderNode {
  id: string;
  parentId: string | null;
  title: string;
  position: number;
}

export interface SessionNode {
  id: string;
  folderId: string | null;
  title: string;
  position: number;
  recordingLimitMin: number;
  noteCount: number;
  attemptCount: number;
  documentCount: number;
  /** Total length of this session's ready recordings, in seconds. */
  recordedSeconds: number;
  updatedAt: string;
}

export interface DocumentNode {
  id: string;
  folderId: string | null;
  sessionId: string | null;
  title: string;
  status: "processing" | "ready" | "failed";
  failureReason: string | null;
  pageCount: number | null;
  /** Set on chapter documents split from a book. */
  parentDocumentId: string | null;
}

export interface SubjectTree {
  subject: SubjectSummary;
  folders: FolderNode[];
  sessions: SessionNode[];
  documents: DocumentNode[];
}

export interface SessionDetail {
  id: string;
  subjectId: string;
  folderId: string | null;
  title: string;
  position: number;
  recordingLimitMin: number;
  createdAt: string;
  updatedAt: string;
  /** Subject first, then each folder down to the session's own folder. */
  breadcrumb: { type: "subject" | "folder"; id: string; title: string }[];
}

// --- Trash
export const trashTypes = ["subject", "folder", "session", "document", "note", "attempt"] as const;
export type TrashType = (typeof trashTypes)[number];

export interface TrashItem {
  type: TrashType;
  id: string;
  title: string;
  /** Where it lived, e.g. "Distributed Systems › Part II". */
  location: string | null;
  deletedAt: string;
  /** When it is erased for good. */
  purgeAt: string;
}
