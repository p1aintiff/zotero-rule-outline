window.addEventListener('DOMContentLoaded', () => {
  const io = window.arguments[0];
  const rows = io.result.headings.map(h => ({...h, selected: true}));
  const $ = id => document.getElementById(id);
  let writing = false, completed = false;
  $('filename').textContent = io.name;
  $('baseline').textContent = `${io.result.pages} 页 · 正文基准字号 ${io.result.context.body_font_size} pt`;
  const existing = io.result.existing_outline.length;
  $('existing').hidden = !existing;
  $('existing-count').textContent = `现有 ${existing} 个书签`;
  $('status').textContent = io.result.warnings.join(' ');

  const update = () => {
    const selected = rows.filter(r => r.selected).length;
    $('count').textContent = `选中 ${selected} / ${rows.length} 个标题`;
    $('write').disabled = writing || completed || !selected || (existing > 0 && !$('overwrite').checked);
  };
  const render = () => {
    const body = $('rows'); body.replaceChildren();
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      if (!row.selected) tr.className = 'excluded';
      const cell = node => { const td = document.createElement('td'); td.append(node); tr.append(td); };
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.selected;
      check.setAttribute('aria-label', `选择 ${row.title}`);
      check.addEventListener('change', () => { row.selected = check.checked; tr.classList.toggle('excluded', !row.selected); update(); }); cell(check);
      const title = document.createElement('input'); title.type = 'text'; title.value = row.title; title.className = 'title'; title.maxLength = 500;
      title.style.paddingLeft = `${10 + (Number(row.level)-1)*18}px`; title.setAttribute('aria-label', '标题');
      title.addEventListener('input', () => row.title = title.value); cell(title);
      const level = document.createElement('select'); level.setAttribute('aria-label', '层级');
      for (let n=1;n<=6;n++) { const option = document.createElement('option'); option.value = String(n); option.textContent = String(n); level.append(option); }
      level.value = String(row.level);
      level.addEventListener('change', () => { row.level = Number(level.value); title.style.paddingLeft = `${10+(row.level-1)*18}px`; }); cell(level);
      const page = document.createElement('input'); page.type = 'number'; page.min = '1'; page.max = String(io.result.pages); page.value = row.page; page.className = 'page'; page.setAttribute('aria-label', 'PDF 页码');
      page.addEventListener('input', () => { row.page = Number(page.value); row.y = 0; row.x = 0; }); cell(page);
      const evidence = document.createElement('span'); evidence.className = 'evidence'; evidence.textContent = `${row.score} · ${row.font_size} pt`; evidence.title = row.reasons.join('、'); cell(evidence);
      const moves = document.createElement('span');
      for (const [label, offset] of [['↑', -1], ['↓', 1]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.setAttribute('aria-label', offset < 0 ? '上移' : '下移');
        button.addEventListener('click', () => { if (RuleOutlineEditor.move(rows, index, offset)) render(); }); moves.append(button);
      }
      cell(moves); body.append(tr);
    });
    update();
  };
  $('all').addEventListener('click', () => { rows.forEach(r => r.selected = true); render(); });
  $('none').addEventListener('click', () => { rows.forEach(r => r.selected = false); render(); });
  $('overwrite').addEventListener('change', update);
  $('cancel').addEventListener('click', () => { if (!writing) window.close(); });
  $('open').addEventListener('click', () => Promise.resolve(io.open()).catch(error => $('status').textContent = error.message));
  window.addEventListener('beforeunload', event => { if (writing) event.preventDefault(); });
  $('write').addEventListener('click', async () => {
    try {
      const headings = RuleOutlineEditor.selectedHeadings(rows, io.result.pages);
      writing = true; update();
      for (const control of document.querySelectorAll('input, select, button')) control.disabled = true;
      $('status').className = ''; $('status').textContent = '正在备份并写入 PDF…';
      const result = await io.apply(headings, $('overwrite').checked);
      completed = true;
      $('status').textContent = `已写入 ${result.count} 个书签。备份：${result.backup}` + (result.warning ? '\n'+result.warning : '');
      $('status').className = 'success';
      $('write').hidden = true; $('open').hidden = false;
    } catch (error) {
      $('status').className = 'error'; $('status').textContent = error.message || String(error);
    } finally {
      writing = false;
      for (const control of document.querySelectorAll('input, select, button')) control.disabled = completed;
      $('cancel').disabled = false; $('open').disabled = false; update();
    }
  });
  render();
});
