import type { PdfLine } from './types.js';
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
