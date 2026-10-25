/** Note imports (RF11): .txt, .md, .docx and PDF become a new editable note version. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@calabrain/db";
import { createVersion } from "@calabrain/db/notes";
import { htmlToDoc, markdownToDoc, textToDoc } from "@calabrain/editor/server";
import type { DocNode } from "@calabrain/shared";
import { eq } from "drizzle-orm";
import mammoth from "mammoth";
import { extractPdf, PdfError } from "../pdf.ts";
import type { Deps } from "./documents.ts";

const { notes, uploads } = schema;

async function convert(path: string, contentType: string): Promise<DocNode> {
  const bytes = await readFile(path);
  switch (contentType) {
    case "text/plain":
      return textToDoc(bytes.toString("utf8"));
    case "text/markdown":
      return markdownToDoc(bytes.toString("utf8"));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      try {
        const { value } = await mammoth.convertToHtml({ path });
        return htmlToDoc(value);
      } catch {
        throw new PdfError("corrupt");
      }
    }
    case "application/pdf": {
      // Only the text is kept from a PDF.
      const { pages } = await extractPdf(bytes);
      return textToDoc(pages.join("\n\n"));
    }
    default:
      throw new PdfError("corrupt");
  }
}

export async function importNote({ db, storage }: Deps, noteId: string, uploadId: string): Promise<void> {
  const [note] = await db.select().from(notes).where(eq(notes.id, noteId));
  const [upload] = await db.select().from(uploads).where(eq(uploads.id, uploadId));
  if (!note || note.deletedAt || note.status !== "processing") return;
  if (!upload) {
    await db.update(notes).set({ status: "failed", failureReason: "missing" }).where(eq(notes.id, noteId));
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "calabrain-note-"));
  try {
    const path = join(dir, "import");
    try {
      await storage.download(upload.storageKey, path);
    } catch {
      await db.update(notes).set({ status: "failed", failureReason: "missing" }).where(eq(notes.id, noteId));
      return;
    }
    let doc: DocNode;
    try {
      doc = await convert(path, upload.contentType);
    } catch (err) {
      if (!(err instanceof PdfError)) throw err;
      await db.update(notes).set({ status: "failed", failureReason: err.reason }).where(eq(notes.id, noteId));
      return;
    }
    await db.transaction(async (tx) => {
      await createVersion(tx, noteId, doc, "import");
      await tx.update(notes).set({ status: "ready", failureReason: null }).where(eq(notes.id, noteId));
    });
    // The note lives in the database now; the uploaded file isn't needed.
    await storage.deleteMany([upload.storageKey]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
