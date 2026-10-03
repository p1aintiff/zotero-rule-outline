export interface PdfLine {
  page: number;
  pageWidth: number;
  pageHeight: number;

  text: string;

  x: number;
  y: number;
  width: number;
  height: number;

  fontSize: number;
  fontName: string;
  fontFamily: string;

  bold: boolean;
  italic: boolean;

  charCount: number;

  centered: boolean;
  column: number;

  gapBefore: number;
  gapAfter: number;
}

export type NumberingType =
  | "cn_chapter"
  | "cn_number"
  | "cn_paren"
  | "decimal"
  | "decimal2"
  | "decimal3"
  | "paren_num"
  | "roman"
  | "alpha";

export interface NumberingInfo {
  type: NumberingType;
  levelHint?: number;
  value: string;
}

export interface HeadingFeatures {
  fontSize: number;
  bold: number;
  shortLine: number;
  centered: number;
  spacing: number;
  numbering: number;
  keyword: number;
  penalties: number;
}

export interface HeadingCandidate {
  id: string;

  page: number;
  x: number;
  y: number;

  text: string;

  fontSize: number;
  bold: boolean;

  numbering?: NumberingInfo;

  score: number;
  features: HeadingFeatures;

  level: number;
  enabled: boolean;

  confidence: "high" | "medium" | "low";
}

export interface ScanResult {
  pageCount: number;
  bodyFontSize: number;
  lines: PdfLine[];
  headings: HeadingCandidate[];
  existingOutline: unknown[];
}

export interface OutlineHeading {
  title: string;
  level: number;
  page: number;
  /** Distance below the unrotated CropBox top; zero means page top. */
  y?: number;
  x?: number;
}
