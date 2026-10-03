import {build} from 'esbuild';
import {zipSync, strToU8} from 'fflate';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const addon=path.join(root,'addon');
await build({entryPoints:[path.join(root,'src/engine.ts')],bundle:true,format:'iife',globalName:'RuleOutlineEngine',
  platform:'browser',target:'firefox140',minify:true,legalComments:'eof',
  outfile:path.join(addon,'content/engine.js'),external:['node:*'],define:{'process':'undefined'},
  plugins:[{name:'text-font-metadata',setup(builder){
    builder.onLoad({filter:/pdf\.worker\.mjs$/},async({path:filename})=>{
      const source=await fs.readFile(filename,'utf8');
      const marker='fontFamily: font.fallbackName,';
      if(source.split(marker).length!==2) throw new Error('PDF.js text style schema changed');
      return {contents:source.replace(marker,marker+'\n          fontName: font.name, bold: !!(font.bold || font.black), italic: !!font.italic,'),loader:'js'};
    });
  }}]});
await fs.mkdir(path.join(addon,'vendor'),{recursive:true});
for (const folder of ['cmaps','standard_fonts']) {
  await fs.cp(path.join(root,'node_modules/pdfjs-dist',folder),path.join(addon,'vendor',folder),{recursive:true});
}
for (const [pkg,name] of [['pdfjs-dist','PDFjs-LICENSE'],['pdf-lib','pdf-lib-LICENSE'],
  ['pako','pako-LICENSE'],['@pdf-lib/standard-fonts','standard-fonts-LICENSE'],['@pdf-lib/upng','upng-LICENSE'],['tslib','tslib-LICENSE']]) {
  const directory=path.join(root,'node_modules',pkg);
  const names=await fs.readdir(directory);
  const license=names.find(n=>/^licen[sc]e(?:\.txt|\.md)?$/i.test(n));
  if (license) await fs.copyFile(path.join(directory,license),path.join(addon,'vendor',name));
}
const manifest=JSON.parse(await fs.readFile(path.join(addon,'manifest.json'),'utf8'));
const app=manifest.applications.zotero;
if (app.strict_min_version!=='10.0' || app.strict_max_version!=='10.0.*' || !app.id || !app.update_url) throw new Error('Invalid Zotero 10 manifest');
const files={};
async function collect(directory,prefix='') {
  for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
    const name=prefix+entry.name;
    if (entry.isDirectory()) await collect(path.join(directory,entry.name),name+'/');
    else {
      if (/\.(?:py|whl|zip|pyc)$/.test(name) || name.includes('__pycache__')) throw new Error('Unexpected legacy dependency in XPI: '+name);
      files[name]=[new Uint8Array(await fs.readFile(path.join(directory,entry.name))),{mtime:new Date('2026-01-01T00:00:00Z')}];
    }
  }
}
await collect(addon);
files['LICENSE']=[strToU8(await fs.readFile(path.join(root,'LICENSE'),'utf8')),{mtime:new Date('2026-01-01T00:00:00Z')}];
await fs.mkdir(path.join(root,'dist'),{recursive:true});
const xpi=zipSync(files,{level:9});
const filename=`zotero-rule-outline-${manifest.version}.xpi`;
await fs.writeFile(path.join(root,'dist',filename),xpi);
console.log(`${filename}: ${xpi.length} bytes; sha256=${createHash('sha256').update(xpi).digest('hex')}`);
