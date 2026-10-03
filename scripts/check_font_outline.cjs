const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {engine} = require('../tests/helpers.js');
const {selectedHeadings} = require('../addon/content/editor.js');
(async () => {
 const {api,assetBase}=await engine();
 const input=process.argv[2];
 const data=new Uint8Array(await fs.readFile(input));
 const result=await api.scan(data,assetBase);
 const rows=result.headings.map(h=>({...h,selected:/^[1-4](?:\.|\s)/.test(h.title)}));
 const example=selectedHeadings(rows,result.pages);
 const written=await api.writeOutline(data,example,true);
 const checked=await api.inspectOutline(written,assetBase);
 assert.deepEqual(Array.from(checked.headings,h=>({title:h.title,level:h.level,page:h.page})),Array.from(example,({title,level,page})=>({title,level,page})));
 const report={source:input,pages:result.pages,body_font_size:result.context.body_font_size,
  candidates:result.headings.map(h=>({title:h.title,page:h.page,font_size:h.font_size,level:h.level,parent:h.parentId||null})),
  selection_example:example,roundtrip:'passed (in memory; source PDF unchanged)'};
 const out=path.resolve('.qa-zotero-runtime');
 await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(out,'font-outline-sample.json'),JSON.stringify(report,null,2));
 const md=['# 字号与单行数字编号规则解析结果','',`正文基准字号：${report.body_font_size} pt；${report.pages} 页；${report.candidates.length} 个候选。`,
  '','| 页码 | 字号 | 初始层级 | 标题 |','|---|---|---|---|',
  ...report.candidates.map(h=>`| ${h.page} | ${h.font_size} pt | ${h.level} | ${h.title} |`),
  '','## 仅保留数字编号章节的勾选示例','',
  ...example.map(h=>`${'  '.repeat(h.level-1)}- ${h.title}（第 ${h.page} 页，${h.level} 级）`),
  '','已在内存中写入并重新读取验证标题、层级和页码；原 PDF 未改动。',''].join('\n');
 await fs.writeFile(path.join(out,'font-outline-sample.md'),md);
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
