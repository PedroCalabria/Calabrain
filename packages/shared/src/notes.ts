import { z } from "zod";

/** A TipTap/ProseMirror document as JSON. */
export interface DocNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
}

export const emptyDoc = (): DocNode => ({ type: "doc", content: [{ type: "paragraph" }] });

const docNodeSchema: z.ZodType<DocNode> = z.lazy(() =>
  z.object({
    type: z.string().max(64),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    marks: z.array(z.object({ type: z.string().max(64), attrs: z.record(z.string(), z.unknown()).optional() })).optional(),
    content: z.array(docNodeSchema).optional(),
  }),
);

export const docSchema = docNodeSchema.refine((d) => d.type === "doc", { message: "Not a note document." });

const BLOCKS = new Set(["paragraph", "heading", "blockquote", "codeBlock", "listItem", "tableRow", "horizontalRule"]);

/**
 * Plain text of a note version. Phase 2 marks claims by character offsets in this text,
 * so the function must stay stable: one line per non-empty block or code line, table cells joined by " | ".
 */
export function docToText(doc: DocNode): string {
  const lines: string[] = [];
  let line = "";
  const flush = () => {
    lines.push(line);
    line = "";
  };
  const walk = (node: DocNode) => {
    if (node.type === "text") {
      line += node.text ?? "";
      return;
    }
    if (node.type === "hardBreak") {
      flush();
      return;
    }
    if (node.type === "tableCell" || node.type === "tableHeader") {
      if (line) line += " | ";
      node.content?.forEach((c, i) => {
        if (i > 0) line += " ";
        c.content?.forEach(walk);
      });
      return;
    }
    const block = BLOCKS.has(node.type);
    if (block && line) flush();
    const isLeafBlock = block && node.type !== "listItem" && node.type !== "blockquote";
    node.content?.forEach(walk);
    if (isLeafBlock || node.type === "tableRow") flush();
  };
  walk(doc);
  if (line) flush();
  return lines
    .flatMap((l) => l.split("\n"))
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");
}

// --- API shapes

export const createNoteSchema = z.object({
  title: z.string().trim().min(1, { message: "Give the note a name." }).max(160).optional(),
  /** Import a .txt, .md, .docx or PDF as a new editable note (RF11). */
  uploadId: z.uuid().optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({ title: z.string().trim().min(1, { message: "Give the note a name." }).max(160), position: z.number().int().min(0) })
  .partial();

export const saveDraftSchema = z.object({
  content: docSchema,
  /** The version the editor started from; a mismatch means another tab saved meanwhile (409). */
  baseVersion: z.number().int().min(0),
});
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export const createVersionSchema = z.object({
  baseVersion: z.number().int().min(0),
  /** Content to save; defaults to the stored draft. */
  content: docSchema.optional(),
  /** Save even if another tab created a version meanwhile ("save as new version"). */
  force: z.boolean().optional(),
});
export type CreateVersionInput = z.infer<typeof createVersionSchema>;

export interface NoteSummary {
  id: string;
  sessionId: string;
  title: string;
  position: number;
  status: "processing" | "ready" | "failed";
  failureReason: string | null;
  version: number;
  updatedAt: string;
  /** For lists outside a session (the Notes page). */
  sessionTitle?: string;
  subjectId?: string;
  subjectTitle?: string;
}

export interface NoteDetail extends NoteSummary {
  /** What the editor shows: the draft when it's newer than the last version, else that version. */
  content: DocNode;
  hasUnversionedDraft: boolean;
  draftUpdatedAt: string | null;
}

export interface NoteVersionInfo {
  version: number;
  source: "editor" | "import" | "restore";
  createdAt: string;
  words: number;
}

export interface NoteVersionDetail extends NoteVersionInfo {
  content: DocNode;
  text: string;
}
