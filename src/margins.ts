import type { PdfLine } from './types.js';

export interface MarginBand {
  side: 'header' | 'footer';
  parity: number;
  /** Normalized PDF coordinates, measured from the bottom of the page. */
  bottom: number;
  top: number;
  firstPage: number;
  lastPage: number;
}

// The outer 12% is only a search area. Actual exclusion bands are learned
// from isolated lines at a stable position on at least three distinct pages.
export function filterPageMargins(lines: PdfLine[]): {
  lines: PdfLine[];
  excluded: PdfLine[];
  bands: MarginBand[];
} {
  const pages = new Map<number, PdfLine[]>();
  for (const line of lines) {
    const page = pages.get(line.page) ?? [];
    page.push(line);
    pages.set(line.page, page);
  }
  const groups: {side: MarginBand['side']; parity: number; anchor: number; lines: PdfLine[]}[] = [];
  const tolerance = 0.004; // About 3.4 pt on an A4 page; allows extraction jitter.
  for (const page of pages.values()) {
    const ordered = [...page].sort((a, b) => b.y - a.y);
    for (const line of ordered) {
      if (!(line.pageHeight > 0) || !line.text.trim()) continue;
      const position = line.y / line.pageHeight;
      const side = position >= 0.88 ? 'header' : position <= 0.12 ? 'footer' : undefined;
      if (!side) continue;
      // A normal paragraph often starts at the same height on every page.
      // Require a separate outer row with whitespace towards the body.
      const outward = ordered.some(other => side === 'header'
        ? other.y > line.y + 2 : other.y < line.y - 2);
      if (outward) continue;
      const inward = side === 'header'
        ? ordered.find(other => other.y < line.y - 2)
        : [...ordered].reverse().find(other => other.y > line.y + 2);
      if (!inward) continue;
      const gap = side === 'header'
        ? line.y - inward.y - inward.height
        : inward.y - line.y - line.height;
      if (gap < line.fontSize * 0.8) continue;
      const parity = line.page % 2;
      let group = groups.find(g => g.side === side && g.parity === parity &&
        Math.abs(g.anchor - position) <= tolerance);
      if (!group) {
        group = {side, parity, anchor: position, lines: []};
        groups.push(group);
      }
      group.lines.push(line);
    }
  }

  const bands: MarginBand[] = [];
  for (const group of groups) {
    const pageNumbers = [...new Set(group.lines.map(line => line.page))].sort((a, b) => a - b);
    if (pageNumbers.length < 3) continue;
    const firstPage = pageNumbers[0], lastPage = pageNumbers.at(-1)!;
    const possiblePages = (lastPage - firstPage) / 2 + 1;
    if (pageNumbers.length / possiblePages < 0.6) continue;
    bands.push({side: group.side, parity: group.parity, firstPage, lastPage,
      bottom: Math.max(0, Math.min(...group.lines.map(line => line.y / line.pageHeight)) - tolerance),
      top: Math.min(1, Math.max(...group.lines.map(line => (line.y + line.height) / line.pageHeight)) + tolerance)});
  }
  const kept: PdfLine[] = [], excluded: PdfLine[] = [];
  for (const line of lines) {
    const isMargin = bands.some(band => line.page % 2 === band.parity &&
      line.page >= band.firstPage && line.page <= band.lastPage &&
      line.y / line.pageHeight >= band.bottom &&
      (line.y + line.height) / line.pageHeight <= band.top);
    (isMargin ? excluded : kept).push(line);
  }
  return {lines: kept, excluded, bands};
}
