/**
 * Live status (RF16): one EventSource per tab. While it's connected, queries skip polling;
 * if it drops, polling takes over until it reconnects.
 */
import type { QueryClient } from "@tanstack/react-query";
import { API_URL } from "./api.ts";

let connected = false;
export const isLive = () => connected;
/** Poll every `ms` only while the event stream is down. */
export const pollUnlessLive = (ms: number) => (connected ? false : ms);

interface StatusEvent {
  type: "document" | "note" | "recording";
  id: string;
  status: string;
  subjectId?: string | null;
  sessionId?: string | null;
  attemptId?: string | null;
}

export function connectLive(qc: QueryClient): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const es = new EventSource(`${API_URL}/events`, { withCredentials: true });
  es.onopen = () => (connected = true);
  es.onerror = () => (connected = false);
  es.addEventListener("status", (msg) => {
    const e = JSON.parse((msg as MessageEvent<string>).data) as StatusEvent;
    if (e.type === "document") {
      if (e.subjectId) void qc.invalidateQueries({ queryKey: ["subjects", e.subjectId, "tree"] });
      void qc.invalidateQueries({ queryKey: ["documents", e.id] });
      void qc.invalidateQueries({ queryKey: ["subjects"], exact: true });
    } else if (e.type === "note") {
      void qc.invalidateQueries({ queryKey: ["notes", e.id] });
      if (e.sessionId) void qc.invalidateQueries({ queryKey: ["notes", "session", e.sessionId] });
    } else {
      if (e.attemptId) void qc.invalidateQueries({ queryKey: ["attempts", e.attemptId] });
      if (e.sessionId) void qc.invalidateQueries({ queryKey: ["attempts", "session", e.sessionId] });
      void qc.invalidateQueries({ queryKey: ["attempts", "recent"] });
    }
  });
  return () => {
    connected = false;
    es.close();
  };
}
