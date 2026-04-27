import path from "node:path";
import type { ParsedParagraph, DocumentId } from "./types";
import { ensurePdfServerPolyfills } from "./pdf-polyfills";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    ensurePdfServerPolyfills();
    pdfjsPromise = (import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfJs>).then(
      (pdfjs) => {
        // Turbopack rewrites the dynamic import of pdf.worker.mjs into a chunk
        // whose path doesn't resolve at runtime on the server. Point directly at
        // the real file in node_modules so Node.js spawns a proper Worker thread.
        pdfjs.GlobalWorkerOptions.workerSrc =
          `file://${path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")}`;
        return pdfjs;
      },
    );
  }
  return pdfjsPromise;
}

interface LineItem {
  x: number;
  y: number;
  width: number;
  height: number;
  str: string;
}

const PARAGRAPH_GAP_RATIO = 1.55;

const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
};

export function normalizeText(s: string): string {
  let out = s;
  for (const [lig, rep] of Object.entries(LIGATURES)) out = out.split(lig).join(rep);
  // De-hyphenate line-break hyphens ("atten-\ntion" → "attention"), but keep
  // real compound hyphens ("self-attention").
  out = out.replace(/(\w+)-\s+([a-z]\w+)/g, (_, a, b) => `${a}${b}`);
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

export function groupItemsIntoLines(items: LineItem[]): LineItem[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: LineItem[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    const lineH = item.height || 10;
    if (current && Math.abs(current[0].y - item.y) < lineH * 0.6) {
      current.push(item);
    } else {
      lines.push([item]);
    }
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

interface PageParagraph {
  text: string;
  topY: number;
  bottomY: number;
}

export function linesToParagraphs(lines: LineItem[][]): PageParagraph[] {
  if (lines.length === 0) return [];
  const heights = lines.flat().map((i) => i.height || 10).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 10;

  const paragraphs: { lines: LineItem[][]; topY: number; bottomY: number }[] = [];
  let current: { lines: LineItem[][]; topY: number; bottomY: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const y = line[0].y;
    const prevY = i > 0 ? lines[i - 1][0].y : null;
    const gap = prevY !== null ? prevY - y : 0;

    if (!current || (prevY !== null && gap > medianHeight * PARAGRAPH_GAP_RATIO)) {
      current = { lines: [line], topY: y, bottomY: y };
      paragraphs.push(current);
    } else {
      current.lines.push(line);
      current.bottomY = y;
    }
  }

  return paragraphs
    .map((p) => ({
      text: normalizeText(p.lines.map((l) => l.map((i) => i.str).join(" ")).join(" ")),
      topY: p.topY,
      bottomY: p.bottomY,
    }))
    .filter((p) => p.text.length > 0);
}

/**
 * Strip recurring headers/footers: paragraphs that appear verbatim on many
 * pages or are very short and positioned near the page boundaries.
 */
function stripBoilerplate(
  perPage: PageParagraph[][],
  pageHeights: number[],
): PageParagraph[][] {
  const textCounts = new Map<string, number>();
  for (const page of perPage) {
    const seen = new Set<string>();
    for (const p of page) {
      if (seen.has(p.text)) continue;
      seen.add(p.text);
      textCounts.set(p.text, (textCounts.get(p.text) || 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.floor(perPage.length * 0.3));
  return perPage.map((page, idx) => {
    const pageTop = pageHeights[idx] ?? 792;
    return page.filter((p) => {
      const appearsOften = (textCounts.get(p.text) || 0) >= threshold;
      const isShort = p.text.length < 40;
      const nearEdge = p.topY > pageTop * 0.92 || p.bottomY < pageTop * 0.08;
      if (appearsOften && isShort) return false;
      if (isShort && nearEdge && /^\s*\d+\s*$/.test(p.text)) return false; // page numbers
      return true;
    });
  });
}

export interface ParsedPdf {
  paragraphs: ParsedParagraph[];
  pageCount: number;
}

export async function parsePdf(
  docId: DocumentId,
  buffer: Uint8Array | ArrayBuffer,
): Promise<ParsedPdf> {
  const pdfjs = await loadPdfJs();
  // pdfjs-dist detaches the underlying ArrayBuffer during parsing, which
  // would poison any later use of the caller's buffer (e.g. writing the PDF
  // to storage). Always hand it an owned copy.
  const source = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const data = new Uint8Array(source.byteLength);
  data.set(source);

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const perPage: PageParagraph[][] = [];
  const pageHeights: number[] = [];

  for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    pageHeights.push(viewport.height);
    const textContent = await page.getTextContent({
      includeMarkedContent: false,
      disableNormalization: false,
    });
    const items: LineItem[] = [];
    for (const raw of textContent.items) {
      const it = raw as {
        str?: string;
        transform?: number[];
        width?: number;
      };
      if (!it.str || typeof it.str !== "string" || !it.transform) continue;
      const t = it.transform;
      items.push({
        x: t[4],
        y: t[5],
        width: it.width || 0,
        height: Math.abs(t[3] || t[0] || 10),
        str: it.str,
      });
    }
    const lines = groupItemsIntoLines(items);
    perPage.push(linesToParagraphs(lines));
    page.cleanup();
  }

  const stripped = stripBoilerplate(perPage, pageHeights);
  const paragraphs: ParsedParagraph[] = [];
  for (let i = 0; i < stripped.length; i++) {
    stripped[i].forEach((p, idx) => {
      if (p.text.length < 2) return;
      paragraphs.push({
        docId,
        page: i + 1,
        paragraphIdx: idx,
        text: p.text,
      });
    });
  }
  return { paragraphs, pageCount };
}

export const __internal = {
  groupItemsIntoLines,
  linesToParagraphs,
  stripBoilerplate,
  normalizeText,
};
