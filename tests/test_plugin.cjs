const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {engine,fileIO,fixture,root}=require('./helpers.js');
async function loadPlugin({loadError}={}){
  const {api,assetBase}=await engine(),IOUtils=fileIO(),PathUtils={join:path.join,filename:path.basename};
  const loads=[],assetURLs=[];
  const Zotero={Reader:{_readers:[]},Promise:{delay:ms=>new Promise(resolve=>setTimeout(resolve,ms))},Sync:{Runner:{syncInProgress:false,delayIndefinite:()=>()=>{},setSyncTimeout(){}},Storage:{Local:{SYNC_STATE_TO_UPLOAD:0}}},Libraries:{get:()=>({filesEditable:true})},logError:()=>{}};
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

async function preview(plugin,Zotero,win,pdf,{stored=true}={}){
  const item={id:42,key:'SAMEKEY',parentID:17,libraryID:1,attachmentSyncState:2,
    isRegularItem:()=>false,isPDFAttachment:()=>true,isEditable:()=>true,isStoredFileAttachment:()=>stored,
    getFilePathAsync:async()=>pdf,getField:()=> 'paper',saveTx:async()=>{}};
  Zotero.ProgressWindow=class{changeHeadline(){}addDescription(){}show(){}close(){}};
  Zotero.Attachments={linkFromFile:()=>{throw new Error('Must not add an attachment');}};
  win.ZoteroPane={getSelectedItems:()=>[item]};let io;
  win.openDialog=(url,name,options,args)=>{io=args;return {addEventListener(){},close(){}};};
  await plugin.generate(win);return {io,item};
}
function mockReader(Zotero,events,{failSave=false}={}){
  const state={pageIndex:1,top:120,left:10,scale:'page-width'};
  const manager={_unsavedAnnotations:new Map([['annotation',{comment:'latest'}]]),_savingInProgress:false,
    _triggerSaving:async()=>{
      events.push('saving');manager._savingInProgress=true;
      await new Promise(resolve=>setTimeout(resolve,5));
      if(failSave){manager._savingInProgress=false;throw new Error('simulated annotation save failure');}
      manager._unsavedAnnotations.clear();manager._savingInProgress=false;events.push('saved');
    }};
  const reader={itemID:42,tabID:'tab',_internalReader:{_annotationManager:manager,_state:{},freeze:()=>events.push('freeze'),unfreeze:()=>events.push('unfreeze')},
    _flushState:async()=>events.push('state'),_getState:async()=>state,getSecondViewState:()=>({pageIndex:2}),
    close:()=>{events.push('close');Zotero.Reader._readers=[];}};
  Zotero.Reader._readers=[reader];return reader;
}

test('keeps original attachment, waits for annotations, closes and restores reader, queues file sync',async()=>{
  const {plugin,Zotero,win}=await loadPlugin(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-preview-original-'));
  try{
    const pdf=path.join(directory,'paper.pdf'),original=await fixture();await fs.writeFile(pdf,original);
    const events=[],reader=mockReader(Zotero,events),opened=[];
    Zotero.Reader.open=async(id,state,options)=>{events.push('open');opened.push({id,state,options});};
    const {io,item}=await preview(plugin,Zotero,win,pdf);
    item.saveTx=async()=>{events.push('sync');assert.equal(Zotero.Reader._readers.length,0);assert.equal(reader._internalReader._annotationManager._unsavedAnnotations.size,0);};
    Zotero.Sync.Runner.setSyncTimeout=()=>events.push('schedule');
    await assert.rejects(io.open(),/先写入/);
    const written=await io.apply(io.result.headings,false);
    assert.equal(written.attachmentID,42);assert.equal(written.output,pdf);
    assert.equal(item.key,'SAMEKEY');assert.equal(item.parentID,17);assert.equal(item.attachmentSyncState,0);
    assert.deepEqual(events,['freeze','saving','saved','state','close','sync','open','schedule']);
    assert.equal(opened[0].id,42);assert.equal(opened[0].state.pageIndex,1);assert.equal(opened[0].state.top,120);
    assert.equal(opened[0].options.openInWindow,false);assert.equal(opened[0].options.secondViewState.pageIndex,2);
    assert.notDeepEqual(await fs.readFile(pdf),Buffer.from(original));assert.deepEqual(await fs.readdir(directory),['paper.pdf']);
    await io.open();assert.equal(opened[1].id,42);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('linked files keep their original type without being marked for Zotero file sync',async()=>{
  const {plugin,Zotero,win}=await loadPlugin(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-linked-'));
  try{
    const pdf=path.join(directory,'paper.pdf');await fs.writeFile(pdf,await fixture());
    Zotero.Reader.open=async()=>{};
    const {io,item}=await preview(plugin,Zotero,win,pdf,{stored:false});
    item.saveTx=async()=>{throw new Error('Linked file must not be queued for sync');};
    await io.apply(io.result.headings,false);assert.equal(item.attachmentSyncState,2);
    assert.deepEqual(await fs.readdir(directory),['paper.pdf']);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('failed annotation saving stops before replacing the PDF and leaves the reader usable',async()=>{
  const {plugin,Zotero,win}=await loadPlugin(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-save-fail-'));
  try{
    const pdf=path.join(directory,'paper.pdf'),original=await fixture();await fs.writeFile(pdf,original);
    const events=[];mockReader(Zotero,events,{failSave:true});
    const {io}=await preview(plugin,Zotero,win,pdf);
    await assert.rejects(io.apply(io.result.headings,false),/simulated annotation save failure/);
    assert.ok(events.includes('unfreeze'));assert.ok(!events.includes('close'));
    assert.deepEqual(await fs.readFile(pdf),Buffer.from(original));assert.equal(plugin.busy,false);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('sync state save failures restore original PDF and reopen the original reader',async()=>{
  const {plugin,Zotero,win}=await loadPlugin(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-sync-fail-'));
  try{
    const pdf=path.join(directory,'paper.pdf'),original=await fixture();await fs.writeFile(pdf,original);
    const events=[];mockReader(Zotero,events);Zotero.Reader.open=async id=>{assert.equal(id,42);events.push('open');};
    const {io,item}=await preview(plugin,Zotero,win,pdf);item.saveTx=async()=>{throw new Error('simulated sync failure');};
    await assert.rejects(io.apply(io.result.headings,false),/simulated sync failure/);
    assert.equal(item.attachmentSyncState,2);assert.ok(events.includes('open'));
    assert.deepEqual(await fs.readFile(pdf),Buffer.from(original));assert.deepEqual(await fs.readdir(directory),['paper.pdf']);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('permission changes and a new reader during staging abort replacement',async()=>{
  for(const phase of ['permission','reader','sync']){
    const {plugin,Zotero,win}=await loadPlugin(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-guard-'));
    try{
      const pdf=path.join(directory,'paper.pdf'),original=await fixture();await fs.writeFile(pdf,original);
      const {io,item}=await preview(plugin,Zotero,win,pdf);
      const write=plugin.IO.write;
      plugin.IO.write=async(p,...args)=>{
        const result=await write(p,...args);
        if(p.endsWith('.tmp')){
          if(phase==='permission')item.isEditable=()=>false;
          if(phase==='reader')Zotero.Reader._readers=[{itemID:42}];
          if(phase==='sync')Zotero.Sync.Runner.syncInProgress=true;
        }
        return result;
      };
      await assert.rejects(io.apply(io.result.headings,false),/权限或路径|重新打开|正在同步/);
      assert.deepEqual(await fs.readFile(pdf),Buffer.from(original));assert.deepEqual(await fs.readdir(directory),['paper.pdf']);
    }finally{await fs.rm(directory,{recursive:true,force:true});}
  }
});

test('reader reopen failure warns after a successful write without undoing the new outline',async()=>{
  const {plugin,Zotero,win}=await loadPlugin(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'rule-reopen-fail-'));
  try{
    const pdf=path.join(directory,'paper.pdf');await fs.writeFile(pdf,await fixture());mockReader(Zotero,[]);
    Zotero.Reader.open=async()=>{throw new Error('simulated reader failure');};
    const {io}=await preview(plugin,Zotero,win,pdf);const written=await io.apply(io.result.headings,false);
    assert.match(written.warning,/阅读器恢复失败/);assert.deepEqual(await fs.readdir(directory),['paper.pdf']);
    assert.ok((await plugin.run({action:'scan',pdf})).existing_outline.length>0);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
