import type { PdfLine } from "./types.js";

const CAPTION_RE =
  /^(图|表|figure|fig\.?|table)\s*[\d一二三四五六七八九十]/i;

const DOI_RE =
  /\bdoi\s*:?\s*10\.\d{4,9}\//i;

const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+/i;

const EMAIL_RE =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const PAGE_RE =
  /^(?:第\s*)?\d+\s*(?:页)?$/;

const TOC_RE =
  /\.{3,}\s*\d+\s*$/;

const REFERENCE_RE =
  /^\[\d+\]\s+.{10,}/;

export function getPenalty(
  line: PdfLine,
): number {
  const text = line.text.trim();

  let penalty = 0;

  if (CAPTION_RE.test(text)) {
    penalty -= 6;
  }

  if (DOI_RE.test(text)) {
    penalty -= 10;
  }

  if (URL_RE.test(text)) {
    penalty -= 8;
  }

  if (EMAIL_RE.test(text)) {
    penalty -= 8;
  }

  if (PAGE_RE.test(text)) {
    penalty -= 10;
  }

  if (TOC_RE.test(text)) {
    penalty -= 8;
  }

  if (REFERENCE_RE.test(text)) {
    penalty -= 5;
  }

  // 页面最顶部/底部
  const top =
    line.pageHeight * 0.94;

  const bottom =
    line.pageHeight * 0.06;

  if (
    line.y > top ||
    line.y < bottom
  ) {
    penalty -= 2;
  }

  return penalty;
}