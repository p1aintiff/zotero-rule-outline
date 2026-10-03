const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {PDFDocument,PDFName,PDFHexString}=require('pdf-lib');
const {engine,fileIO,fixture}=require('./helpers.js');
const loaded=engine();
test('accepts typed arrays from another JavaScript realm, including nonzero-offset views',async()=>{
  const {api,assetBase}=await loaded;
  const data=await fixture();
  const foreign=require('node:vm').runInNewContext('const bytes=new Uint8Array(input.length+16);bytes.set(input,8);bytes.subarray(8,8+input.length)',{input:[...data]});
  assert.equal(foreign instanceof Uint8Array,false);
  assert.equal((await api.scan(foreign,7,assetBase)).pages,3);
  const updated=await api.writeOutline(foreign,[{title:'跨环境标题',level:1,page:1,y:80}],false);
  assert.equal((await api.inspectOutline(updated,assetBase)).headings[0].title,'跨环境标题');
});
test('PDF.js scans Chinese headings, filters margins and captions, infers hierarchy',async()=>{
  const {api,assetBase}=await loaded,result=await api.scan(await fixture(),7,assetBase);
  assert.equal(result.pages,3);assert.equal(result.context.body_font_size,10.5);
  assert.ok(result.headings.some(h=>h.title==='第一章 绪论'));
  assert.ok(result.headings.some(h=>h.title==='一、研究背景'&&h.level===2));
  assert.ok(result.headings.every(h=>!h.title.includes('Journal')&&!h.title.includes('Figure')));
  assert.ok(result.headings[0].y>0&&result.headings[0].y<150);
  const extracted=await api.extractLines(await fixture(),assetBase);
  assert.equal(extracted.lines.find(l=>l.text.includes('Figure')).bold,true);
  assert.ok((await api.scan(await fixture(),15,assetBase)).headings.length<result.headings.length);
});
test('separates columns and rejects PDFs without text, signed or invalid PDFs',async()=>{
  const {api,assetBase}=await loaded,result=await api.scan(await fixture({columns:true}),7,assetBase);
  assert.ok(result.headings.some(h=>h.title.includes('左栏研究方法')&&!h.title.includes('右栏')));
  assert.ok(result.headings.some(h=>h.title.includes('右栏研究结果')&&!h.title.includes('左栏')));
  await assert.rejects(api.scan(await fixture({blank:true}),7,assetBase),/OCR/);
  await assert.rejects(api.scan(await fixture({signed:true}),7,assetBase),/数字签名/);
  await assert.rejects(api.scan(new Uint8Array([1,2,3]),7,assetBase),/无法读取/);
});
test('writes Unicode nested outlines, preserves annotations and crop/rotation destinations',async()=>{
  const {api,assetBase}=await loaded,original=await fixture({rotated:true}),doc=await PDFDocument.load(original);
  const annotation=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[30,40,50,60],Contents:PDFHexString.fromText('保留批注')}));
  doc.getPage(0).node.set(PDFName.of('Annots'),doc.context.obj([annotation]));
  const annotated=await doc.save(),rows=[{title:'中文父标题',level:1,page:1,y:80,x:30},{title:'子标题',level:2,page:1,y:120},
    {title:'第二个子标题',level:2,page:2,y:0},{title:'末章',level:1,page:3,y:0}];
  const bytes=await api.writeOutline(annotated,rows,false),check=await api.inspectOutline(bytes,assetBase);
  assert.deepEqual([...check.headings.map(h=>h.title)],rows.map(h=>h.title));
  assert.deepEqual([...check.headings.map(h=>h.level)],[1,2,2,1]);
  assert.equal(check.headings[0].y,730);assert.equal(check.headings[0].x,50);
  const written=await PDFDocument.load(bytes);
  assert.equal(written.getPageCount(),3);assert.equal(written.getPage(0).node.lookup(PDFName.of('Annots')).size(),1);
  assert.equal(written.catalog.lookup(PDFName.of('Outlines')).lookup(PDFName.of('Count')).asNumber(),4);
  await assert.rejects(api.writeOutline(bytes,rows,false),/已有大纲/);await api.writeOutline(bytes,rows,true);
  for(const bad of [[{title:'x',level:2,page:1}],[{title:'',level:1,page:1}],[{title:'x',level:1,page:9}]]) await assert.rejects(api.writeOutline(original,bad,false));
});
test('backs up, validates changes, restores byte-for-byte and rejects tampering and locks',async()=>{
  const {api,assetBase}=await loaded,directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-js-'));
  try{
    const pdf=path.join(directory,'中文 论文.pdf'),original=await fixture();await fs.writeFile(pdf,original);
    const service=api.createService(fileIO(),{join:path.join,filename:path.basename},assetBase);
    const scanned=await service.run({action:'scan',pdf,threshold:7});
    const request={action:'apply',pdf,sha256:scanned.sha256,headings:scanned.headings,overwrite:false},result=await service.run(request);
    assert.deepEqual(await fs.readFile(result.backup),Buffer.from(original));
    await assert.rejects(service.run(request),/自预览后已变化/);
    const written=await fs.readFile(pdf);await fs.appendFile(pdf,'modified');
    await assert.rejects(service.run({action:'restore',pdf}),/被修改/);await fs.writeFile(pdf,written);
    const io=fileIO(),record=await fs.readFile(pdf+'.rule-outline-backups/latest.json');
    const failingIO={...io,write:async(p,data,options)=>{if(p===pdf)throw new Error('simulated replace failure');return io.write(p,data,options);}};
    const failingService=api.createService(failingIO,{join:path.join,filename:path.basename},assetBase);
    await assert.rejects(failingService.run({...request,sha256:await api.sha256(new Uint8Array(written)),overwrite:true}),/simulated replace failure/);
    assert.deepEqual(await fs.readFile(pdf),written);
    assert.deepEqual(await fs.readFile(pdf+'.rule-outline-backups/latest.json'),record);
    const backup=await fs.readFile(result.backup);await fs.appendFile(result.backup,'corrupt');
    await assert.rejects(service.run({action:'restore',pdf}),/备份校验/);await fs.writeFile(result.backup,backup);
    await service.run({action:'restore',pdf});assert.deepEqual(await fs.readFile(pdf),Buffer.from(original));
    await assert.rejects(service.run({action:'restore',pdf}),/已恢复/);
    await fs.writeFile(pdf+'.rule-outline.lock','lock');await assert.rejects(service.run(request),/互斥锁/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
