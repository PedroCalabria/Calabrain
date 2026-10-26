import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, StandardFonts } from "pdf-lib";

/**
 * A text PDF with one page per entry of `pages`, and an embedded outline
 * (chapters with optional sections) pointing at 1-based page numbers.
 */
export async function makePdf(
  pages: string[],
  outline: { title: string; page: number; children?: { title: string; page: number }[] }[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([400, 600]);
    if (text) page.drawText(text, { x: 40, y: 540, size: 12, font, maxWidth: 320, lineHeight: 16 });
  }
  if (outline.length) addOutline(doc, outline);
  return doc.save();
}

type Entry = { title: string; page: number; children?: Entry[] };

function addOutline(doc: PDFDocument, entries: Entry[]) {
  const ctx = doc.context;
  const pageRefs = doc.getPages().map((p) => p.ref);
  const rootRef = ctx.nextRef();

  const build = (items: Entry[], parent: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = items.map(() => ctx.nextRef());
    let count = 0;
    items.forEach((item, i) => {
      const dict = new Map<PDFName, unknown>();
      const obj = ctx.obj({
        Title: PDFHexString.fromText(item.title),
        Parent: parent,
        Dest: [pageRefs[item.page - 1]!, PDFName.of("XYZ"), null, null, null],
      }) as PDFDict;
      if (i > 0) obj.set(PDFName.of("Prev"), refs[i - 1]!);
      if (i < items.length - 1) obj.set(PDFName.of("Next"), refs[i + 1]!);
      if (item.children?.length) {
        const sub = build(item.children, refs[i]!);
        obj.set(PDFName.of("First"), sub.first);
        obj.set(PDFName.of("Last"), sub.last);
        obj.set(PDFName.of("Count"), PDFNumber.of(sub.count));
        count += sub.count;
      }
      void dict;
      ctx.assign(refs[i]!, obj);
      count += 1;
    });
    return { first: refs[0]!, last: refs[refs.length - 1]!, count };
  };

  const top = build(entries, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: "Outlines", First: top.first, Last: top.last, Count: PDFNumber.of(top.count) }));
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

export const bookPages = Array.from({ length: 12 }, (_, i) => `Page ${i + 1}. Replication keeps a copy of the same data on several machines.`);
export const bookOutline = [
  { title: "Part I", page: 1, children: [{ title: "Ch. 1 Reliability", page: 1 }, { title: "Ch. 2 Data models", page: 4 }] },
  { title: "Part II", page: 7, children: [{ title: "Ch. 5 Replication", page: 7 }, { title: "Ch. 6 Partitioning", page: 10 }] },
];
