const vm=require('node:vm'),fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL,fileURLToPath}=require('node:url');
const crypto=require('node:crypto');
const {PDFDocument,StandardFonts,PDFName,PDFString}=require('pdf-lib');
const root=path.resolve(__dirname,'..');
async function engine() {
  class XHR {
    static DONE=4;
    open(method,url) { this.url=url; }
    send() { fs.readFile(fileURLToPath(this.url)).then(data=>{
      this.response=new Uint8Array(data).buffer;this.status=0;this.readyState=4;this.onreadystatechange?.();
    },()=>{this.status=404;this.readyState=4;this.onreadystatechange?.();}); }
  }
  const scope={console,URL,URLSearchParams,DOMException,Blob,Headers,Response,Request,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,Promise,Map,Set,
    setTimeout,clearTimeout,structuredClone,AbortController,AbortSignal,ReadableStream,fetch,crypto:crypto.webcrypto,XMLHttpRequest:XHR,
    DOMMatrix:class {},navigator:{platform:'Win32',userAgent:'Mozilla Firefox'},
    document:{baseURI:pathToFileURL(root+'/addon/').href}};
  scope.window=scope;vm.createContext(scope);
  try { vm.runInContext(await fs.readFile(root+'/addon/content/engine.js','utf8'),scope); }
  catch(error) { throw new Error(error.message+'\n'+error.stack.split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,5).join('\n')); }
  return {api:scope.RuleOutlineEngine,scope,assetBase:pathToFileURL(root+'/addon/vendor/').href};
}
function fileIO() {
  return {
    read:async p=>new Uint8Array(await fs.readFile(p)),
    readJSON:async p=>JSON.parse(await fs.readFile(p,'utf8')),
    exists:async p=>{try{await fs.stat(p);return true;}catch{return false;}},
    write:async(p,data,options={})=>{
      if(options.tmpPath){await fs.writeFile(options.tmpPath,data);await fs.rename(options.tmpPath,p);}
      else await fs.writeFile(p,data,{flag:options.mode==='create'?'wx':'w'});
    },
    makeDirectory:(p,options={})=>fs.mkdir(p,{recursive:true,mode:options.permissions}),
    move:async(source,destination,options={})=>{
      if(options.noOverwrite) {await fs.copyFile(source,destination,require('node:fs').constants.COPYFILE_EXCL);await fs.unlink(source);}
      else await fs.rename(source,destination);
    },
    remove:(p,options={})=>fs.rm(p,{force:!!options.ignoreAbsent,recursive:!!options.recursive}),
  };
}
async function fixture({columns=false,blank=false,signed=false,rotated=false}={}) {
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),c=pdf.context;
  const descriptor=c.register(c.obj({Type:'FontDescriptor',FontName:'STSong-Light',Flags:6,
    FontBBox:[0,-200,1000,900],ItalicAngle:0,Ascent:880,Descent:-120,CapHeight:880,StemV:80}));
  const descendant=c.register(c.obj({Type:'Font',Subtype:'CIDFontType0',BaseFont:'STSong-Light',
    CIDSystemInfo:{Registry:PDFString.of('Adobe'),Ordering:PDFString.of('GB1'),Supplement:4},FontDescriptor:descriptor,DW:1000}));
  const chinese=c.register(c.obj({Type:'Font',Subtype:'Type0',BaseFont:'STSong-Light',Encoding:'UniGB-UCS2-H',DescendantFonts:[descendant]}));
  for(let p=0;p<3;p++) {
    const page=pdf.addPage([595,842]);
    if(rotated){page.setRotation(require('pdf-lib').degrees(90));page.setCropBox(20,30,550,780);}
    if(blank) continue;
    page.node.setFontDictionary(PDFName.of('FCN'),chinese);
    const cn=(text,x,y,size)=>{
      const hex=[...text].map(ch=>ch.charCodeAt(0).toString(16).padStart(4,'0')).join('');
      page.node.addContentStream(c.register(c.flateStream(`BT /FCN ${size} Tf 1 0 0 1 ${x} ${y} Tm <${hex}> Tj ET`)));
    };
    page.drawText('Journal 2026',{x:50,y:815,size:9,font});page.drawText(String(p+1),{x:290,y:22,size:9,font});
    cn(['第一章 绪论','第二章 研究设计','第三章 结论'][p],50,745,16);
    if(columns){
      cn(`${p+1}.1 左栏研究方法`,50,700,14);cn(`${p+1}.2 右栏研究结果`,315,700,14);
      for(let i=0;i<12;i++){cn('本文分析样本的影响因素。',50,665-i*25,10.5);cn('结果表明指标具有差异。',315,665-i*25,10.5);}
    }else{
      cn('一、研究背景',50,690,14);cn('（一）现实背景',50,640,12);cn('1. 数据来源',50,595,11.5);
      for(let i=0;i<14;i++) cn('本文讨论治理中的基本问题，并从理论与实践两个方面展开分析。',50,555-i*23,10.5);
      page.drawText('Figure 1 Research Framework',{x:50,y:180,size:14,font:bold});
    }
  }
  if(signed) pdf.catalog.set(PDFName.of('TestSignature'),c.register(c.obj({Type:'Sig',ByteRange:[0,1,2,3]})));
  return pdf.save({useObjectStreams:false});
}
module.exports={engine,fileIO,fixture,root};
