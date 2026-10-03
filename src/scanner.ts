import type {
  HeadingCandidate,
  HeadingFeatures,
  PdfLine,
} from "./types.js";

import { parseNumbering } from "./numbering.js";
import { getPenalty } from "./filters.js";

const KEYWORDS = new Set([
  "摘要",
  "关键词",
  "引言",
  "绪论",
  "前言",
  "结论",
  "讨论",
  "结语",
  "参考文献",
  "附录",
  "致谢",

  "abstract",
  "introduction",
  "background",
  "conclusion",
  "conclusions",
  "discussion",
  "references",
  "bibliography",
  "appendix",
  "acknowledgements",
  "acknowledgments",
]);

function bucket05(
  size: number,
): number {
  return Math.round(size * 2) / 2;
}

export function detectBodyFontSize(
  lines: PdfLine[],
): number {
  const buckets =
    new Map<number, number>();

  for (const line of lines) {
    // 明显页眉页脚不参与正文统计
    if (
      line.y > line.pageHeight * 0.94 ||
      line.y < line.pageHeight * 0.06
    ) {
      continue;
    }

    if (line.charCount <= 0) {
      continue;
    }

    const size =
      bucket05(line.fontSize);

    buckets.set(
      size,
      (buckets.get(size) ?? 0) +
        line.charCount,
    );
  }

  if (!buckets.size) {
    return 0;
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])[0][0];
}

function fontSizeScore(
  line: PdfLine,
  body: number,
): number {
  const delta =
    line.fontSize - body;

  if (delta >= 4) return 4;
  if (delta >= 2) return 3;
  if (delta >= 1) return 2;
  if (delta >= 0.5) return 0.75;

  return 0;
}

function shortLineScore(
  text: string,
): number {
  const length =
    [...text].length;

  if (length <= 8) return 1.5;
  if (length <= 20) return 1;
  if (length <= 40) return 0.5;

  if (length > 100) return -2;

  return 0;
}

function keywordScore(
  text: string,
): number {
  const normalized =
    text
      .trim()
      .replace(/[：:。.]+$/, "")
      .toLowerCase();

  return KEYWORDS.has(normalized)
    ? 3
    : 0;
}

function spacingScore(
  line: PdfLine,
): number {
  let score = 0;

  if (
    line.gapBefore >
    line.fontSize * 0.8
  ) {
    score += 1;
  }

  if (
    line.gapAfter >
    line.fontSize * 0.5
  ) {
    score += 0.5;
  }

  return score;
}

function numberingScore(
  line: PdfLine,
): number {
  const n =
    parseNumbering(line.text);

  if (!n) return 0;

  switch (n.type) {
    case "cn_chapter":
      return 4;

    case "decimal2":
    case "decimal3":
      return 3;

    case "cn_number":
    case "cn_paren":
      return 2.5;

    default:
      return 2;
  }
}

function confidence(
  score: number,
): HeadingCandidate["confidence"] {
  if (score >= 8) return "high";
  if (score >= 6) return "medium";

  return "low";
}

export function scoreLines(
  lines: PdfLine[],
  bodyFontSize: number,
  threshold = 7,
): HeadingCandidate[] {
  const result: HeadingCandidate[] = [];

  for (const line of lines) {
    const text =
      line.text.trim();

    if (!text) continue;

    const features: HeadingFeatures = {
      fontSize:
        fontSizeScore(
          line,
          bodyFontSize,
        ),

      bold:
        line.bold ? 1.5 : 0,

      shortLine:
        shortLineScore(text),

      centered:
        line.centered ? 1 : 0,

      spacing:
        spacingScore(line),

      numbering:
        numberingScore(line),

      keyword:
        keywordScore(text),

      penalties:
        getPenalty(line),
    };

    const score =
      Object.values(features)
        .reduce(
          (sum, n) => sum + n,
          0,
        );

    // MVP 阈值
    if (score < threshold || (line.charCount > 100) || (!parseNumbering(text) && /[。；;]$/.test(text))) {
      continue;
    }

    result.push({
      id: `heading-${line.page}-${result.length}`,

      page: line.page,
      x: line.x,
      y: line.y,

      text,

      fontSize: line.fontSize,
      bold: line.bold,

      numbering:
        parseNumbering(text),

      score:
        Math.round(score * 100) / 100,

      features,

      level: 1,
      enabled: true,

      confidence:
        confidence(score),
    });
  }

  return result;
}
