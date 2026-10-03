const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {engine,fileIO,fixture,root}=require('./helpers.js');
async function loadPlugin({loadError}={}){
  const {api,assetBase}=await engine(),IOUtils=fileIO(),PathUtils={join:path.join,filename:path.basename};
  const loads=[],assetURLs=[];
  const Zotero={Reader:{_readers:[]},Libraries:{get:()=>({filesEditable:true})},logError:()=>{}};
  const scope={Zotero,IOUtils,PathUtils,rootURI:require('node:url').pathToFileURL(root+'/addon/').href,Services:{uuid:{generateUUID:()=>crypto.randomUUID()},
    scriptloader:{loadSubScriptWithOptions:(url,{target})=>{
      loads.push(url); if(loadError)throw loadError;
      target.RuleOutlineEngine={...api,createService:(io,paths,base,uuid)=>{
        assetURLs.push(base);return api.createService(io,paths,assetBase,uuid);
      }};
    }}}};
  vm.createContext(scope);vm.runInContext(await fs.readFile(root+'/addon/content/main.js','utf8'),scope);
  const plugin=scope.RuleOutline,win={document:{getElementById:()=>null}};plugin.addWindow(win);
  return {plugin,Zotero,win,loads,assetURLs};
}
test('plugin runs JavaScript without Python configuration or subprocesses',async()=>{
  const {plugin,loads,assetURLs}=await loadPlugin();assert.equal(plugin.configure,undefined);assert.equal(plugin.ensurePython,undefined);
  assert.deepEqual(loads,['chrome://rule-outline/content/engine.js']);
  assert.deepEqual(assetURLs,['chrome://rule-outline-vendor/content/']);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-plugin-'));
  try{
    const pdf=path.join(directory,'paper.pdf');await fs.writeFile(pdf,await fixture());
    assert.ok((await plugin.run({action:'scan',pdf})).headings.length);assert.equal(plugin.operations.size,0);
    assert.equal(loads.length,1);
    await plugin.shutdown();assert.equal(plugin.windows.size,0);await assert.rejects(plugin.run({action:'scan',pdf}),/插件已关闭/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('failed resource loads report reinstall/restart guidance and never use stale engine exports',async()=>{
  const {plugin,win}=await loadPlugin({loadError:'Error opening input stream (invalid filename?): jar:file:///missing.xpi!/content/engine.js'});
  assert.equal(plugin.services.size,0);
  await assert.rejects(plugin.run({action:'scan',pdf:'/missing.pdf'}),/重新安装.*完全退出 Zotero/);
  assert.ok(plugin.engineErrors.has(win));
  plugin.removeWindow(win);assert.equal(plugin.engineErrors.size,0);
});
test('rejects read-only attachments',async()=>{
  const {plugin,Zotero}=await loadPlugin(),item={id:42,isRegularItem:()=>false,isPDFAttachment:()=>true,isEditable:()=>false};
  await assert.rejects(plugin.selectedPDF({ZoteroPane:{getSelectedItems:()=>[item]}}),/不可编辑/);
});
test('preview registers a sibling linked attachment and opens it in Zotero',async()=>{
  const {plugin,Zotero,win}=await loadPlugin(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-preview-copy-'));
  try{
    const pdf=path.join(directory,'paper.pdf'),original=await fixture();await fs.writeFile(pdf,original);
    const item={id:42,parentID:17,libraryID:1,isRegularItem:()=>false,isPDFAttachment:()=>true,isEditable:()=>true,
      getFilePathAsync:async()=>pdf,getField:()=> 'paper',saveTx:async()=>{throw new Error('Original attachment must not change');}};
    Zotero.Reader._readers=[{itemID:42}];
    Zotero.Reader.open=async id=>{opened=id;};
    Zotero.ProgressWindow=class{changeHeadline(){}addDescription(){}show(){}close(){}};
    let opened,io,registered;
    Zotero.launchFile=()=>{throw new Error('Must use the Zotero reader');};
    Zotero.Attachments={linkFromFile:async options=>{registered=options;return {id:99};}};
    win.ZoteroPane={getSelectedItems:()=>[item]};
    win.openDialog=(url,name,options,args)=>{io=args;return {addEventListener(){},close(){}};};
    await plugin.generate(win);
    await assert.rejects(io.open(),/先生成/);
    const written=await io.apply(io.result.headings,false);
    await io.open();
    assert.equal(opened,99);
    assert.equal(written.attachmentID,99);
    assert.equal(registered.file,written.output);
    assert.equal(registered.parentItemID,17);
    assert.equal(registered.title,'带大纲版本');
    assert.equal(registered.contentType,'application/pdf');
    assert.equal(registered.collections,undefined);
    assert.equal(path.dirname(registered.file),directory);
    assert.notEqual(registered.file,pdf);
    assert.equal(item.attachmentSyncState,undefined);
    assert.deepEqual(await fs.readFile(pdf),Buffer.from(original));
    assert.equal(plugin.restore,undefined);
    assert.equal(plugin.backupDirectory,undefined);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('standalone PDF keeps its collections; failed linking can retry without regenerating or duplicating',async()=>{
  const {plugin,Zotero,win}=await loadPlugin(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-link-retry-'));
  try{
    const pdf=path.join(directory,'paper.pdf'),original=await fixture();await fs.writeFile(pdf,original);
    const item={id:42,libraryID:1,isRegularItem:()=>false,isPDFAttachment:()=>true,isEditable:()=>true,
      getFilePathAsync:async()=>pdf,getField:()=> 'paper',getCollections:()=>[5,6]};
    Zotero.ProgressWindow=class{changeHeadline(){}addDescription(){}show(){}close(){}};
    let io,calls=0,registered;
    Zotero.Attachments={linkFromFile:async options=>{
      calls++;registered=options;
      if(calls===1)throw new Error('simulated attachment failure');
      await Promise.resolve();
      return {id:88};
    }};
    const opened=[];Zotero.Reader.open=async id=>opened.push(id);
    win.ZoteroPane={getSelectedItems:()=>[item]};
    win.openDialog=(url,name,options,args)=>{io=args;return {addEventListener(){},close(){}};};
    await plugin.generate(win);
    const written=await io.apply(io.result.headings,false);
    assert.match(written.warning,/副本已保存.*链接附件失败/);
    assert.ok(await fs.stat(written.output));
    assert.deepEqual(await fs.readFile(pdf),Buffer.from(original));
    await Promise.all([io.open(),io.open()]);
    assert.equal(calls,2);
    assert.equal(registered.file,written.output);
    assert.equal(registered.parentItemID,undefined);
    assert.deepEqual(Array.from(registered.collections),[5,6]);
    assert.deepEqual(opened,[88,88]);
    assert.equal((await fs.readdir(directory)).length,2);
    assert.equal(plugin.operations.size,0);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('group libraries reject linking before generating a copy',async()=>{
  const {plugin,Zotero}=await loadPlugin();
  Zotero.Libraries.get=()=>({filesEditable:true,libraryType:'group'});
  const item={id:42,libraryID:2,isRegularItem:()=>false,isPDFAttachment:()=>true,isEditable:()=>true,
    getFilePathAsync:async()=>{throw new Error('Should reject before accessing files');}};
  await assert.rejects(plugin.selectedPDF({ZoteroPane:{getSelectedItems:()=>[item]}}),/群组文献库不支持/);
});
