/**
 * Phase 1 data model (see the spec, "Modelo de dados").
 * Phase 2 tables (chunks, transcripts, evaluations, claims...) will be added without migrating these.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

// ---------------------------------------------------------------------------
// Auth (Better Auth). Property names are the ones Better Auth expects.
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Tree: Subject → Folders (any depth) → Sessions
// ---------------------------------------------------------------------------

export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("subjects_user_idx").on(t.userId)],
);

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("folders_subject_idx").on(t.subjectId), index("folders_parent_idx").on(t.parentId)],
);

export const studySessions = pgTable(
  "study_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    recordingLimitMin: integer("recording_limit_min").notNull().default(15),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("study_sessions_subject_idx").on(t.subjectId),
    index("study_sessions_folder_idx").on(t.folderId),
    check("study_sessions_recording_limit", sql`${t.recordingLimitMin} between 1 and 30`),
  ],
);

// ---------------------------------------------------------------------------
// Source documents (PDF with text)
// ---------------------------------------------------------------------------

export const processingStatus = pgEnum("processing_status", ["processing", "ready", "failed"]);

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Always set. folderId / sessionId say the most specific level it was attached to. */
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => studySessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    storageKey: text("storage_key").notNull(),
    /** Dedupe key, scoped to one user only. */
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    pageCount: integer("page_count"),
    status: processingStatus("status").notNull().default("processing"),
    failureReason: text("failure_reason"),
    /** Set on chapter documents split from a whole book. */
    parentDocumentId: uuid("parent_document_id").references((): AnyPgColumn => sourceDocuments.id, {
      onDelete: "set null",
    }),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("source_documents_user_sha_idx").on(t.userId, t.sha256),
    index("source_documents_subject_idx").on(t.subjectId),
    index("source_documents_session_idx").on(t.sessionId),
  ],
);

export const documentPages = pgTable(
  "document_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull(),
  },
  (t) => [uniqueIndex("document_pages_doc_page_uq").on(t.documentId, t.pageNumber)],
);

export const documentOutline = pgTable(
  "document_outline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    level: integer("level").notNull(),
    startPage: integer("start_page").notNull(),
    endPage: integer("end_page"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("document_outline_doc_idx").on(t.documentId)],
);

// ---------------------------------------------------------------------------
// Notes, with immutable versions
// ---------------------------------------------------------------------------

export const noteVersionSource = pgEnum("note_version_source", ["editor", "import", "restore"]);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => noteVersions.id, {
      onDelete: "set null",
    }),
    draftJson: jsonb("draft_json"),
    draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("notes_session_idx").on(t.sessionId)],
);

export const noteVersions = pgTable(
  "note_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references((): AnyPgColumn => notes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentJson: jsonb("content_json").notNull(),
    /** Plain text of this version; phase 2 marks claims by offsets in it. */
    contentText: text("content_text").notNull(),
    source: noteVersionSource("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("note_versions_note_version_uq").on(t.noteId, t.version)],
);

// ---------------------------------------------------------------------------
// Attempts and recordings
// ---------------------------------------------------------------------------

export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => studySessions.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("attempts_session_number_uq").on(t.sessionId, t.number)],
);

export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    audioKey: text("audio_key"),
    thumbnailKey: text("thumbnail_key"),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    durationS: integer("duration_s"),
    status: processingStatus("status").notNull().default("processing"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("recordings_attempt_uq").on(t.attemptId)],
);

export const recordingMarkers = pgTable(
  "recording_markers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    tSeconds: integer("t_seconds").notNull(),
    label: text("label").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("recording_markers_recording_idx").on(t.recordingId)],
);

// ---------------------------------------------------------------------------
// Uploads (multipart, straight to object storage) and usage
// ---------------------------------------------------------------------------

export const uploadKind = pgEnum("upload_kind", ["source_document", "note_import", "recording"]);
export const uploadStatus = pgEnum("upload_status", ["pending", "completed", "aborted"]);

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    r2UploadId: text("r2_upload_id"),
    kind: uploadKind("kind").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    status: uploadStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("uploads_user_idx").on(t.userId)],
);

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** e.g. storage_bytes, media_seconds (phase 2 adds tokens, transcribed_seconds, cost_usd). */
    kind: text("kind").notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    unit: text("unit").notNull(),
    refId: text("ref_id"),
    createdAt: createdAt(),
  },
  (t) => [index("usage_ledger_user_kind_idx").on(t.userId, t.kind)],
);
