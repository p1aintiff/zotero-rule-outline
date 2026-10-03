import type { HeadingCandidate } from './types.js';
export function inferHierarchy(headings: HeadingCandidate[]): HeadingCandidate[] {
  const types = new Set(headings.map(h => h.numbering?.type));
  const chapter = types.has('cn_chapter'), chinese = types.has('cn_number'), paren = types.has('cn_paren');
  const sizes = [...new Set(headings.map(h => Math.round(h.fontSize * 2) / 2))].sort((a,b) => b-a);
  let previous = 0;
  for (const heading of headings) {
    const n = heading.numbering;
    if (n?.type === 'cn_chapter') heading.level = 1;
    else if (n?.type === 'cn_number') heading.level = chapter ? 2 : 1;
    else if (n?.type === 'cn_paren') heading.level = (chapter ? 1 : 0) + (chinese ? 1 : 0) + 1;
    else if (n?.type === 'decimal') heading.level = (chapter ? 1 : 0) + (chinese ? 1 : 0) + (paren ? 1 : 0) + 1;
    else if (n?.type === 'decimal2' || n?.type === 'decimal3') heading.level = (chapter ? 1 : 0) + (n.levelHint || 2);
    else if (n?.type === 'paren_num') heading.level = (chapter ? 1 : 0) + (chinese ? 1 : 0) + (paren ? 1 : 0) + 2;
    else heading.level = sizes.indexOf(Math.round(heading.fontSize * 2) / 2) + 1;
    if (/^(摘要|引言|绪论|结论|结语|讨论|参考文献|致谢|附录|abstract|references|conclusions?)$/i.test(heading.text)) heading.level = 1;
    heading.level = Math.min(6, heading.level, previous + 1);
    previous = heading.level;
  }
  return headings;
}
