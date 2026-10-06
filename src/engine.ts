import {WorkerMessageHandler} from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {scanPdfHeadings} from './index.js';
import {openPDF, assertUnsigned, writeOutline} from './pdf.js';
import type {OutlineHeading} from './types.js';
export {extractLines} from './extract.js';
export {inferHierarchy} from './hierarchy.js';
export {detectBodyFontSize, detectHeadings, filterRepeatedHeadings} from './scanner.js';
export {readingOrder} from './layout.js';
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
export interface WriteHooks {beforeReplace?:()=>Promise<void>; afterReplace?:()=>Promise<void>}

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
  const apply = (request:Request, hooks:WriteHooks = {}) => locked(request.pdf,async()=>{
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
    const token=uuid();
    const backupPath=Path.join(directory,filename+'.rule-outline-'+token+'.bak');
    const tmpPath=Path.join(directory,filename+'.rule-outline-'+token+'.tmp');
    let backupCreated=false, tempCreated=false, replaced=false, publishAttempted=false, preserveBackup=false;
    let warning='';
    try {
      backupCreated=true;
      await IO.write(backupPath,original,{mode:'create',flush:true});
      await unchanged(backupPath,before,'临时备份校验失败，原文件未修改。');
      tempCreated=true;
      await IO.write(tmpPath,rewritten,{mode:'create',flush:true});
      await unchanged(tmpPath,after,'新文件校验失败，原文件未修改。');
      await hooks.beforeReplace?.();
      await unchanged(request.pdf,before,'替换前 PDF 已变化，操作取消。');
      // Publish a fully verified file; never truncate the original in place.
      publishAttempted=true;
      await IO.move(tmpPath,request.pdf);
      replaced=true;
      await unchanged(request.pdf,after,'写入后的文件校验失败。');
      await hooks.afterReplace?.();
    } catch(error) {
      if(publishAttempted && !replaced) {
        // A filesystem API may reject after publishing. Recover only our own
        // bytes; retain the backup if the destination is missing or unexpected.
        preserveBackup=true;
        try {
          if(await IO.exists(request.pdf)) {
            const current=await sha256(await IO.read(request.pdf));
            if(current===after) {replaced=true;preserveBackup=false;}
            else if(current===before)preserveBackup=false;
          }
        } catch { /* An unreadable destination must not discard the backup. */ }
        if(preserveBackup) throw new Error(`${(error as Error).message}\n原件临时备份保留在：${backupPath}`);
      }
      if(replaced) {
        try {
          // Do not overwrite a newer file saved by an external editor.
          await unchanged(request.pdf,after,'写入后检测到外部修改，不能自动恢复。');
          await IO.write(tmpPath,original,{flush:true});
          await IO.move(tmpPath,request.pdf);
          await unchanged(request.pdf,before,'恢复原文件校验失败。');
        } catch(restoreError) {
          preserveBackup=true;
          throw new Error(`${(error as Error).message}\n恢复失败：${(restoreError as Error).message}\n原件临时备份保留在：${backupPath}`);
        }
      }
      throw error;
    } finally {
      for(const file of [tempCreated ? tmpPath : '', backupCreated && !preserveBackup ? backupPath : '']) {
        if(!file)continue;
        try {await IO.remove(file,{ignoreAbsent:true});}
        catch {warning+=`临时文件清理失败，请手动删除：${file}\n`;}
      }
    }
    return {count:headings.length,output:request.pdf,sha256:after,warning};
  });
  return {run: async (request:Request, hooks?:WriteHooks) => {
    if (request.action==='scan') return scan(await IO.read(request.pdf),assetBase);
    if (request.action==='apply') return apply(request,hooks);
    throw new Error('未知操作。');
  }};
}
