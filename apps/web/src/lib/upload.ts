/**
 * Multipart upload straight to storage (R2/MinIO) with presigned part URLs.
 * Parts go 3 at a time; a failed part is retried, and a resumed upload asks the API
 * which parts already arrived and sends only the rest.
 */
import { checkUpload, type UploadKind, type UploadStarted, type UploadState } from "@calabrain/shared";
import { api } from "./api.ts";

export interface UploadProgress {
  sent: number;
  total: number;
}

export class UploadError extends Error {}

const CONCURRENCY = 3;
const RETRIES = 3;
const BATCH = 20;

function putPart(url: string, body: Blob, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`part failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uploads a file and returns the upload id to attach (document, note import, recording). */
export async function uploadFile(
  file: File,
  kind: UploadKind,
  onProgress: (p: UploadProgress) => void,
  opts: { signal?: AbortSignal; resumeId?: string } = {},
): Promise<string> {
  const problem = checkUpload(kind, file.name, file.type, file.size);
  if (problem) throw new UploadError(problem);

  let id = opts.resumeId;
  let partSize: number;
  let partCount: number;
  let done = new Set<number>();
  if (id) {
    const state = await api<UploadState>(`/uploads/${id}`);
    if (state.status === "completed") return id;
    done = new Set(state.uploadedParts);
    partSize = 10 * 1024 * 1024;
    partCount = Math.ceil(file.size / partSize);
  } else {
    const started = await api<UploadStarted>("/uploads", {
      method: "POST",
      body: JSON.stringify({ kind, filename: file.name, contentType: file.type, sizeBytes: file.size }),
    });
    ({ id, partSize, partCount } = started);
  }

  const loaded = new Map<number, number>();
  for (const n of done) loaded.set(n, Math.min(partSize, file.size - (n - 1) * partSize));
  const report = () => onProgress({ sent: [...loaded.values()].reduce((a, b) => a + b, 0), total: file.size });
  report();

  const todo = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const urls = new Map<number, string>();
  const urlFor = async (n: number) => {
    if (!urls.has(n)) {
      const from = Math.max(0, todo.indexOf(n));
      const batch = [n, ...todo.slice(from + 1, from + BATCH).filter((x) => !urls.has(x))];
      const { parts } = await api<{ parts: { partNumber: number; url: string }[] }>(`/uploads/${id}/parts`, {
        method: "POST",
        body: JSON.stringify({ partNumbers: batch }),
      });
      for (const p of parts) urls.set(p.partNumber, p.url);
    }
    return urls.get(n)!;
  };

  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
    while (next < todo.length) {
      const n = todo[next++]!;
      const blob = file.slice((n - 1) * partSize, n * partSize);
      for (let attempt = 0; ; attempt++) {
        try {
          await putPart(await urlFor(n), blob, (l) => (loaded.set(n, l), report()), opts.signal);
          loaded.set(n, blob.size);
          report();
          break;
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          if (attempt >= RETRIES) throw new UploadError("The connection dropped while uploading. Try again; finished parts won't be sent twice.");
          urls.delete(n); // the presigned URL may have expired
          loaded.set(n, 0);
          await wait(1000 * 2 ** attempt);
        }
      }
    }
  });
  await Promise.all(workers);

  await api<UploadState>(`/uploads/${id}/complete`, { method: "POST" });
  return id!;
}

export const formatBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
