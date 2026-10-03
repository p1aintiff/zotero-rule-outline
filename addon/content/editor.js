/* Pure preview model shared by UI and Node tests. */
(function (scope) {
  function selectedHeadings(rows, pages) {
    const result = rows.filter(row => row.selected).map(row => ({title: row.title.trim(), level: Number(row.level), page: Number(row.page), y: row.y, ...(row.x === undefined ? {} : {x: row.x})}));
    if (!result.length) throw new Error('请至少选中一个标题。');
    let previous = 0, previousPage = 0;
    for (const row of result) {
      if (!row.title || row.title.length > 500) throw new Error('标题不能为空或超过 500 字。');
      if (!Number.isInteger(row.level) || row.level < 1 || row.level > 6 || row.level > previous + 1) throw new Error('首项必须为一级；后续层级不能跨级增加。删除父标题后请调整子标题层级。');
      if (!Number.isInteger(row.page) || row.page < 1 || row.page > pages || row.page < previousPage) throw new Error('页码必须在 PDF 范围内，并按顺序排列。');
      previous = row.level; previousPage = row.page;
    }
    return result;
  }
  function move(rows, index, offset) {
    const target = index + offset;
    if (target < 0 || target >= rows.length || Number(rows[index].page) !== Number(rows[target].page)) return false;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    return true;
  }
  scope.RuleOutlineEditor = {selectedHeadings, move};
  if (typeof module !== 'undefined') module.exports = scope.RuleOutlineEditor;
})(globalThis);
