const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectedHeadings, recomputeLevels, move} = require('../addon/content/editor.js');
const row = (font_size, page=1) => ({title:' 中文标题 ',font_size,page,y:30,selected:true});
test('keeps selection, edits and destination coordinates', () => {
 const rows=[row(16),{...row(14),selected:false},row(12,2)];
 assert.deepEqual(selectedHeadings(rows,2),[{title:'中文标题',level:1,page:1,y:30},{title:'中文标题',level:2,page:2,y:30}]);
});
test('removing the largest size promotes retained headings and recomputes parents',()=>{
 const rows=[{...row(20),title:'论文题名'}, {...row(16),title:'章'}, {...row(14),title:'节'}, {...row(16),title:'下一章'}];
 recomputeLevels(rows);
 assert.deepEqual(rows.map(r=>r.level),[1,2,3,2]);
 rows[0].selected=false;
 assert.deepEqual(selectedHeadings(rows,1).map(r=>r.level),[1,2,1]);
 assert.equal(rows[1].parentTitle,'');
 assert.equal(rows[2].parentTitle,'章');
 rows[1].selected=false; rows[3].selected=false;
 assert.equal(selectedHeadings(rows,1)[0].level,1);
 assert.equal(rows[2].parentTitle,'');
});
test('recomputes before writing instead of trusting old levels',()=>{
 const rows=[{...row(16),level:5},{...row(14),level:6}];
 assert.deepEqual(selectedHeadings(rows,1).map(r=>r.level),[1,2]);
 assert.deepEqual(selectedHeadings([row(12),row(12),row(20)],1).map(r=>r.level),[1,1,1]);
});
test('rejects invalid fonts, empty titles, reversed pages and no selection', () => {
 for(const rows of [[row(NaN)],[row(0)],[{...row(16),title:' '}],[row(16,2),row(16,1)],[{...row(16),selected:false}]]) assert.throws(()=>selectedHeadings(rows,3));
});
test('only moves adjacent headings within a page', () => {
 const a=row(16),b=row(14),c=row(16,2),rows=[a,b,c];
 assert.equal(move(rows,0,-1),false); assert.equal(move(rows,0,1),true);
 assert.deepEqual(rows,[b,a,c]); assert.equal(move(rows,1,1),false);
});
test('numbered body-font headings retain depth and reparent after deselection',()=>{
 const rows=[{...row(11.2),title:'2 研究设计'},{...row(9.7),title:'2.1 研究框架'},
  {...row(9.7),title:'2.1.1 数据'},{...row(9.7),title:'2.2 处理'}];
 assert.deepEqual(selectedHeadings(rows,1).map(r=>r.level),[1,2,3,2]);
 assert.equal(rows[2].parentTitle,'2.1 研究框架');
 rows[1].selected=false;
 assert.deepEqual(selectedHeadings(rows,1).map(r=>r.level),[1,2,2]);
 assert.equal(rows[2].parentTitle,'2 研究设计');
});
