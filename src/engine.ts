import {WorkerMessageHandler} from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {scanPdfHeadings} from './index.js';
import {openPDF, assertUnsigned, writeOutline} from './pdf.js';
import type {OutlineHeading} from './types.js';
export {extractLines} from './extract.js';
export {inferHierarchy} from './hierarchy.js';
export {detectBodyFontSize, detectHeadings} from './scanner.js';
export {readingOrder} from './layout.js';
export {filterPageMargins} from './margins.js';
export {writeOutline, openPDF, validateHeadings} from './pdf.js';

// Preloaded PDF.js worker handler avoids remote imports and Worker/JAR URL issues.
(globalThis as typeof globalThis & {pdfjsWorker: unknown}).pdfjsWorker = {WorkerMessageHandler};

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

export async function scan(data: Uint8Array, assetBase='') {
  const doc = await openPDF(data);
  assertUnsigned(doc);
  const result = await scanPdfHeadings(data, assetBase);
  return {pages: result.pageCount, sha256: await sha256(data), existing_outline: result.existingOutline,
    context: {body_font_size: result.bodyFontSize},
    headings: result.headings.map(h => ({...h, title:h.text, font_size:h.fontSize,
      y: Math.max(0, result.lines.find(l => l.page===h.page)?.pageHeight! - h.y - h.fontSize)})),
    warnings: result.headings.length ? [] : ['没有大字号文字或符合单行短文本条件的数字编号标题，未生成候选。']};
}

export async function inspectOutline(data: Uint8Array, assetBase='') {
  const task = getDocument({data:new Uint8Array(data), cMapUrl:assetBase+'cmaps/', cMapPacked:true,
    standardFontDataUrl:assetBase+'standard_fonts/', useWorkerFetch:false, isEvalSupported:false,
    disableFontFace:true, useWasm:false});
  try {
    const pdf = await task.promise;
    const flat: {title:string;level:number;page:number;y:number|null;x:number|null}[]=[];
    const walk = async (items: Awaited<ReturnType<typeof pdf.getOutline>>, level:number): Promise<void> => {
      for (const item of items || []) {
        const dest = typeof item.dest==='string' ? await pdf.getDestination(item.dest) : item.dest;
        if (!dest) throw new Error('书签跳转目标无效。');
        const page = typeof dest[0]==='number' ? dest[0] : await pdf.getPageIndex(dest[0]);
        flat.push({title:item.title,level,page:page+1,x:dest[2],y:dest[3]});
        await walk(item.items, level+1);
      }
    };
    await walk(await pdf.getOutline(), 1);
    return {pages:pdf.numPages, headings:flat};
  } finally { await task.destroy(); }
}

export interface FileAccess {
  read(path:string): Promise<Uint8Array>;
  exists(path:string): Promise<boolean>;
  write(path:string, bytes:Uint8Array, options?:{mode?:string;tmpPath?:string;flush?:boolean}): Promise<unknown>;
  move(source:string, destination:string, options?:{noOverwrite?:boolean}): Promise<unknown>;
  remove(path:string, options?:{ignoreAbsent?:boolean}): Promise<unknown>;
}
export interface Paths {join(...parts:string[]):string; filename(path:string):string}
export interface Request {action:string;pdf:string;sha256?:string;headings?:OutlineHeading[];overwrite?:boolean}

export function createService(IO:FileAccess, Path:Paths, assetBase='', uuid=()=>crypto.randomUUID()) {
  const unchanged = async (path:string, hash:string, message:string) => {
    if (await sha256(await IO.read(path))!==hash) throw new Error(message);
  };
  const locked = async <T>(path:string, fn:()=>Promise<T>):Promise<T> => {
    const lock=path+'.rule-outline.lock';
    try { await IO.write(lock,new TextEncoder().encode(uuid()),{mode:'create'}); }
    catch { throw new Error('PDF 正在被另一项任务处理，或无法创建互斥锁。若上次异常退出，请核对后移除 .rule-outline.lock 文件。'); }
    try { return await fn(); }
    finally { await IO.remove(lock,{ignoreAbsent:true}); }
  };
  const apply = (request:Request) => locked(request.pdf,async()=>{
    const original=await IO.read(request.pdf), before=await sha256(original);
    if (before!==request.sha256) throw new Error('PDF 自预览后已变化，请重新生成。');
    const headings=request.headings!;
    const rewritten=await writeOutline(original,headings,request.overwrite===true);
    const verified=await inspectOutline(rewritten,assetBase);
    const originalDoc=await openPDF(original);
    if (verified.pages!==originalDoc.getPageCount() || verified.headings.length!==headings.length ||
      verified.headings.some((h,i)=>h.title!==headings[i].title.trim() || h.level!==headings[i].level || h.page!==headings[i].page)) {
      throw new Error('书签写入验证失败，原文件未修改。');
    }
    await unchanged(request.pdf,before,'写入前 PDF 已变化，操作取消。');
    const after=await sha256(rewritten);
    const filename=Path.filename(request.pdf);
    const directory=request.pdf.slice(0,request.pdf.length-filename.length);
    const stem=filename.replace(/\.pdf$/i,'');
    const tmpPath=Path.join(directory,stem+'.rule-outline-'+uuid()+'.tmp');
    let created=false;
    try {
      // Copy the source into a private sibling file, then write only to that copy.
      await IO.write(tmpPath,original,{mode:'create',flush:true});
      created=true;
      await unchanged(tmpPath,before,'副本校验失败，原文件未修改。');
      await IO.write(tmpPath,rewritten,{flush:true});
      await unchanged(tmpPath,after,'新文件校验失败，原文件未修改。');
      for(let index=1;index<=1000;index++) {
        const output=Path.join(directory,stem+'-大纲'+(index===1?'':`-${index}`)+'.pdf');
        if(await IO.exists(output)) continue;
        await unchanged(request.pdf,before,'生成副本前 PDF 已变化，操作取消。');
        try { await IO.move(tmpPath,output,{noOverwrite:true}); }
        catch(error) {
          // Another process may create the destination after the existence check.
          if(await IO.exists(output)) continue;
          throw error;
        }
        return {count:headings.length,output,sha256:after};
      }
      throw new Error('同目录的大纲副本过多，请整理文件后重试。');
    } finally {
      if(created) await IO.remove(tmpPath,{ignoreAbsent:true});
    }
  });
  return {run: async (request:Request) => {
    if (request.action==='scan') return scan(await IO.read(request.pdf),assetBase);
    if (request.action==='apply') return apply(request);
    throw new Error('未知操作。');
  }};
}
