const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectedHeadings, move} = require('../addon/content/editor.js');
const row = (level, page=1) => ({title:' 中文标题 ',level,page,y:30,selected:true});
test('keeps selection, edits and destination coordinates', () => {
  const rows=[row(1),{...row(2),selected:false},row(2,2)];
  assert.deepEqual(selectedHeadings(rows,2),[{title:'中文标题',level:1,page:1,y:30},{title:'中文标题',level:2,page:2,y:30}]);
});
test('rejects orphaned level, empty titles, reversed pages and no selection', () => {
  for (const rows of [[row(2)],[row(1),row(3)],[{...row(1),title:' '}],[row(1,2),row(1,1)],[{...row(1),selected:false}]]) {
    assert.throws(()=>selectedHeadings(rows,3));
  }
});
test('only moves adjacent headings within a page', () => {
  const a=row(1),b=row(2),c=row(1,2), rows=[a,b,c];
  assert.equal(move(rows,0,-1),false);
  assert.equal(move(rows,0,1),true);
  assert.deepEqual(rows,[b,a,c]);
  assert.equal(move(rows,1,1),false);
});
