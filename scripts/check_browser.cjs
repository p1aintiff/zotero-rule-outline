/* Optional real-browser engine and preview check; Playwright is development-only. */
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture,root}=require('../tests/helpers.js');
(async()=>{
  const bytes=await fixture();
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.url==='/paper.pdf'){res.setHeader('Content-Type','application/pdf');res.end(Buffer.from(bytes));return;}
      if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script src="/addon/content/engine.js"></script>');return;}
      const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
      if(!file.startsWith(root+path.sep)) throw new Error('Invalid path');
      res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.xhtml')?'application/xhtml+xml':file.endsWith('.css')?'text/css':'application/octet-stream');
      res.end(await fs.readFile(file));
    }catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
    const base=`http://127.0.0.1:${server.address().port}`,page=await browser.newPage();
    const errors=[],remote=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(!r.url().startsWith(base))remote.push(r.url());});
    await page.goto(base);
    const result=await page.evaluate(async()=>{
      const data=new Uint8Array(await (await fetch('/paper.pdf')).arrayBuffer()),engine=window.RuleOutlineEngine;
      const result=await engine.scan(data,7,location.origin+'/addon/vendor/');
      const updated=await engine.writeOutline(data,result.headings,false);
      const check=await engine.inspectOutline(updated,location.origin+'/addon/vendor/');
      if(check.headings.length!==result.headings.length)throw new Error('Outline roundtrip mismatch');
      return result;
    });
    assert.ok(result.headings.some(h=>h.title==='第一章 绪论'));
    const ui=await browser.newPage();ui.on('pageerror',e=>errors.push(e.message));
    await ui.addInitScript(result=>{
      window.arguments=[{name:'中文测试论文',result,apply:async(headings,overwrite)=>{
        window.lastApplied={headings,overwrite};return {count:headings.length,backup:'测试备份.pdf'};
      },open:async()=>{window.opened=true;}}];
    },result);
    await ui.goto(base+'/addon/content/preview.xhtml');await ui.waitForSelector('#rows tr');
    assert.equal(await ui.locator('#rows tr').count(),result.headings.length);
    await ui.locator('#none').click();assert.ok(await ui.locator('#write').isDisabled());
    await ui.locator('#all').click();await ui.locator('#rows input.title').first().fill('第一章 编辑后的绪论');
    await ui.locator('#write').click();await ui.waitForSelector('#status.success');
    assert.equal(await ui.evaluate(()=>window.lastApplied.headings[0].title),'第一章 编辑后的绪论');
    await ui.locator('#open').click();assert.ok(await ui.evaluate(()=>window.opened));
    assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
    console.log('Browser passed: Chinese extraction, outline roundtrip, packaged assets only, preview selection/edit/write/open.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
