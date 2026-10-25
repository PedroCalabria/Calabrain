import { z } from "zod";

export const createAttemptSchema = z.object({
  uploadId: z.uuid(),
  /** Duration the browser read from the file's metadata; the worker's ffprobe check is the one that counts. */
  durationS: z.number().min(0).max(24 * 3600).optional(),
});
export type CreateAttemptInput = z.infer<typeof createAttemptSchema>;

export const markerSchema = z.object({
  tSeconds: z.number().min(0).max(24 * 3600),
  label: z.string().trim().min(1, { message: "Give the marker a name." }).max(120),
});
export type MarkerInput = z.infer<typeof markerSchema>;

export interface Marker {
  id: string;
  tSeconds: number;
  label: string;
}

export interface RecordingInfo {
  id: string;
  status: "processing" | "ready" | "failed";
  failureReason: string | null;
  mime: string;
  kind: "video" | "audio";
  durationS: number | null;
  sizeBytes: number;
}

export interface AttemptSummary {
  id: string;
  number: number;
  createdAt: string;
  recording: RecordingInfo | null;
}

export interface AttemptDetail extends AttemptSummary {
  sessionId: string;
  /** Short-lived playback URL (null until the recording is ready). */
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  markers: Marker[];
}

export interface ProcessRecordingJob {
  recordingId: string;
}

export const formatTime = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
