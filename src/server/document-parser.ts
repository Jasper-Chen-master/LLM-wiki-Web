import { inflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHash } from "node:crypto";
import type { DocumentBlock, DocumentKind, DocumentRecord } from "../shared/contracts.js";

/** Parsing output deliberately remains in the raw-document layer. */
export interface ParsedDocument {
  blocks: Omit<DocumentBlock, "id" | "documentId">[];
  warnings: string[];
  parserEngine: string;
  parserVersion: string;
}

export class DocumentParseError extends Error {}

const MAX_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_PARSER_VERSION = "document-parser-v2";
export const DOCUMENT_CHUNKING_VERSION = "semantic-boundary-v1";
export const DOCUMENT_CHUNK_MAX_CHARS = 1_200;
export const DOCUMENT_CHUNK_OVERLAP_CHARS = 160;
const execFileAsync = promisify(execFile);
const normalise = (value: string) => value.replace(/\s+/g, " ").trim();
const hashText = (value: string) => createHash("sha256").update(value).digest("hex");
const decodeXml = (value: string) => value
  .replace(/<w:tab\b[^>]*\/>/g, "\t")
  .replace(/<w:br\b[^>]*\/>/g, "\n")
  .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_, text) => text)
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function readZipEntry(zip: Buffer, expectedName: string): Buffer | undefined {
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const flags = zip.readUInt16LE(offset + 6);
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    // DOCX files produced by normal Office tooling record sizes in local headers.
    if (flags & 0x08) throw new DocumentParseError("DOCX with streamed ZIP entries is not supported");
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const bodyStart = offset + 30 + nameLength + extraLength;
    const bodyEnd = bodyStart + compressedSize;
    if (bodyEnd > zip.length) throw new DocumentParseError("Invalid DOCX archive");
    if (name === expectedName) {
      const body = zip.subarray(bodyStart, bodyEnd);
      if (method === 0) return body;
      if (method === 8) return inflateRawSync(body);
      throw new DocumentParseError(`Unsupported DOCX compression method: ${method}`);
    }
    offset = bodyEnd;
  }
  return undefined;
}

export function parseDocx(buffer: Buffer): ParsedDocument {
  const documentXml = readZipEntry(buffer, "word/document.xml");
  if (!documentXml) throw new DocumentParseError("DOCX does not contain word/document.xml");
  const paragraphs = documentXml.toString("utf8").match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  const blocks: Omit<DocumentBlock, "id" | "documentId">[] = [];
  paragraphs.forEach((paragraph, index) => {
    const text = normalise(decodeXml(paragraph));
    if (text) blocks.push({ page: 1, blockType: "paragraph", text, sourceLocation: `DOCX paragraph ${index + 1}` });
  });
  return {
    blocks, warnings: ["DOCX pagination is unavailable in the basic parser; all blocks use page 1."],
    parserEngine: "docx-xml", parserVersion: DOCUMENT_PARSER_VERSION,
  };
}

function pdfLiteralText(content: string): string {
  return normalise(content
    .replace(/\\\(([^)]*)\\\)/g, "$1")
    .replace(/\((?:\\.|[^\\)])*\)/g, match => match.slice(1, -1).replace(/\\([()\\])/g, "$1"))
    .replace(/[\x00-\x1F]/g, " "));
}

/**
 * Extracts plain literal PDF text only. It intentionally refuses to pretend that
 * image-only or custom-encoded PDFs were parsed successfully.
 */
export function parsePdf(buffer: Buffer): ParsedDocument {
  const raw = buffer.toString("latin1");
  if (!raw.startsWith("%PDF-")) throw new DocumentParseError("File is not a valid PDF");
  const pages = raw.split(/\/Type\s*\/Page\b/).slice(1);
  const blocks: Omit<DocumentBlock, "id" | "documentId">[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const strings = [...page.matchAll(/(\((?:\\.|[^\\)])*\))\s*(?:Tj|'|")/g)].map(match => pdfLiteralText(match[1]));
    const text = normalise(strings.join(" "));
    if (text) blocks.push({ page: pageIndex + 1, blockType: "paragraph", text, sourceLocation: `PDF page ${pageIndex + 1}` });
  }
  const warnings = ["Basic PDF parsing only extracts literal text drawing commands; scanned and many encoded PDFs require a dedicated parser/OCR."];
  if (!blocks.length) warnings.push("No extractable literal text was found.");
  return { blocks, warnings, parserEngine: "pdf-literal", parserVersion: DOCUMENT_PARSER_VERSION };
}

/** Prefer Poppler's PDF interpreter when available: raw PDF streams are not text. */
async function parsePdfWithPoppler(filePath: string): Promise<ParsedDocument | undefined> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    const pages = stdout.split("\f").map(normalise).filter(Boolean);
    if (!pages.length) return undefined;
    return {
      blocks: pages.map((text, index) => ({ page: index + 1, blockType: "paragraph" as const, text, sourceLocation: `PDF page ${index + 1}` })),
      warnings: [], parserEngine: "poppler-pdftotext", parserVersion: DOCUMENT_PARSER_VERSION,
    };
  } catch { return undefined; }
}

async function parsePdfWithPdfJs(buffer: Buffer): Promise<ParsedDocument> {
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false }).promise;
  const blocks: Omit<DocumentBlock, "id" | "documentId">[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    const text = normalise(content.items.map(item => "str" in item ? item.str : "").join(" "));
    if (text) blocks.push({ page: pageNumber, blockType: "paragraph", text, sourceLocation: `PDF page ${pageNumber}` });
  }
  if (!blocks.length) throw new DocumentParseError("No readable text found. This PDF may be scanned or protected; OCR is required.");
  return { blocks, warnings: [], parserEngine: "pdfjs", parserVersion: DOCUMENT_PARSER_VERSION };
}

function boundaryBefore(text: string, minimum: number, maximum: number): number {
  const window = text.slice(minimum, maximum);
  const candidates = ["\n", "。", "！", "？", ". ", "! ", "? ", "；", "; "];
  let best = -1;
  for (const token of candidates) {
    const index = window.lastIndexOf(token);
    if (index >= 0) best = Math.max(best, minimum + index + token.length);
  }
  if (best >= minimum) return best;
  const whitespace = window.lastIndexOf(" ");
  return whitespace >= 0 ? minimum + whitespace + 1 : maximum;
}

/** Splits parser output deterministically so no page tail is silently truncated before AI work. */
export function chunkParsedBlocks(
  blocks: Omit<DocumentBlock, "id" | "documentId">[],
  maxChars = DOCUMENT_CHUNK_MAX_CHARS,
  overlapChars = DOCUMENT_CHUNK_OVERLAP_CHARS,
): Omit<DocumentBlock, "id" | "documentId">[] {
  const chunked: Omit<DocumentBlock, "id" | "documentId">[] = [];
  for (const block of blocks) {
    const text = normalise(block.text);
    if (!text) continue;
    if (text.length <= maxChars) { chunked.push({ ...block, text }); continue; }
    let start = 0;
    let chunkIndex = 0;
    while (start < text.length) {
      const hardEnd = Math.min(text.length, start + maxChars);
      const end = hardEnd === text.length ? hardEnd : boundaryBefore(text, start + Math.floor(maxChars * .65), hardEnd);
      const part = text.slice(start, end).trim();
      if (part) chunked.push({
        ...block, text: part,
        sourceLocation: `${block.sourceLocation} · chunk ${chunkIndex + 1}`,
      });
      if (end >= text.length) break;
      const nextStart = Math.max(start + 1, end - overlapChars);
      start = nextStart;
      chunkIndex++;
    }
  }
  return chunked;
}

export async function parseDocumentFile(filePath: string, kind: DocumentKind): Promise<ParsedDocument> {
  const buffer = await readFile(filePath);
  if (buffer.length > MAX_BYTES) throw new DocumentParseError("Document exceeds the 20 MB parsing limit");
  if (kind === "docx") return parseDocx(buffer);
  const poppler = await parsePdfWithPoppler(filePath);
  if (poppler) return poppler;
  try { return await parsePdfWithPdfJs(buffer); } catch (error) { if (error instanceof DocumentParseError) throw error; }
  const fallback = parsePdf(buffer);
  if (!fallback.blocks.length) throw new DocumentParseError("No readable text found. This PDF may be scanned or protected; OCR is required.");
  return fallback;
}

/** Converts parser-only output to persisted raw blocks without crossing into AI extraction. */
export async function parseDocument(document: DocumentRecord): Promise<DocumentBlock[]> {
  if (!document.storagePath) throw new DocumentParseError("Document has no safe storage path");
  const file = await readFile(document.storagePath);
  const parsed = await parseDocumentFile(document.storagePath, document.kind);
  const contentHash = hashText(file.toString("base64"));
  const chunked = chunkParsedBlocks(parsed.blocks);
  document.contentHash = contentHash;
  document.parserEngine = parsed.parserEngine;
  document.parserVersion = parsed.parserVersion;
  document.chunkingVersion = DOCUMENT_CHUNKING_VERSION;
  document.blockCount = chunked.length;
  return chunked.map((block, index) => ({
    id: stableDocumentBlockId(document.id, contentHash, block, index),
    documentId: document.id,
    ...block,
  }));
}

export function stableDocumentBlockId(
  documentId: string,
  contentHash: string,
  block: Omit<DocumentBlock, "id" | "documentId">,
  index: number,
): string {
  return `${documentId}:block:${hashText(`${contentHash}|${block.page}|${block.blockType}|${index}|${block.text}`).slice(0, 20)}`;
}

/** Backfills content fingerprints for already-parsed documents without changing their blocks. */
export async function ensureDocumentFingerprint(document: DocumentRecord): Promise<void> {
  if (!document.storagePath || document.contentHash) return;
  const file = await readFile(document.storagePath);
  document.contentHash = hashText(file.toString("base64"));
  document.parserEngine ??= "legacy-unknown";
  document.parserVersion ??= "legacy-unknown";
  document.chunkingVersion ??= "legacy-blocks";
}
