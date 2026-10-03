import type { NumberingInfo } from './types.js';
const CN = '一二三四五六七八九十百千万零〇两';
export function parseNumbering(input: string): NumberingInfo | undefined {
  const text = input.normalize('NFKC').trim();
  const rules: [RegExp, NumberingInfo['type'], number | undefined][] = [
    [new RegExp(`^第[${CN}0-9]+[章节篇部卷]\\s*(?=\\S)`), 'cn_chapter', 1],
    [new RegExp(`^[${CN}]+[、.]\\s*(?=\\S)`), 'cn_number', 1],
    [new RegExp(`^\\([${CN}]+\\)\\s*(?=\\S)`), 'cn_paren', 2],
    [/^\d{1,3}(?:\.\d{1,3}){1,5}\.?\s*(?=[^\d.%\s])/, 'decimal2', undefined],
    [/^\d{1,3}[.、]\s*(?=[^\d.%\s])/, 'decimal', 1],
    [/^\(\d{1,3}\)\s*(?=\S)/, 'paren_num', 3],
    [/^\d{1,3}\)\s*(?=\S)/, 'paren_num', 2],
    [/^[IVXLCDM]{1,8}[.)、]\s*(?=\S)/, 'roman', undefined],
    [/^[A-HJ-UW-Z][.)、]\s*(?=\S)/, 'alpha', undefined],
  ];
  for (const [pattern, type, levelHint] of rules) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = match[0].trim();
    const depth = type === 'decimal2' ? (value.match(/\.\d/g)?.length || 0) + 1 : levelHint;
    return {type: depth === 3 && type === 'decimal2' ? 'decimal3' : type, levelHint: depth, value};
  }
}
