import { checkUpload, formatTime } from "@calabrain/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ApiRequestError } from "../lib/api.ts";
import { mutations, refreshTree } from "../lib/queries.ts";
import { uploadFile, UploadError } from "../lib/upload.ts";

export const RECORDING_ACCEPT = "video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp4,.mov,.webm,.mp3,.m4a,.wav";

/** Duration from the file's own metadata, read locally before uploading (RF12). */
export function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith("audio/") ? "audio" : "video");
    const url = URL.createObjectURL(file);
    const done = (d: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(d);
    };
    const timer = setTimeout(() => done(null), 8000);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null); // e.g. HEVC the browser can't decode: the worker checks it
    el.src = url;
  });
}

export type UploadMode = { kind: "new" } | { kind: "replace"; attemptId: string };

/** Picks, checks and uploads a recording, then creates the attempt or replaces its recording (RF12, RF13). */
export function useRecordingUpload(session: { id: string; recordingLimitMin: number }, onDone: (attemptId: string) => void) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  async function start(file: File, mode: UploadMode) {
    setError(null);
    const problem = checkUpload("recording", file.name, file.type, file.size);
    if (problem) return setError(problem);
    const duration = await readDuration(file);
    if (duration !== null && duration > session.recordingLimitMin * 60 + 1) {
      return setError(
        `This recording runs ${formatTime(duration)}, over this session's ${session.recordingLimitMin}-minute limit. Trim it, or raise the limit in the session menu.`,
      );
    }
    controller.current = new AbortController();
    setProgress({ name: file.name, pct: 0 });
    try {
      const uploadId = await uploadFile(file, "recording", (p) => setProgress({ name: file.name, pct: p.sent / p.total }), {
        signal: controller.current.signal,
      });
      const durationS = duration ?? undefined;
      const attempt =
        mode.kind === "new"
          ? await mutations.createAttempt(session.id, uploadId, durationS)
          : await mutations.replaceRecording(mode.attemptId, uploadId, durationS);
      await refreshTree(qc);
      await qc.invalidateQueries({ queryKey: ["attempts", attempt.id] });
      onDone(attempt.id);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof UploadError || err instanceof ApiRequestError ? err.message : "The upload failed. Try again.");
      }
    } finally {
      setProgress(null);
    }
  }

  return { start, progress, error, cancel: () => controller.current?.abort(), clearError: () => setError(null) };
}
