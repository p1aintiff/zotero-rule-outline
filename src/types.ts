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

export interface HeadingCandidate {
  id: string;

  page: number;
  x: number;
  y: number;

  text: string;

  fontSize: number;
  bold: boolean;

  reasons: string[];

  level: number;
  parentId?: string;
  enabled: boolean;
}

export interface ScanResult {
  pageCount: number;
  bodyFontSize: number;
  lines: PdfLine[];
  margins: {
    lines: PdfLine[];
    excluded: PdfLine[];
    bands: import('./margins.js').MarginBand[];
  };
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
