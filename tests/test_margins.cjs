const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {engine} = require('./helpers.js');
const loaded = engine();
function line(text, page, y, fontSize=10, overrides={}) {
  return {page,pageWidth:595,pageHeight:842,text,x:50,y,width:220,height:fontSize,fontSize,
    fontName:'Regular',fontFamily:'serif',bold:false,italic:false,charCount:[...text].length,
    centered:false,column:0,gapBefore:0,gapAfter:0,...overrides};
}

test('learns narrow bands from changing headers and page numbers, separately for odd/even pages',async()=>{
  const {api}=await loaded;
  const lines=[];
  for(let p=1;p<=8;p++) {
    lines.push(line(`${p} 章名`,p,p%2 ? 760.5 : 780,10.6));
    lines.push(line('正文'.repeat(40),p,700,12));
    lines.push(line('正文末行',p,110,12));
    lines.push(line(p<=2 ? ['I','Ⅱ'][p-1] : String(p-2),p,73+(p%3)*0.3,9));
  }
  // A real heading in the search area, but below the learned header band.
  lines.push(line('4.2.3 专利引用网络权重计算',3,744,14));
  const result=api.filterPageMargins(lines);
  assert.equal(result.bands.length,4);
  assert.equal(result.excluded.length,16);
  assert.ok(result.lines.some(l=>l.text==='4.2.3 专利引用网络权重计算'));
  assert.ok(result.lines.every(l=>l.fontSize>=12));
  assert.equal(api.detectBodyFontSize(result.lines),12);
});

test('keeps ordinary paragraphs, sparse edge titles, covers and same-text body headings',async()=>{
  const {api}=await loaded;
  const lines=[line('封面独立题名',1,760,18)];
  for(let p=2;p<=9;p++) {
    lines.push(line('1 绪论',p,760,10));
    lines.push(line('正文'.repeat(10),p,700,12));
    lines.push(line('正文末行',p,110,12));
  }
  lines.push(line('1 绪论',4,710,18));
  lines.push(line('独立边缘标题',10,800,18),line('该页正文',10,700,12));
  const result=api.filterPageMargins(lines);
  assert.equal(result.excluded.length,8);
  assert.ok(result.lines.some(l=>l.page===1));
  assert.ok(result.lines.some(l=>l.text==='1 绪论'&&l.fontSize===18));
  assert.ok(result.lines.some(l=>l.text==='独立边缘标题'));
  const paragraphs=[];
  for(let p=1;p<=8;p++) paragraphs.push(line('第一行正文',p,760,12),line('第二行正文',p,740,12));
  assert.equal(api.filterPageMargins(paragraphs).excluded.length,0);
  assert.equal(api.filterPageMargins([line('重复',1,760),line('重复',1,760),line('正文',1,700)]).bands.length,0);
});

test('requires three distinct pages per parity and rejects widely separated coincidences',async()=>{
  const {api}=await loaded;
  const lines=[];
  for(const p of [1,3,21]) lines.push(line('疑似页眉',p,760),line('正文',p,700,12));
  assert.equal(api.filterPageMargins(lines).bands.length,0);
  assert.equal(api.filterPageMargins(lines.slice(0,4)).bands.length,0);
});

test('real thesis removes numbered running heads while preserving chapter and near-edge section headings',async(t)=>{
  const file=path.resolve('test-data/基于专利引用结构与语义向量的无人机控制领域技术路径分析 - 程缨舒 - .pdf');
  let data;
  try {data=new Uint8Array(await fs.readFile(file));}
  catch(error) {if(error.code==='ENOENT'){t.skip('Optional local thesis fixture unavailable');return;}throw error;}
  const {api,assetBase}=await loaded;
  const extracted=await api.extractLines(data,assetBase);
  const margins=api.filterPageMargins(extracted.lines);
  assert.equal(extracted.pageCount,90);
  assert.equal(margins.bands.length,4);
  assert.ok(margins.excluded.some(l=>l.text==='1 绪论'&&l.page===13));
  assert.ok(margins.excluded.some(l=>l.text==='山东工商学院硕士学位论文'));
  assert.ok(margins.excluded.some(l=>l.page===12&&l.text==='1'));
  const result=await api.scan(data,assetBase);
  assert.equal(result.context.body_font_size,12);
  assert.ok(!result.headings.some(h=>h.font_size===10.6&&/^\d+\s/.test(h.title)));
  assert.ok(result.headings.some(h=>h.page===69&&h.title==='6 无人机控制领域技术路径延伸分析'&&h.font_size===18));
  assert.ok(result.headings.some(h=>h.page===47&&h.title==='4.2.3 专利引用网络权重计算'));
  assert.ok(result.headings.some(h=>h.page===73&&h.title==='6.3 主题相似度计算'));
  assert.ok(result.headings.some(h=>h.page===25&&h.title==='2.2.1 技术路径的形成研究'&&h.level===3));
  assert.ok(!result.headings.some(h=>h.page===25&&['2','2.1 技术路径的形成研究'].includes(h.title)));
  assert.ok(result.headings.every(h=>/\p{L}/u.test(h.title)));
  const body=api.detectBodyFontSize(extracted.lines);
  const before=api.detectHeadings(extracted.lines,body).length;
  t.diagnostic(`Thesis: ${margins.excluded.length} margin lines excluded; candidates ${before} -> ${result.headings.length}`);
});
