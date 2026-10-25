import type {
  AttemptDetail,
  AttemptSummary,
  Marker,
  CreateNoteInput,
  DocNode,
  NoteDetail,
  NoteSummary,
  NoteVersionDetail,
  NoteVersionInfo,
  CreateDocumentInput,
  CreateFolderInput,
  DocumentDetail,
  DocumentPage,
  SplitInput,
  CreateSessionInput,
  CreateSubjectInput,
  SessionDetail,
  SubjectSummary,
  SubjectTree,
  TrashItem,
  TrashType,
  UpdateFolderInput,
  UpdateSessionInput,
  UpdateSubjectInput,
} from "@calabrain/shared";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export const subjectsQuery = queryOptions({
  queryKey: ["subjects"],
  queryFn: () => api<SubjectSummary[]>("/subjects"),
});

export const treeQuery = (subjectId: string) =>
  queryOptions({
    queryKey: ["subjects", subjectId, "tree"],
    queryFn: () => api<SubjectTree>(`/subjects/${subjectId}/tree`),
    // Poll while a document is processing (live updates arrive with server events later).
    refetchInterval: (q) => (q.state.data?.documents.some((d) => d.status === "processing") ? 2000 : false),
  });

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: ["documents", id],
    queryFn: () => api<DocumentDetail>(`/documents/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 2000 : false),
  });

export const documentPagesQuery = (id: string, from: number, to: number) =>
  queryOptions({
    queryKey: ["documents", id, "pages", from, to],
    queryFn: () => api<{ pages: DocumentPage[] }>(`/documents/${id}/pages?from=${from}&to=${to}`),
  });

export const notesQuery = queryOptions({
  queryKey: ["notes", "recent"],
  queryFn: () => api<NoteSummary[]>("/notes"),
});

export const sessionNotesQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["notes", "session", sessionId],
    queryFn: () => api<NoteSummary[]>(`/sessions/${sessionId}/notes`),
    refetchInterval: (q) => (q.state.data?.some((n) => n.status === "processing") ? 2000 : false),
  });

export const noteQuery = (noteId: string) =>
  queryOptions({
    queryKey: ["notes", noteId],
    queryFn: () => api<NoteDetail>(`/notes/${noteId}`),
    // Each editor keeps its own state; don't refetch under it.
    staleTime: Infinity,
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 2000 : false),
  });

export const noteVersionsQuery = (noteId: string) =>
  queryOptions({ queryKey: ["notes", noteId, "versions"], queryFn: () => api<NoteVersionInfo[]>(`/notes/${noteId}/versions`) });

export const noteVersionQuery = (noteId: string, v: number) =>
  queryOptions({
    queryKey: ["notes", noteId, "versions", v],
    queryFn: () => api<NoteVersionDetail>(`/notes/${noteId}/versions/${v}`),
    staleTime: Infinity,
  });

export const recordingsQuery = queryOptions({
  queryKey: ["attempts", "recent"],
  queryFn: () =>
    api<(AttemptSummary & { sessionId: string; sessionTitle: string; subjectTitle: string })[]>("/recordings"),
});

export const attemptsQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["attempts", "session", sessionId],
    queryFn: () => api<AttemptSummary[]>(`/sessions/${sessionId}/attempts`),
    refetchInterval: (q) => (q.state.data?.some((a) => a.recording?.status === "processing") ? 3000 : false),
  });

export const attemptQuery = (attemptId: string) =>
  queryOptions({
    queryKey: ["attempts", attemptId],
    queryFn: () => api<AttemptDetail>(`/attempts/${attemptId}`),
    // Playback URLs last an hour; refetch only while processing.
    staleTime: 45 * 60 * 1000,
    refetchInterval: (q) => (q.state.data?.recording?.status === "processing" ? 3000 : false),
  });

export const sessionQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["sessions", sessionId],
    queryFn: () => api<SessionDetail>(`/sessions/${sessionId}`),
  });

export const trashQuery = queryOptions({
  queryKey: ["trash"],
  queryFn: () => api<TrashItem[]>("/trash"),
});

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

export const mutations = {
  createSubject: (input: CreateSubjectInput) => api<SubjectSummary>("/subjects", json("POST", input)),
  updateSubject: (id: string, input: UpdateSubjectInput) => api<SubjectSummary>(`/subjects/${id}`, json("PATCH", input)),
  deleteSubject: (id: string) => api<void>(`/subjects/${id}`, json("DELETE")),
  createFolder: (input: CreateFolderInput) => api<{ id: string }>("/folders", json("POST", input)),
  updateFolder: (id: string, input: UpdateFolderInput) => api<{ id: string }>(`/folders/${id}`, json("PATCH", input)),
  deleteFolder: (id: string) => api<void>(`/folders/${id}`, json("DELETE")),
  createSession: (input: CreateSessionInput) => api<SessionDetail>("/sessions", json("POST", input)),
  updateSession: (id: string, input: UpdateSessionInput) => api<SessionDetail>(`/sessions/${id}`, json("PATCH", input)),
  deleteSession: (id: string) => api<void>(`/sessions/${id}`, json("DELETE")),
  createDocument: (input: CreateDocumentInput) => api<DocumentDetail>("/documents", json("POST", input)),
  renameDocument: (id: string, title: string) => api<DocumentDetail>(`/documents/${id}`, json("PATCH", { title })),
  deleteDocument: (id: string) => api<void>(`/documents/${id}`, json("DELETE")),
  documentFileUrl: (id: string) => api<{ url: string }>(`/documents/${id}/file`),
  splitDocument: (id: string, input: SplitInput) =>
    api<{ created: { sessionId: string; documentId: string }[] }>(`/documents/${id}/split`, json("POST", input)),
  createNote: (sessionId: string, input: CreateNoteInput) => api<NoteDetail>(`/sessions/${sessionId}/notes`, json("POST", input)),
  renameNote: (id: string, title: string) => api<NoteDetail>(`/notes/${id}`, json("PATCH", { title })),
  moveNote: (id: string, position: number) => api<NoteDetail>(`/notes/${id}`, json("PATCH", { position })),
  deleteNote: (id: string) => api<void>(`/notes/${id}`, json("DELETE")),
  saveDraft: (id: string, content: DocNode, baseVersion: number) =>
    api<{ savedAt: string; version: number }>(`/notes/${id}/draft`, json("PUT", { content, baseVersion })),
  createVersion: (id: string, baseVersion: number, content?: DocNode, force?: boolean) =>
    api<{ version: number; created: boolean }>(`/notes/${id}/versions`, json("POST", { baseVersion, content, force })),
  restoreVersion: (id: string, v: number) => api<{ version: number }>(`/notes/${id}/versions/${v}/restore`, json("POST")),
  createAttempt: (sessionId: string, uploadId: string, durationS?: number) =>
    api<AttemptDetail>(`/sessions/${sessionId}/attempts`, json("POST", { uploadId, durationS })),
  replaceRecording: (attemptId: string, uploadId: string, durationS?: number) =>
    api<AttemptDetail>(`/attempts/${attemptId}/recording`, json("PUT", { uploadId, durationS })),
  deleteAttempt: (attemptId: string) => api<void>(`/attempts/${attemptId}`, json("DELETE")),
  addMarker: (recordingId: string, tSeconds: number, label: string) =>
    api<Marker>(`/recordings/${recordingId}/markers`, json("POST", { tSeconds, label })),
  updateMarker: (id: string, label: string) => api<Marker>(`/markers/${id}`, json("PATCH", { label })),
  deleteMarker: (id: string) => api<void>(`/markers/${id}`, json("DELETE")),
  restore: (type: TrashType, id: string) => api<void>(`/trash/${type}/${id}/restore`, json("POST")),
  erase: (type: TrashType, id: string) => api<void>(`/trash/${type}/${id}`, json("DELETE")),
};

/** After any tree change: subjects list, trees, sessions and trash may all be stale. */
export const refreshTree = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ["subjects"] }),
    qc.invalidateQueries({ queryKey: ["sessions"] }),
    qc.invalidateQueries({ queryKey: ["trash"] }),
    qc.invalidateQueries({ queryKey: ["documents"] }),
    qc.invalidateQueries({ queryKey: ["notes"] }),
    qc.invalidateQueries({ queryKey: ["attempts", "session"] }),
  ]);
