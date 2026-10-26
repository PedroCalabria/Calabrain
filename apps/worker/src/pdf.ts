/** PDF text and outline extraction (pdf.js), and page-range copies (pdf-lib). */
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

export interface ExtractedOutline {
  title: string;
  level: number;
  startPage: number;
  endPage: number | null;
}

export interface Extracted {
  pageCount: number;
  pages: string[];
  outline: ExtractedOutline[];
}

export class PdfError extends Error {
  constructor(readonly reason: "no_text" | "corrupt") {
    super(reason);
  }
}

export const looksLikePdf = (bytes: Uint8Array) =>
  bytes.length > 5 && Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-");

/** Text of every page plus the embedded table of contents with page ranges. */
export async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  if (!looksLikePdf(bytes)) throw new PdfError("corrupt");
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch {
    throw new PdfError("corrupt");
  }
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : item.str && !item.str.endsWith(" ") ? " " : "";
      }
      pages.push(text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim());
      page.cleanup();
    }
    const letters = pages.join("").replace(/\s/g, "").length;
    if (letters < Math.max(20, doc.numPages * 5)) throw new PdfError("no_text");

    const outline: ExtractedOutline[] = [];
    const raw = (await doc.getOutline().catch(() => null)) ?? [];
    const walk = async (items: typeof raw, level: number) => {
      for (const item of items) {
        let page: number | null = null;
        try {
          const dest = typeof item.dest === "string" ? await doc!.getDestination(item.dest) : item.dest;
          const ref = Array.isArray(dest) ? dest[0] : null;
          if (ref && typeof ref === "object") page = (await doc!.getPageIndex(ref as never)) + 1;
          else if (typeof ref === "number") page = ref + 1;
        } catch {
          page = null;
        }
        const title = (item.title ?? "").trim();
        if (page && title) outline.push({ title, level, startPage: page, endPage: null });
        if (item.items?.length) await walk(item.items, level + 1);
      }
    };
    await walk(raw, 1);

    // A chapter ends where the next entry at its level or above starts.
    for (let i = 0; i < outline.length; i++) {
      const cur = outline[i]!;
      const next = outline.slice(i + 1).find((o) => o.level <= cur.level);
      cur.endPage = next ? Math.max(cur.startPage, next.startPage - 1) : doc.numPages;
    }
    return { pageCount: doc.numPages, pages, outline };
  } finally {
    await doc.cleanup();
    await loadingTask.destroy();
  }
}

/** A new PDF with pages [start, end] (1-based, inclusive) of the source. */
export async function copyPages(bytes: Uint8Array, start: number, end: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  const pages = await out.copyPages(src, indices);
  for (const p of pages) out.addPage(p);
  return out.save();
}
