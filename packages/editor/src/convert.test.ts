import { docToText } from "@calabrain/shared";
import { describe, expect, it } from "vitest";
import { htmlToDoc, markdownToDoc, textToDoc } from "./server.ts";

describe("note imports (RF11)", () => {
  it("turns Markdown into headings, lists, bold, links, quotes, code and tables", () => {
    const doc = markdownToDoc(
      [
        "# Leader election",
        "",
        "When the leader dies, **promote** a follower:",
        "",
        "1. Detect the failure",
        "2. Choose the newest follower",
        "",
        "> Split brain is the danger.",
        "",
        "```",
        "timeout = 30s",
        "```",
        "",
        "See [Raft](https://raft.github.io).",
        "",
        "| Node | Role |",
        "| --- | --- |",
        "| A | leader |",
      ].join("\n"),
    );
    const types = doc.content!.map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "orderedList", "blockquote", "codeBlock", "paragraph", "table"]);
    expect(JSON.stringify(doc)).toContain('"type":"bold"');
    expect(JSON.stringify(doc)).toContain('"href":"https://raft.github.io"');
    expect(docToText(doc)).toBe(
      [
        "Leader election",
        "When the leader dies, promote a follower:",
        "Detect the failure",
        "Choose the newest follower",
        "Split brain is the danger.",
        "timeout = 30s",
        "See Raft.",
        "Node | Role",
        "A | leader",
      ].join("\n"),
    );
  });

  it("keeps paragraphs and line breaks from plain text, escaping markup", () => {
    const doc = textToDoc("First line\nsecond line\n\n<b>Not bold</b>");
    expect(doc.content).toHaveLength(2);
    expect(docToText(doc)).toBe("First line\nsecond line\n<b>Not bold</b>");
  });

  it("reads HTML from Word documents", () => {
    const doc = htmlToDoc("<h2>Replication</h2><ul><li><p>Sync</p></li><li><p>Async</p></li></ul><p><em>Done</em></p>");
    expect(doc.content!.map((n) => n.type)).toEqual(["heading", "bulletList", "paragraph"]);
  });
});
