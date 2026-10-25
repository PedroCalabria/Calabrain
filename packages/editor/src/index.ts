/**
 * The note schema (RF09): headings, lists, bold, italic, links, quotes, code blocks and simple
 * tables. The web editor and the worker's importers share it, so imported notes always open.
 */
import type { Extensions } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

export const noteExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], defaultProtocol: "https" },
    underline: false,
    strike: false,
  }),
  TableKit.configure({ table: { resizable: false } }),
];
