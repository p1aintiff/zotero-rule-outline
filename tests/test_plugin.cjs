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
test('rejects read-only attachments and PDFs open in readers',async()=>{
  const {plugin,Zotero}=await loadPlugin(),item={id:42,isRegularItem:()=>false,isPDFAttachment:()=>true,isEditable:()=>false};
  await assert.rejects(plugin.selectedPDF({ZoteroPane:{getSelectedItems:()=>[item]}}),/不可编辑/);
  Zotero.Reader._readers=[{itemID:42}];assert.throws(()=>plugin.assertClosed(item),/先关闭/);
  Zotero.Reader._readers=[{itemID:42,_isTabClosed:true}];assert.doesNotThrow(()=>plugin.assertClosed(item));
});
test('sync updates imported attachments only',async()=>{
  const {plugin,Zotero}=await loadPlugin();let saved=0,notified=0;Zotero.Notifier={trigger:async()=>notified++};
  const item={id:1,isImportedAttachment:()=>true,saveTx:async()=>saved++};await plugin.syncChanged(item);
  assert.equal(item.attachmentSyncState,'to_upload');assert.equal(saved,1);item.isImportedAttachment=()=>false;
  await plugin.syncChanged(item);assert.equal(saved,1);assert.equal(notified,2);
});
