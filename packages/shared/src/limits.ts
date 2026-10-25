/** Product limits shared by the web client (early validation) and the API/worker (the checks that count). */

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const limits = {
  /** Source documents and imported note files. */
  pdfMaxBytes: 200 * MB,
  /** Video or audio recording of one attempt. */
  recordingMaxBytes: 2 * GB,
  /** Default recording duration limit per session, in minutes (RF12). */
  recordingDefaultMinutes: 15,
  /** A session may raise its limit up to this, never beyond (RF12). */
  recordingMaxMinutes: 30,
  /** Multipart upload part size sent straight to object storage. */
  uploadPartBytes: 10 * MB,
  /** Days an item stays in the trash before it is purged for good (RF03). */
  trashRetentionDays: 30,
  /** Idle minutes before a note draft becomes an immutable version (RF10). */
  noteVersionIdleMinutes: 5,
} as const;

export const recordingMimeTypes = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
] as const;

export const noteImportMimeTypes = [
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
] as const;
