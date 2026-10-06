const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {PDFDocument,PDFName,PDFHexString}=require('pdf-lib');
const {engine,fileIO,fixture}=require('./helpers.js');
const loaded=engine();
test('accepts typed arrays from another JavaScript realm, including nonzero-offset views',async()=>{
  const {api,assetBase}=await loaded;
  const data=await fixture();
  const foreign=require('node:vm').runInNewContext('const bytes=new Uint8Array(input.length+16);bytes.set(input,8);bytes.subarray(8,8+input.length)',{input:[...data]});
  assert.equal(foreign instanceof Uint8Array,false);
  assert.equal((await api.scan(foreign,assetBase)).pages,3);
  const updated=await api.writeOutline(foreign,[{title:'跨环境标题',level:1,page:1,y:80}],false);
  assert.equal((await api.inspectOutline(updated,assetBase)).headings[0].title,'跨环境标题');
});
test('PDF.js scans Chinese headings and excludes repeated text at the same height',async()=>{
  const {api,assetBase}=await loaded,result=await api.scan(await fixture(),assetBase);
  assert.equal(result.pages,3);assert.equal(result.context.body_font_size,10.5);
  assert.ok(result.headings.some(h=>h.title==='第一章 绪论'));
  assert.ok(result.headings.every(h=>h.title!=='一、研究背景'));
  assert.ok(result.headings.every(h=>!h.title.includes('Journal')));
  assert.ok(result.headings.every(h=>!h.title.includes('Figure')));
  assert.ok(result.headings[0].y>0&&result.headings[0].y<150);
  const extracted=await api.extractLines(await fixture(),assetBase);
  assert.equal(extracted.lines.find(l=>l.text.includes('Figure')).bold,true);
});
test('separates columns and rejects PDFs without text, signed or invalid PDFs',async()=>{
  const {api,assetBase}=await loaded,result=await api.scan(await fixture({columns:true}),assetBase);
  assert.ok(result.headings.some(h=>h.title.includes('左栏研究方法')&&!h.title.includes('右栏')));
  assert.ok(result.headings.some(h=>h.title.includes('右栏研究结果')&&!h.title.includes('左栏')));
  await assert.rejects(api.scan(await fixture({blank:true}),assetBase),/OCR/);
  await assert.rejects(api.scan(await fixture({signed:true}),assetBase),/数字签名/);
  await assert.rejects(api.scan(new Uint8Array([1,2,3]),assetBase),/无法读取/);
});
test('keeps a larger heading separate from opposite-column body on the same baseline',async()=>{
  const {api,assetBase}=await loaded,pdf=await PDFDocument.create();
  const font=await pdf.embedFont(require('pdf-lib').StandardFonts.Helvetica),page=pdf.addPage([595,842]);
  page.drawText('Body text on the left side.',{x:50,y:700,size:9.7,font});
  page.drawText('1 Related research',{x:260,y:701.5,size:11.2,font});
  for(let i=0;i<8;i++)page.drawText('Most text is body text at this font size.',{x:50,y:670-i*20,size:9.7,font});
  page.drawText('4.1 Conclusion',{x:50,y:450,size:9.7,font});
  page.drawText('Opposite-column body text.',{x:315,y:452.5,size:9.7,font});
  const result=await api.scan(await pdf.save(),assetBase);
  assert.equal(result.context.body_font_size,9.7);
  assert.deepEqual(Array.from(result.headings,h=>h.title),['1 Related research','4.1 Conclusion']);
  assert.equal(result.headings[0].font_size,11.2);
});
test('joins differently-sized decimal punctuation and body commas without losing heading text',async()=>{
  const {api,assetBase}=await loaded,pdf=await PDFDocument.create();
  const font=await pdf.embedFont(require('pdf-lib').StandardFonts.Helvetica),page=pdf.addPage([595,842]);
  let x=50;
  for(const [text,size] of [['2',14],['.',11],['2.1 Technical paths',14]]) {
    page.drawText(text,{x,y:700,size,font});
    x+=font.widthOfTextAtSize(text,size);
  }
  x=50;
  for(const [text,size] of [['Body text',12],[',',12.6],[' more body text.',12]]) {
    page.drawText(text,{x,y:660,size,font});
    x+=font.widthOfTextAtSize(text,size);
  }
  for(let i=0;i<10;i++) page.drawText('Ordinary body text determines the base font size.',{x:50,y:620-i*24,size:12,font});
  page.drawText('+',{x:50,y:330,size:16,font});
  page.drawText('42',{x:50,y:300,size:16,font});
  const data=await pdf.save();
  const extracted=await api.extractLines(data,assetBase);
  assert.ok(extracted.lines.some(l=>l.text==='2.2.1 Technical paths'&&l.fontSize===14));
  assert.ok(extracted.lines.some(l=>l.text==='Body text, more body text.'&&l.fontSize===12));
  const result=await api.scan(data,assetBase);
  assert.deepEqual(Array.from(result.headings,h=>h.title),['2.2.1 Technical paths']);
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

test('replaces the original PDF and removes temporary backup and staging files',async()=>{
  const {api,assetBase}=await loaded,directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-replace-'));
  try{
    const pdf=path.join(directory,'中文 论文.pdf'),original=await fixture();await fs.writeFile(pdf,original);
    const service=api.createService(fileIO(),{join:path.join,filename:path.basename},assetBase);
    const scanned=await service.run({action:'scan',pdf});
    const request={action:'apply',pdf,sha256:scanned.sha256,headings:scanned.headings};
    let checked=false;
    const result=await service.run(request,{beforeReplace:async()=>{
      const backup=(await fs.readdir(directory)).find(name=>name.endsWith('.bak'));
      assert.ok(backup);assert.deepEqual(await fs.readFile(path.join(directory,backup)),Buffer.from(original));checked=true;
    }});
    assert.ok(checked);assert.equal(result.output,pdf);
    const written=new Uint8Array(await fs.readFile(pdf));
    assert.equal(await api.sha256(written),result.sha256);
    assert.equal((await api.inspectOutline(written,assetBase)).headings.length,scanned.headings.length);
    assert.deepEqual(await fs.readdir(directory),['中文 论文.pdf']);
    await assert.rejects(service.run(request),/自预览后已变化/);
    const updated=await service.run({action:'scan',pdf});
    await service.run({...request,sha256:updated.sha256,overwrite:true});
    assert.deepEqual(await fs.readdir(directory),['中文 论文.pdf']);
    await fs.writeFile(pdf+'.rule-outline.lock','lock');await assert.rejects(service.run(request),/互斥锁/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('failed staging, replacement and permission checks preserve the original; failed sync rolls back',async()=>{
  const {api,assetBase}=await loaded,directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-replace-fail-'));
  try{
    const pdf=path.join(directory,'paper.pdf'),original=await fixture(),io=fileIO();
    const scanned=await api.scan(original,assetBase),request={action:'apply',pdf,sha256:scanned.sha256,headings:scanned.headings};
    for(const phase of ['backup','write','corrupt','move','source','permission','sync']) {
      await fs.writeFile(pdf,original);
      const simulated={...io,
        write:async(p,data,options)=>{
          if((phase==='backup'&&p.endsWith('.bak'))||(phase==='write'&&p.endsWith('.tmp'))){await io.write(p,new Uint8Array([1]),options);throw new Error('simulated write failure');}
          if(phase==='corrupt'&&p.endsWith('.tmp'))return io.write(p,new Uint8Array([1]),options);
          return io.write(p,data,options);
        },
        move:async(...args)=>{if(phase==='move')throw new Error('simulated move failure');return io.move(...args);},
      };
      const hooks={beforeReplace:async()=>{
        if(phase==='source')await fs.appendFile(pdf,'external');
        if(phase==='permission')throw new Error('simulated permission failure');
      },afterReplace:async()=>{if(phase==='sync')throw new Error('simulated sync failure');}};
      await assert.rejects(api.createService(simulated,{join:path.join,filename:path.basename},assetBase).run(request,hooks),/simulated|校验失败|已变化/);
      assert.deepEqual(await fs.readdir(directory),['paper.pdf']);
      assert.deepEqual(await fs.readFile(pdf),phase==='source'?Buffer.concat([Buffer.from(original),Buffer.from('external')]):Buffer.from(original));
    }
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('rollback failure retains a recoverable backup; external post-write changes are not overwritten',async()=>{
  const {api,assetBase}=await loaded,directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-rollback-'));
  try{
    const pdf=path.join(directory,'paper.pdf'),original=await fixture(),io=fileIO();
    const scanned=await api.scan(original,assetBase),request={action:'apply',pdf,sha256:scanned.sha256,headings:scanned.headings};
    for(const phase of ['restore','external']){
      await fs.writeFile(pdf,original);
      let moves=0;
      const simulated={...io,move:async(source,...args)=>{
        moves++;
        if(phase==='restore'&&moves===2)throw new Error('simulated restore failure');
        return io.move(source,...args);
      }};
      await assert.rejects(api.createService(simulated,{join:path.join,filename:path.basename},assetBase).run(request,{afterReplace:async()=>{
        if(phase==='external')await fs.writeFile(pdf,'external newer PDF');
        throw new Error('simulated sync failure');
      }}),/原件临时备份保留在/);
      const names=await fs.readdir(directory),backup=names.find(n=>n.endsWith('.bak'));
      assert.ok(backup);assert.equal(names.length,2);
      assert.deepEqual(await fs.readFile(path.join(directory,backup)),Buffer.from(original));
      if(phase==='external')assert.equal(await fs.readFile(pdf,'utf8'),'external newer PDF');
      await fs.unlink(path.join(directory,backup));
    }
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('an unreadable destination after replacement failure retains the original backup',async()=>{
  const {api,assetBase}=await loaded,directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-unreadable-'));
  try{
    const pdf=path.join(directory,'paper.pdf'),original=await fixture(),io=fileIO();await fs.writeFile(pdf,original);
    const scanned=await api.scan(original,assetBase);let attempted=false;
    const simulated={...io,move:async()=>{attempted=true;throw new Error('simulated replacement failure');},
      read:async p=>{if(attempted&&p===pdf)throw new Error('simulated read failure');return io.read(p);}};
    await assert.rejects(api.createService(simulated,{join:path.join,filename:path.basename},assetBase).run({action:'apply',pdf,sha256:scanned.sha256,headings:scanned.headings}),/原件临时备份保留在/);
    const backup=(await fs.readdir(directory)).find(n=>n.endsWith('.bak'));
    assert.ok(backup);assert.deepEqual(await fs.readFile(path.join(directory,backup)),Buffer.from(original));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
