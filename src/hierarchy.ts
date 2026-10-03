import type { HeadingCandidate } from './types.js';
import { numberedHeadingLevel } from './scanner.js';

export function inferHierarchy(headings: HeadingCandidate[]): HeadingCandidate[] {
  const sizes = [...new Set(headings.map(h => h.fontSize))].sort((a, b) => b - a);
  let previous = 0;
  let previousSize = 0;
  const parents: HeadingCandidate[] = [];
  for (const heading of headings) {
    const numbered = numberedHeadingLevel(heading.text);
    heading.level = Math.min(6, numbered ?? sizes.indexOf(heading.fontSize) + 1,
      previous + (!numbered && previousSize === heading.fontSize ? 0 : 1));
    parents.length = heading.level - 1;
    heading.parentId = parents[heading.level - 2]?.id;
    parents.push(heading);
    previous = heading.level;
    previousSize = heading.fontSize;
  }
  return headings;
}
