import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import type { PdfLine } from "./types.js";

interface Span {
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

  hasEOL: boolean;
}

function fontSizeFromTransform(
  transform: number[],
): number {
  const [a, b, c, d] = transform;

  // 对旋转文字也比直接 Math.abs(d) 稳定
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);

  return Math.max(sx, sy);
}

function detectBold(
  fontName: string,
  fontFamily: string,
): boolean {
  const s = `${fontName} ${fontFamily}`.toLowerCase();

  return (
    s.includes("bold") ||
    s.includes("black") ||
    s.includes("heavy") ||
    s.includes("semibold") ||
    s.includes("demi")
  );
}

function detectItalic(
  fontName: string,
  fontFamily: string,
): boolean {
  const s = `${fontName} ${fontFamily}`.toLowerCase();

  return (
    s.includes("italic") ||
    s.includes("oblique")
  );
}

function normalizeFontSize(n: number): number {
  return Math.round(n * 10) / 10;
}

function sameLine(a: Span, b: Span): boolean {
  const tolerance =
    Math.max(a.fontSize, b.fontSize) * 0.35;

  return Math.abs(a.y - b.y) <= tolerance;
}

function compatibleStyle(spans: Span[], span: Span): boolean {
  if (spans[0].fontSize === span.fontSize) return true;
  // PDFs can give a decimal point or comma a different font size. Keep
  // adjacent punctuation with its text without merging different-size words.
  const punctuation = (text: string) => /^[\p{P}]+$/u.test(text.trim());
  const previous = spans[spans.length - 1];
  const gap = span.x - (previous.x + previous.width);
  const size = Math.min(previous.fontSize, span.fontSize);
  return (punctuation(span.text) || spans.every(s => punctuation(s.text))) &&
    Math.abs(previous.y - span.y) <= size * 0.2 &&
    gap >= -size * 0.2 && gap <= size * 0.5;
}

function buildLine(
  spans: Span[],
  page: number,
  pageWidth: number,
  pageHeight: number,
): PdfLine {
  spans.sort((a, b) => a.x - b.x);

  let text = "";

  for (let i = 0; i < spans.length; i++) {
    const current = spans[i];

    if (i > 0) {
      const prev = spans[i - 1];

      const gap =
        current.x - (prev.x + prev.width);

      // 英文词之间恢复空格
      if (
        gap > Math.max(1.5, current.fontSize * 0.15) &&
        !text.endsWith(" ")
      ) {
        text += " ";
      }
    }

    text += current.text;
  }

  text = text.replace(/\s+/g, " ").trim();

  const x = Math.min(...spans.map(s => s.x));

  const right = Math.max(
    ...spans.map(s => s.x + s.width),
  );

  const width = right - x;

  // 用字符数最多的 span 作为主样式
  const styleWeight = new Map<
    string,
    { weight: number; span: Span }
  >();

  for (const span of spans) {
    const key =
      `${span.fontName}|${span.fontSize}|${span.bold}`;

    const old = styleWeight.get(key);

    const weight =
      Math.max(1, span.text.trim().length);

    if (old) {
      old.weight += weight;
    } else {
      styleWeight.set(key, {
        weight,
        span,
      });
    }
  }

  const dominant =
    [...styleWeight.values()]
      .sort((a, b) => b.weight - a.weight)[0]
      ?.span ?? spans[0];

  const pageCenter = pageWidth / 2;
  const lineCenter = x + width / 2;

  const centered =
    Math.abs(lineCenter - pageCenter) <
    Math.max(12, pageWidth * 0.05);

  return {
    page,
    pageWidth,
    pageHeight,

    text,

    x,
    y: Math.max(...spans.map(s => s.y)),
    width,
    height: Math.max(...spans.map(s => s.height)),

    fontSize: dominant.fontSize,
    fontName: dominant.fontName,
    fontFamily: dominant.fontFamily,

    bold: dominant.bold,
    italic: dominant.italic,

    charCount: [...text.replace(/\s/g, "")].length,

    centered,
    column: 0,

    gapBefore: 0,
    gapAfter: 0,
  };
}

export async function extractLines(
  data: Uint8Array,
  assetBase = "",
): Promise<{
  pageCount: number;
  lines: PdfLine[];
  existingOutline: unknown[];
}> {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    useWorkerFetch: false,
    isEvalSupported: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,

    // 有利于字体调试/分析
    fontExtraProperties: true,

    // MVP 不需要渲染
    disableFontFace: true,
  });

  try {
  const pdf = await loadingTask.promise;
  const existingOutline = await pdf.getOutline() || [];

  const allLines: PdfLine[] = [];

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    const page =
      await pdf.getPage(pageNumber);

    const viewport =
      page.getViewport({ scale: 1, rotation: 0 });

    const content =
      await page.getTextContent();

    const spans: Span[] = [];

    for (const item of content.items) {
      if (!("str" in item)) continue;

      const text = item.str;

      if (!text.trim()) continue;
      // Match the previous rule engine: skip vertical and rotated labels.
      if (Math.abs(item.transform[1]) > Math.abs(item.transform[0]) * 0.1) continue;

      const style =
        content.styles[item.fontName];
      const metadata = style as typeof style & {fontName?:string;bold?:boolean;italic?:boolean};

      const fontFamily =
        style?.fontFamily ?? "";
      const fontName = metadata?.fontName || (page.commonObjs.has(item.fontName)
        ? page.commonObjs.get(item.fontName)?.name || item.fontName : item.fontName);

      const fontSize =
        normalizeFontSize(
          fontSizeFromTransform(item.transform),
        );

      spans.push({
        text,

        x: item.transform[4] - page.view[0],
        y: item.transform[5] - page.view[1],

        width: item.width,
        height: item.height,

        fontSize,

        fontName,
        fontFamily,

        bold: !!metadata?.bold || detectBold(
          fontName,
          fontFamily,
        ),

        italic: !!metadata?.italic || detectItalic(
          fontName,
          fontFamily,
        ),

        hasEOL: item.hasEOL,
      });
    }

    // PDF 坐标：y 越大越靠页面上方
    spans.sort((a, b) => {
      const dy = b.y - a.y;

      if (Math.abs(dy) > Math.max(a.fontSize, b.fontSize) * 0.35) {
        return dy;
      }

      return a.x - b.x;
    });

    const groups: Span[][] = [];

    for (const span of spans) {
      const last =
        groups[groups.length - 1];

      if (
        last &&
        sameLine(last[0], span) && compatibleStyle(last, span) &&
        span.x - Math.max(...last.map(s => s.x + s.width)) < Math.max(span.fontSize * 1.5, viewport.width * 0.02)
      ) {
        last.push(span);
      } else {
        groups.push([span]);
      }
    }

    const pageLines =
      groups
        .map(group =>
          buildLine(
            group,
            pageNumber,
            viewport.width,
            viewport.height,
          )
        )
        .filter(line => line.text);

    detectColumns(pageLines);
    // 保留同栏上下间距供提取结果检查。
    for (let i = 0; i < pageLines.length; i++) {
      const current = pageLines[i];

      const previous =
        pageLines.slice(0, i).reverse().find(l => l.column === current.column || l.column === -1 || current.column === -1);

      const next =
        pageLines.slice(i + 1).find(l => l.column === current.column || l.column === -1 || current.column === -1);

      if (previous) {
        current.gapBefore =
          Math.max(
            0,
            previous.y -
              current.y -
              current.height,
          );
      }

      if (next) {
        current.gapAfter =
          Math.max(
            0,
            current.y -
              next.y -
              next.height,
          );
      }
    }

    allLines.push(...pageLines);
    page.cleanup();
    // Give the host UI a chance to paint between pages.
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return {
    pageCount: pdf.numPages,
    lines: allLines,
    existingOutline,
  };
  } finally {
    await loadingTask.destroy();
  }
}

function detectColumns(
  lines: PdfLine[],
): void {
  if (!lines.length) return;

  const width =
    lines[0].pageWidth;

  const center = width / 2;
  const leftCount = lines.filter(l => l.x < width * 0.2 && l.x + l.width < center + 10).length;
  const rightCount = lines.filter(l => l.x > center - 10 && l.width < width * 0.48).length;
  if (leftCount < 3 || rightCount < 3) return;

  for (const line of lines) {
    const left = line.x;
    const right =
      line.x + line.width;

    // 横跨页面中央：认为是跨栏内容
    if (
      left < center - width * 0.12 &&
      right > center + width * 0.12
    ) {
      line.column = -1;
      continue;
    }

    const lineCenter =
      left + line.width / 2;

    line.column =
      lineCenter < center ? 0 : 1;
  }
}
