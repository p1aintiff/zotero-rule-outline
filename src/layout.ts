import type { PdfLine } from './types.js';
import { parseNumbering } from './numbering.js';
export function filterRepeatedMargins(lines: PdfLine[], pages: number): PdfLine[] {
  const occurrences = new Map<string, Set<number>>();
  const key = (l: PdfLine) => l.text.normalize('NFKC').replace(/\d+/g, '#').replace(/\s+/g, '');
  for (const line of lines) {
    if (line.y > line.pageHeight * 0.9 || line.y < line.pageHeight * 0.1) {
      const set = occurrences.get(key(line)) || new Set<number>();
      set.add(line.page); occurrences.set(key(line), set);
    }
  }
  return lines.filter(l => !((l.y > l.pageHeight * 0.9 || l.y < l.pageHeight * 0.1) &&
    (occurrences.get(key(l))?.size || 0) >= Math.max(2, Math.ceil(pages * 0.5))));
}
export function readingOrder(lines: PdfLine[]): PdfLine[] {
  const result: PdfLine[] = [];
  for (const page of new Set(lines.map(l => l.page))) {
    const pageLines = lines.filter(l => l.page === page).sort((a,b) => b.y-a.y || a.x-b.x);
    let segment: PdfLine[] = [];
    const flush = () => { result.push(...segment.sort((a,b) => a.column-b.column || b.y-a.y || a.x-b.x)); segment=[]; };
    for (const line of pageLines) {
      if (line.column === -1) { flush(); result.push(line); }
      else segment.push(line);
    }
    flush();
  }
  return result;
}
export function mergeWrappedHeadings(lines: PdfLine[], body: number): PdfLine[] {
  const result: PdfLine[] = [];
  for (let i=0; i<lines.length; i++) {
    const line = {...lines[i]};
    if (line.fontSize > body + 0.5 && line.charCount < 50 && !/[。；;]$/.test(line.text)) {
      for (let count=1; count<3 && i+1<lines.length; count++) {
        const next = lines[i+1];
        if (next.page !== line.page || next.column !== line.column || next.bold !== line.bold ||
          Math.abs(next.fontSize-line.fontSize)>0.3 || next.gapBefore>line.fontSize*0.8 ||
          next.y >= line.y || parseNumbering(next.text) || next.charCount>50 ||
          /[。；;]$/.test(next.text) || line.charCount+next.charCount>90) break;
        line.text += /[a-zA-Z]$/.test(line.text) && /^[a-zA-Z]/.test(next.text) ? ' ' + next.text : next.text;
        line.charCount += next.charCount; line.gapAfter = next.gapAfter; i++;
      }
    }
    result.push(line);
  }
  return result;
}
