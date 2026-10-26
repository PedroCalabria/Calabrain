/** Server-side conversions for note imports (RF11): plain text, Markdown and HTML (from .docx) to a note document. */
import type { DocNode } from "@calabrain/shared";
import { generateJSON } from "@tiptap/html/server";
import { marked } from "marked";
import { noteExtensions } from "./index.ts";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function htmlToDoc(html: string): DocNode {
  const doc = generateJSON(html || "<p></p>", noteExtensions) as DocNode;
  return doc.content?.length ? doc : { type: "doc", content: [{ type: "paragraph" }] };
}

export function markdownToDoc(md: string): DocNode {
  return htmlToDoc(marked.parse(md, { async: false, gfm: true, breaks: false }) as string);
}

/** Blank lines separate paragraphs; single line breaks stay inside them. */
export function textToDoc(text: string): DocNode {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return htmlToDoc(paragraphs.map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join(""));
}
