const {test} = require('node:test');
const assert = require('node:assert/strict');
const {engine} = require('./helpers.js');
const loaded = engine();
function line(text, fontSize=10, overrides={}) {
 return {page:1,pageWidth:595,pageHeight:842,text,x:50,y:700,width:220,height:fontSize,fontSize,
  fontName:'Regular',fontFamily:'serif',bold:false,italic:false,charCount:[...text].length,
  centered:false,column:0,gapBefore:0,gapAfter:0,...overrides};
}
test('counts font sizes at 0.1 pt precision over all text, including margins',async()=>{
 const {api}=await loaded;
 const lines=[line('正文'.repeat(20),9.7),line('标签',9.5),line('大标题',11.2),line('页边文字'.repeat(12),9.7,{y:820})];
 assert.equal(api.detectBodyFontSize(lines),9.7);
 assert.equal(api.detectBodyFontSize([]),0);
});
test('accepts every nonempty line larger than body, regardless of text, bold or location',async()=>{
 const {api}=await loaded;
 const texts=['普通标题','图1 方法','12','DOI: 10.1234/example','这是一句正文。','关键词','长'.repeat(101)];
 const candidates=api.detectHeadings(texts.map(t=>line(t,9.8,{y:820})),9.7);
 assert.deepEqual(Array.from(candidates,h=>h.text),texts);
 assert.equal(api.detectHeadings([line('参考文献',9.7,{bold:true}),line('普通方法',9.6),line(' ',12)],9.7).length,0);
});
test('short single-line numeric titles at body font form second and third levels',async()=>{
 const {api}=await loaded;
 const headings=api.inferHierarchy(api.detectHeadings([
  line('2 研究设计',11.2),line('2.1 研究框架',9.7),line('2.1.1 数据',9.7),
  line('2.2 数据处理',9.7),line('3 分析',11.2)
 ],9.7));
 assert.deepEqual(Array.from(headings,h=>h.level),[1,2,3,2,1]);
 assert.equal(headings[1].parentId,headings[0].id);
 assert.equal(headings[2].parentId,headings[1].id);
 assert.deepEqual(Array.from(headings[1].reasons),['单行、短文本、数字编号 + 文字']);
 const rejected=['2.1 '+ '长'.repeat(40),'2.1 这是一句正文。','2.1','2.1 45%','2025年', '3.14%'];
 assert.equal(api.detectHeadings(rejected.map(t=>line(t,9.7)),9.7).length,0);
});
test('levels depend only on font size, with nearest preceding lower-level parent',async()=>{
 const {api}=await loaded;
 const headings=api.inferHierarchy(api.detectHeadings([
  line('1.1.1 大标题',16),line('第一章 子标题',14),line('摘要',12),line('下个子标题',14),line('下个大标题',16)
 ],10));
 assert.deepEqual(Array.from(headings,h=>h.level),[1,2,3,2,1]);
 assert.equal(headings[1].parentId,headings[0].id);
 assert.equal(headings[2].parentId,headings[1].id);
 assert.equal(headings[3].parentId,headings[0].id);
 assert.equal(headings[4].parentId,undefined);
});
test('first heading and skipped size tiers produce a writable hierarchy',async()=>{
 const {api}=await loaded;
 const headings=api.inferHierarchy(api.detectHeadings([
  line('先出现的小标题',11),line('大标题',20),line('最小标题',11),line('中标题',16)
 ],10));
 assert.deepEqual(Array.from(headings,h=>h.level),[1,1,2,2]);
 assert.doesNotThrow(()=>api.validateHeadings(Array.from(headings,h=>({title:h.text,level:h.level,page:h.page})),1));
 const leading=api.inferHierarchy(api.detectHeadings([line('页眉',11),line('标签',11),line('论文题名',20)],10));
 assert.deepEqual(Array.from(leading,h=>h.level),[1,1,1]);
});
