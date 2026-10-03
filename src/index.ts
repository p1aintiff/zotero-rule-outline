import {
  extractLines,
} from "./extract.js";

import {
  detectBodyFontSize,
  scoreLines,
} from "./scanner.js";

import {
  inferHierarchy,
} from "./hierarchy.js";

import type {
  ScanResult,
} from "./types.js";
import {filterRepeatedMargins, readingOrder, mergeWrappedHeadings} from './layout.js';

export async function scanPdfHeadings(
  data: Uint8Array,
  threshold = 7,
  assetBase = '',
): Promise<ScanResult> {
  const {
    pageCount,
    lines: extracted,
    existingOutline,
  } = await extractLines(data, assetBase);
  if (!Number.isInteger(threshold) || threshold < 4 || threshold > 15) throw new Error('阈值必须为 4–15 的整数。');
  const lines = readingOrder(filterRepeatedMargins(extracted, pageCount));

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

  const bodyFontSize =
    detectBodyFontSize(lines);

  let headings =
    scoreLines(
      mergeWrappedHeadings(lines, bodyFontSize),
      bodyFontSize,
      threshold,
    );

  headings =
    inferHierarchy(headings);

  return {
    pageCount,
    bodyFontSize,
    lines,
    headings,
    existingOutline,
  };
}

export * from "./types.js";
