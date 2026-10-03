import {
  extractLines,
} from "./extract.js";

import {
  detectBodyFontSize,
  detectHeadings,
} from "./scanner.js";

import {
  inferHierarchy,
} from "./hierarchy.js";

import type {
  ScanResult,
} from "./types.js";
import {readingOrder} from './layout.js';
import {filterPageMargins} from './margins.js';

export async function scanPdfHeadings(
  data: Uint8Array,
  assetBase = '',
): Promise<ScanResult> {
  const {
    pageCount,
    lines: extracted,
    existingOutline,
  } = await extractLines(data, assetBase);
  const lines = readingOrder(extracted);

  if (!lines.length) {
    throw new Error(
      "PDF 没有检测到有效文字层，请先进行 OCR。",
    );
  }

  const totalCharacters =
    lines.reduce(
      (sum, line) =>
        sum + line.charCount,
      0,
    );

  if (totalCharacters < 30) {
    throw new Error(
      "PDF 有效文字过少，可能是扫描版 PDF，请先进行 OCR。",
    );
  }

  const margins = filterPageMargins(lines);
  const bodyFontSize =
    detectBodyFontSize(margins.lines);

  let headings =
    detectHeadings(margins.lines, bodyFontSize);

  headings =
    inferHierarchy(headings);

  return {
    pageCount,
    bodyFontSize,
    lines,
    margins,
    headings,
    existingOutline,
  };
}

export * from "./types.js";
