import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { StatusChip } from "../../components/documents.tsx";
import { FormAlert, Spinner } from "../../components/ui.tsx";
import { documentPagesQuery, documentQuery, mutations } from "../../lib/queries.ts";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** PDF viewer (RF06), with the extracted text (RF05) and the outline for jumping between chapters. */
export function DocumentPage() {
  const { documentId } = useParams({ strict: false }) as { documentId: string };
  const search = useSearch({ strict: false }) as { page?: number };
  const navigate = useNavigate();
  const { data: doc } = useSuspenseQuery(documentQuery(documentId));
  const page = Math.min(Math.max(1, search.page ?? 1), doc.pageCount ?? 1);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState<"pdf" | "text">("pdf");
  const [frame, width] = useWidth<HTMLDivElement>();

  const file = useQuery({
    queryKey: ["documents", documentId, "file"],
    queryFn: () => mutations.documentFileUrl(documentId),
    enabled: doc.status === "ready",
    staleTime: 10 * 60 * 1000,
  });
  const text = useQuery({ ...documentPagesQuery(documentId, page, page), enabled: view === "text" && doc.status === "ready" });

  const go = (p: number) =>
    navigate({ to: "/documents/$documentId", params: { documentId }, search: { page: Math.min(Math.max(1, p), doc.pageCount ?? 1) }, replace: true });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(page + 1);
      if (e.key === "ArrowLeft") go(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const back = doc.sessionId
    ? { to: "/sessions/$sessionId" as const, params: { sessionId: doc.sessionId }, label: "Back to the session" }
    : { to: "/subjects/$subjectId" as const, params: { subjectId: doc.subjectId }, label: "Back to the subject" };

  return (
    <>
      <header className="rise" style={{ "--i": 0 } as CSSProperties}>
        <Link {...back} className="inline-flex items-center gap-1 text-[13px] text-ink-muted no-underline hover:text-ink">
          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
          {back.label}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 text-2xl leading-8 font-medium tracking-[-0.01em] break-words">{doc.title}</h1>
          <StatusChip status={doc.status} reason={doc.failureReason} />
        </div>
        {doc.parentDocumentId && doc.pageStart ? (
          <p className="mt-1 text-[13px] text-ink-muted">
            Pages {doc.pageStart}–{doc.pageEnd} of the book
          </p>
        ) : null}
      </header>

      {doc.status !== "ready" ? (
        <div className="mt-6 max-w-[640px]">
          {doc.status === "failed" ? (
            <FormAlert>This file couldn't be processed. Upload it again from its subject or session.</FormAlert>
          ) : (
            <p className="flex items-center gap-2 text-ink-muted">
              <Spinner /> Reading the text of every page. This page updates on its own.
            </p>
          )}
        </div>
      ) : (
        <div className="rise mt-5 grid gap-5 lg:grid-cols-[240px_1fr]" style={{ "--i": 1 } as CSSProperties}>
          {doc.outline.length ? (
            <nav aria-label="Contents" className="panel hidden max-h-[calc(100dvh-180px)] self-start overflow-y-auto p-2 lg:sticky lg:top-6 lg:block">
              <ul>
                {doc.outline.map((o, i) => {
                  const active = page >= o.startPage && page <= (o.endPage ?? o.startPage);
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => go(o.startPage)}
                        className={clsx(
                          "flex w-full items-baseline gap-2 rounded-[6px] py-1.5 pr-2 text-left text-[13px] leading-[18px] transition-colors duration-[250ms] hover:bg-surface-sunken",
                          active && o.level === Math.max(...doc.outline.filter((x) => page >= x.startPage && page <= (x.endPage ?? x.startPage)).map((x) => x.level)) && "bg-surface-sunken font-medium",
                        )}
                        style={{ paddingLeft: 8 + (o.level - 1) * 14 }}
                      >
                        <span className="min-w-0 flex-1 truncate">{o.title}</span>
                        <span className="flex-none text-xs text-ink-muted tabular-nums">{o.startPage}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : (
            <div className="hidden lg:block" />
          )}

          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1" role="tablist" aria-label="View">
                {(["pdf", "text"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={clsx("btn btn-ghost", view === v && "bg-surface-sunken")}
                  >
                    {v === "pdf" ? "Document" : "Extracted text"}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1">
                {view === "pdf" ? (
                  <>
                    <button type="button" className="btn btn-ghost size-8 p-0" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                      <Minus size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                    <span className="w-12 text-center text-xs text-ink-muted tabular-nums">{Math.round(zoom * 100)}%</span>
                    <button type="button" className="btn btn-ghost size-8 p-0" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                      <Plus size={16} strokeWidth={1.75} aria-hidden />
                    </button>
                  </>
                ) : null}
                <button type="button" className="btn btn-ghost size-8 p-0" aria-label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)}>
                  <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
                </button>
                <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
                  <span className="sr-only">Page</span>
                  <input
                    key={page}
                    className="field-input h-8 w-14 px-2 text-center tabular-nums"
                    defaultValue={page}
                    inputMode="numeric"
                    onKeyDown={(e) => e.key === "Enter" && go(Number((e.target as HTMLInputElement).value) || page)}
                    onBlur={(e) => Number(e.target.value) !== page && go(Number(e.target.value) || page)}
                  />
                  of {doc.pageCount}
                </label>
                <button type="button" className="btn btn-ghost size-8 p-0" aria-label="Next page" disabled={page >= (doc.pageCount ?? 1)} onClick={() => go(page + 1)}>
                  <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            </div>

            <div ref={frame} className="overflow-x-auto rounded-[14px] bg-surface-sunken p-3 sm:p-5">
              {view === "pdf" ? (
                file.data ? (
                  <Document
                    file={file.data.url}
                    loading={<ViewerNote>Opening the PDF…</ViewerNote>}
                    error={<ViewerNote>We couldn't open the PDF. Reload the page to try again.</ViewerNote>}
                    onLoadError={() => file.refetch()}
                  >
                    <Page
                      pageNumber={page}
                      width={Math.max(240, Math.min(width - 40, 860) * zoom)}
                      className="mx-auto w-fit overflow-hidden rounded-[6px] shadow-card"
                      loading={<ViewerNote>Loading page {page}…</ViewerNote>}
                    />
                  </Document>
                ) : (
                  <ViewerNote>{file.isError ? "We couldn't get the file. Reload the page." : "Opening the PDF…"}</ViewerNote>
                )
              ) : (
                <article className="mx-auto max-w-[70ch] rounded-[10px] bg-surface-raised p-5 whitespace-pre-wrap shadow-card sm:p-8">
                  {text.data ? text.data.pages[0]?.text || <span className="text-ink-muted">No text on this page.</span> : <Spinner />}
                </article>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const ViewerNote = ({ children }: { children: React.ReactNode }) => (
  <p className="py-16 text-center text-[13px] text-ink-muted">{children}</p>
);
