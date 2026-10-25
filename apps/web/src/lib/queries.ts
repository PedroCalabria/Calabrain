import type {
  CreateFolderInput,
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
  restore: (type: TrashType, id: string) => api<void>(`/trash/${type}/${id}/restore`, json("POST")),
  erase: (type: TrashType, id: string) => api<void>(`/trash/${type}/${id}`, json("DELETE")),
};

/** After any tree change: subjects list, trees, sessions and trash may all be stale. */
export const refreshTree = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ["subjects"] }),
    qc.invalidateQueries({ queryKey: ["sessions"] }),
    qc.invalidateQueries({ queryKey: ["trash"] }),
  ]);
