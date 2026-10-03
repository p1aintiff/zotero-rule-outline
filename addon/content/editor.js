/* Pure preview model shared by UI and Node tests. */
(function (scope) {
  function numberedHeadingLevel(text) {
    const normalized = text.normalize('NFKC').trim();
    if ([...normalized].length > 40 || /[。；;!?！？]|\.$/.test(normalized)) return;
    const match = normalized.match(/^(\d{1,3}(?:\s*\.\s*\d{1,3}){0,5})[.、]?\s*([\p{L}].*)$/u);
    return match ? match[1].split('.').length : undefined;
  }
  function recomputeLevels(rows) {
    const selected = rows.filter(row => row.selected);
    const sizes = [...new Set(selected.map(row => Number(row.font_size)))].sort((a, b) => b - a);
    let previous = 0;
    let previousSize = 0;
    const parents = [];
    for (const row of rows) {
      row.parentTitle = '';
      if (!row.selected) { row.level = undefined; continue; }
      if (!Number.isFinite(Number(row.font_size)) || Number(row.font_size) <= 0) throw new Error('标题字号无效，请重新扫描。');
      const numbered = numberedHeadingLevel(row.title);
      row.level = Math.min(6, numbered ?? sizes.indexOf(Number(row.font_size)) + 1,
        previous + (!numbered && previousSize === Number(row.font_size) ? 0 : 1));
      parents.length = row.level - 1;
      row.parentTitle = parents[row.level - 2]?.title.trim() || '';
      parents.push(row);
      previous = row.level;
      previousSize = Number(row.font_size);
    }
    return selected;
  }
  function selectedHeadings(rows, pages) {
    const result = recomputeLevels(rows).map(row => ({title: row.title.trim(), level: row.level, page: Number(row.page), y: row.y, ...(row.x === undefined ? {} : {x: row.x})}));
    if (!result.length) throw new Error('请至少选中一个标题。');
    let previousPage = 0;
    for (const row of result) {
      if (!row.title || row.title.length > 500) throw new Error('标题不能为空或超过 500 字。');
      if (!Number.isInteger(row.page) || row.page < 1 || row.page > pages || row.page < previousPage) throw new Error('页码必须在 PDF 范围内，并按顺序排列。');
      previousPage = row.page;
    }
    return result;
  }
  function move(rows, index, offset) {
    const target = index + offset;
    if (target < 0 || target >= rows.length || Number(rows[index].page) !== Number(rows[target].page)) return false;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    return true;
  }
  scope.RuleOutlineEditor = {selectedHeadings, recomputeLevels, move};
  if (typeof module !== 'undefined') module.exports = scope.RuleOutlineEditor;
})(globalThis);
