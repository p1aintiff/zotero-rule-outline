import type { HeadingCandidate, PdfLine } from './types.js';

export function numberedHeadingLevel(text: string): number | undefined {
  const normalized = text.normalize('NFKC').trim();
  if ([...normalized].length > 40 || /[。；;!?！？]|\.$/.test(normalized)) return;
  const match = normalized.match(/^(\d{1,3}(?:\s*\.\s*\d{1,3}){0,5})[.、]?\s*([\p{L}].*)$/u);
  return match ? match[1].split('.').length : undefined;
}

// PDF extraction normalizes font sizes to 0.1 pt. Count characters at each
// size so many short labels do not outweigh the main body text.
export function detectBodyFontSize(lines: PdfLine[]): number {
  const counts = new Map<number, number>();
  for (const line of lines) {
    const size = line.fontSize;
    if (size > 0 && line.charCount > 0) counts.set(size, (counts.get(size) ?? 0) + line.charCount);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

export function detectHeadings(lines: PdfLine[], bodyFontSize: number): HeadingCandidate[] {
  // Large punctuation, numeric fragments and equation operators are not titles.
  return lines.filter(line => /\p{L}/u.test(line.text) && (line.fontSize > bodyFontSize || numberedHeadingLevel(line.text))).map((line, index) => ({
    id: `heading-${line.page}-${index}`, page: line.page, x: line.x, y: line.y,
    text: line.text.trim(), fontSize: line.fontSize, bold: line.bold,
    reasons: line.fontSize > bodyFontSize ? ['字号大于正文'] : ['单行、短文本、数字编号 + 文字'], level: 1, enabled: true,
  }));
}
