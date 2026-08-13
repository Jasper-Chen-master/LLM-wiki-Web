import { inflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { randomUUID } from "node:crypto";
import type { DocumentBlock, DocumentKind, DocumentRecord } from "../shared/contracts.js";

/** Parsing output deliberately remains in the raw-document layer. */
export interface ParsedDocument {
  blocks: Omit<DocumentBlock, "id" | "documentId">[];
  warnings: string[];
}

export class DocumentParseError extends Error {}

const MAX_BYTES = 20 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const normalise = (value: string) => value.replace(/\s+/g, " ").trim();
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
  return { blocks, warnings: ["DOCX pagination is unavailable in the basic parser; all blocks use page 1."] };
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
  return { blocks, warnings };
}

/** Prefer Poppler's PDF interpreter when available: raw PDF streams are not text. */
async function parsePdfWithPoppler(filePath: string): Promise<ParsedDocument | undefined> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    const pages = stdout.split("\f").map(normalise).filter(Boolean);
    if (!pages.length) return undefined;
    return { blocks: pages.map((text, index) => ({ page: index + 1, blockType: "paragraph" as const, text, sourceLocation: `PDF page ${index + 1}` })), warnings: [] };
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
  return { blocks, warnings: [] };
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
  const parsed = await parseDocumentFile(document.storagePath, document.kind);
  return parsed.blocks.map(block => ({ id: randomUUID(), documentId: document.id, ...block }));
}
