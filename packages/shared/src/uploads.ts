import { z } from "zod";
import { limits, noteImportMimeTypes, recordingMimeTypes } from "./limits.ts";

export const uploadKinds = ["source_document", "note_import", "recording"] as const;
export type UploadKind = (typeof uploadKinds)[number];

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

const byExtension: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

/** Browsers often send an empty or generic type; fall back to the extension. */
export function resolveContentType(filename: string, given: string | undefined): string {
  const g = (given ?? "").toLowerCase();
  if (g && g !== "application/octet-stream") return g === "audio/x-m4a" ? "audio/mp4" : g === "audio/x-wav" ? "audio/wav" : g;
  return byExtension[ext(filename)] ?? "application/octet-stream";
}

const rules: Record<UploadKind, { types: readonly string[]; maxBytes: number; what: string; accepted: string }> = {
  source_document: { types: ["application/pdf"], maxBytes: limits.pdfMaxBytes, what: "PDF", accepted: "a PDF" },
  note_import: {
    types: noteImportMimeTypes,
    maxBytes: limits.pdfMaxBytes,
    what: "file",
    accepted: "a .txt, .md, .docx or PDF file",
  },
  recording: {
    types: [...recordingMimeTypes, "audio/wav"],
    maxBytes: limits.recordingMaxBytes,
    what: "recording",
    accepted: "an MP4, MOV, WebM, MP3, M4A or WAV file",
  },
};

const formatSize = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${Math.round(bytes / 1024 ** 3)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

/** Same checks on both sides: the browser blocks early, the API decides. Returns an error message or null. */
export function checkUpload(kind: UploadKind, filename: string, contentType: string, sizeBytes: number): string | null {
  const r = rules[kind];
  const type = resolveContentType(filename, contentType);
  if (!r.types.includes(type)) return `This isn't ${r.accepted}. Choose ${r.accepted}.`;
  if (sizeBytes <= 0) return "This file is empty.";
  if (sizeBytes > r.maxBytes) return `This ${r.what} is larger than ${formatSize(r.maxBytes)}. Choose a smaller file.`;
  return null;
}

export const startUploadSchema = z.object({
  kind: z.enum(uploadKinds),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().max(200).optional(),
  sizeBytes: z.number().int().positive(),
});
export type StartUploadInput = z.infer<typeof startUploadSchema>;

export interface UploadStarted {
  id: string;
  partSize: number;
  partCount: number;
}

export const partsRequestSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
});

export interface UploadState {
  id: string;
  status: "pending" | "completed" | "aborted";
  /** Part numbers the bucket already holds (resume sends only the rest). */
  uploadedParts: number[];
}

// --- Documents

export const createDocumentSchema = z.object({
  uploadId: z.uuid(),
  subjectId: z.uuid(),
  folderId: z.uuid().nullable().optional(),
  sessionId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export type ProcessingStatus = "processing" | "ready" | "failed";

/** Why a file failed, in words the user can act on. */
export const failureMessages: Record<string, string> = {
  no_text: "This PDF has no selectable text. Upload a PDF with text; scanned files aren't supported yet.",
  corrupt: "This file looks damaged or isn't what its name says. Export it again and re-upload.",
  too_long: "This recording is longer than the session's limit. Trim it or raise the limit, then upload again.",
  unsupported: "We couldn't play or convert this file. Export it as MP4 (H.264) or MP3 and upload again.",
  missing: "The upload didn't finish. Upload the file again.",
  internal: "Something went wrong while processing. Try uploading again.",
};

export interface OutlineEntry {
  title: string;
  level: number;
  startPage: number;
  endPage: number | null;
}

export interface DocumentDetail {
  id: string;
  subjectId: string;
  folderId: string | null;
  sessionId: string | null;
  title: string;
  sizeBytes: number;
  pageCount: number | null;
  status: ProcessingStatus;
  failureReason: string | null;
  parentDocumentId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  createdAt: string;
  outline: OutlineEntry[];
}

export interface DocumentPage {
  pageNumber: number;
  text: string;
}

export const splitSchema = z.object({
  /** Folder that receives the new sessions; null = top of the subject. */
  folderId: z.uuid().nullable(),
  chapters: z
    .array(
      z
        .object({
          title: z.string().trim().min(1, { message: "Give every chapter a name." }).max(160),
          pageStart: z.number().int().min(1),
          pageEnd: z.number().int().min(1),
        })
        .refine((c) => c.pageEnd >= c.pageStart, { message: "The last page comes before the first.", path: ["pageEnd"] }),
    )
    .min(1, { message: "Pick at least one chapter." })
    .max(200),
});
export type SplitInput = z.infer<typeof splitSchema>;

// --- Jobs (API enqueues, worker runs)

export const jobs = {
  processDocument: "process-document",
  splitDocument: "split-document",
  importNote: "import-note",
  processRecording: "process-recording",
  purgeTrash: "purge-trash",
} as const;

export interface ProcessDocumentJob {
  documentId: string;
}
export interface SplitDocumentJob {
  documentId: string;
}
