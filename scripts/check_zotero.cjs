/* Isolated desktop runtime probe. Never uses the user's profile or library. */
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {zipSync,strToU8}=require('fflate');
const {pathToFileURL}=require('node:url');
const {fixture,root}=require('../tests/helpers.js');
(async()=>{
  const executable=process.env.ZOTERO_EXECUTABLE;
  if(!executable)throw new Error('Set ZOTERO_EXECUTABLE to a Zotero 10 executable.');
  const profile=path.join(root,'.qa-zotero-runtime'),data=path.join(profile,'data'),report=path.join(profile,'report.json');
  await fs.mkdir(path.join(profile,'extensions'),{recursive:true});await fs.mkdir(data,{recursive:true});
  await fs.rm(report,{force:true});
  await fs.writeFile(path.join(profile,'paper.pdf'),await fixture());
  const manifest=JSON.parse(await fs.readFile(path.join(root,'addon/manifest.json'),'utf8'));
  const xpi=path.join(root,'dist',`zotero-rule-outline-${manifest.version}.xpi`);
  const prefs={
    'extensions.zotero.dataDir':data,'extensions.zotero.useDataDir':true,'extensions.zotero.firstRun2':false,
    'extensions.autoDisableScopes':0,'extensions.enabledScopes':15,'extensions.update.enabled':false,
    'app.update.enabled':false,'extensions.zotero.automaticScraperUpdates':false,'extensions.zotero.sync.autoSync':false,
    'browser.shell.checkDefaultBrowser':false,'browser.aboutwelcome.enabled':false,
  };
  await fs.writeFile(path.join(profile,'user.js'),Object.entries(prefs).map(([k,v])=>`user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  const bootstrap=`var chromeHandle;
async function startup(){
  const result={};
  try{
    await Zotero.initializationPromise;
    const uri=Services.io.newURI(${JSON.stringify('jar:'+pathToFileURL(xpi).href+'!/manifest.json')});
    const manager=Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup);
    chromeHandle=manager.registerChrome(uri,[['content','rule-outline-probe','content/'],['content','rule-outline-probe-vendor','vendor/']]);
    const host=Zotero.getMainWindows()[0];
    if(!host)throw new Error('Zotero main window is not available');
    for(const url of [${JSON.stringify('jar:'+pathToFileURL(xpi).href+'!/content/engine.js')},'chrome://rule-outline-probe/content/engine.js']){
      try{Services.scriptloader.loadSubScriptWithOptions(url,{target:host,ignoreCache:true});result[url]='loaded';}
      catch(e){result[url]=String(e);}
    }
    if(!host.RuleOutlineEngine)throw new Error('Engine export missing');
    const pluginScope={Zotero,Services,ChromeUtils,Cc,Ci,IOUtils,PathUtils};
    Services.scriptloader.loadSubScriptWithOptions(${JSON.stringify('jar:'+pathToFileURL(xpi).href+'!/bootstrap.js')},{target:pluginScope,ignoreCache:true});
    await pluginScope.startup({rootURI:${JSON.stringify('jar:'+pathToFileURL(xpi).href+'!/') }});
    const service=pluginScope.RuleOutline;
    result.menu=!!host.document.getElementById('rule-outline-generate');
    if(!result.menu)throw new Error('Plugin menu not registered');
    const before=await IOUtils.read(${JSON.stringify(path.join(profile,'paper.pdf'))});
    const scan=await service.run({action:'scan',pdf:${JSON.stringify(path.join(profile,'paper.pdf'))}});
    result.pages=scan.pages;result.titles=scan.headings.map(h=>h.title);
    const written=await service.run({action:'apply',pdf:${JSON.stringify(path.join(profile,'paper.pdf'))},sha256:scan.sha256,headings:scan.headings});
    result.written=written.count;
    const copy=await IOUtils.read(written.output);
    const inspected=await host.RuleOutlineEngine.inspectOutline(copy,'chrome://rule-outline-probe-vendor/content/');
    if(inspected.headings.length!==written.count)throw new Error('Copy outline differs');
    result.output=written.output;
    const after=await IOUtils.read(${JSON.stringify(path.join(profile,'paper.pdf'))});
    if(before.length!==after.length || before.some((value,index)=>value!==after[index]))throw new Error('Source PDF changed');
    result.sourceUnchanged=true;
    await pluginScope.shutdown();
    result.menuRemoved=!host.document.getElementById('rule-outline-generate');
    result.ok=true;
  }catch(e){result.error=String(e);result.stack=e.stack;result.ok=false;}
  await IOUtils.writeJSON(${JSON.stringify(report)},result);
  chromeHandle?.destruct();
  Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
}
function shutdown(){} function install(){} function uninstall(){}`;
  const probe={...manifest,name:'Rule Outline Runtime Probe',version:'1.0.0',applications:{zotero:{...manifest.applications.zotero,id:'rule-outline-probe@local.zotero'}}};
  const files={'manifest.json':strToU8(JSON.stringify(probe)),'bootstrap.js':strToU8(bootstrap)};
  await fs.writeFile(path.join(profile,'extensions','rule-outline-probe@local.zotero.xpi'),zipSync(files));
  const child=spawn(executable,['-no-remote','-new-instance','-profile',profile,'-purgecaches','-ZoteroDebugText'],{
    env:{...process.env,MOZ_HEADLESS:'1',MOZ_NO_REMOTE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  const log=await fs.open(path.join(profile,'runtime.log'),'w');
  child.stdout.on('data',chunk=>log.write(chunk));child.stderr.on('data',chunk=>log.write(chunk));
  const timeout=setTimeout(()=>child.kill(),90000);
  await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
  clearTimeout(timeout);await log.close();
  const result=JSON.parse(await fs.readFile(report,'utf8'));
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
