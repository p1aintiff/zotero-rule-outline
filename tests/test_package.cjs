const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {unzipSync}=require('fflate');
const {root}=require('./helpers.js');
test('XPI is lightweight, self-contained JavaScript and targets Zotero 10',async()=>{
  const current=JSON.parse(await fs.readFile(path.join(root,'addon/manifest.json'),'utf8'));
  const bytes=await fs.readFile(path.join(root,`dist/zotero-rule-outline-${current.version}.xpi`));
  assert.ok(bytes.length<5*1024*1024);
  const entries=unzipSync(bytes),names=Object.keys(entries);
  for(const name of ['bootstrap.js','content/engine.js','vendor/PDFjs-LICENSE','vendor/pdf-lib-LICENSE','LICENSE']) assert.ok(entries[name],name);
  assert.ok(names.some(n=>n.startsWith('vendor/cmaps/')));assert.ok(names.some(n=>n.startsWith('vendor/standard_fonts/')));
  assert.ok(names.every(n=>!/^helper\//.test(n)&&!/(?:\.py|\.pyc|\.whl|\.zip)$/.test(n)));
  const manifest=JSON.parse(new TextDecoder().decode(entries['manifest.json']));
  assert.equal(manifest.version,current.version);assert.equal(manifest.applications.zotero.strict_min_version,'10.0');
  const source=await fs.readFile(root+'/addon/content/main.js','utf8');
  assert.ok(!/Python|Subprocess|ensurePython|configure\(/.test(source));
});
