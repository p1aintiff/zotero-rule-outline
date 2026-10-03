import {PDFDocument, PDFName, PDFDict, PDFArray, PDFObject, PDFHexString} from 'pdf-lib';
import type {OutlineHeading} from './types.js';
export async function openPDF(data: Uint8Array): Promise<PDFDocument> {
  try {
    // IOUtils returns typed arrays from another Gecko realm. pdf-lib uses instanceof.
    const pdf = await PDFDocument.load(new Uint8Array(data), {updateMetadata: false, throwOnInvalidObject: true});
    if (pdf.isEncrypted) throw new Error('不支持加密 PDF。');
    return pdf;
  } catch (error) {
    throw new Error('无法读取 PDF（损坏或加密文件不支持）：' + (error as Error).message);
  }
}
export function assertUnsigned(pdf: PDFDocument): void {
  const pending:PDFObject[]=pdf.context.enumerateIndirectObjects().map(([,value])=>value);
  const seen=new Set<PDFObject>();
  while(pending.length) {
    const value=pending.pop()!;
    if(seen.has(value))continue;
    seen.add(value);
    if(value instanceof PDFArray)pending.push(...value.asArray());
    if(value instanceof PDFDict) {
      if (value.has(PDFName.of('ByteRange')) || value.get(PDFName.of('Type'))?.toString() === '/Sig' ||
        value.get(PDFName.of('FT'))?.toString() === '/Sig') throw new Error('带数字签名的 PDF 不支持写入。');
      pending.push(...value.values());
    }
  }
}
export function validateHeadings(headings: OutlineHeading[], pages: number): void {
  if (!Array.isArray(headings) || !headings.length || headings.length>10000) throw new Error('请至少选中一个标题，且不超过 10000 项。');
  let level=0, page=0;
  for (const row of headings) {
    if (typeof row.title!=='string' || !row.title.trim() || row.title.trim().length>500) throw new Error('标题不能为空或超过 500 字。');
    if (!Number.isInteger(row.level) || row.level<1 || row.level>6 || row.level>level+1) throw new Error('首项必须为一级；后续层级不能跨级增加。');
    if (!Number.isInteger(row.page) || row.page<1 || row.page>pages || row.page<page) throw new Error('页码必须在 PDF 范围内，并按顺序排列。');
    if (row.y!==undefined && (!Number.isFinite(row.y) || row.y<0)) throw new Error('标题位置无效。');
    if (row.x!==undefined && !Number.isFinite(row.x)) throw new Error('标题位置无效。');
    level=row.level; page=row.page;
  }
}
export async function writeOutline(data: Uint8Array, headings: OutlineHeading[], overwrite: boolean): Promise<Uint8Array> {
  const pdf = await openPDF(data);
  assertUnsigned(pdf);
  validateHeadings(headings, pdf.getPageCount());
  if (pdf.catalog.has(PDFName.of('Outlines')) && !overwrite) throw new Error('PDF 已有大纲，请明确允许替换。');
  const context = pdf.context;
  const root = context.obj({Type: 'Outlines'});
  const rootRef = context.register(root);
  type Node = {dict: PDFDict; ref: ReturnType<typeof context.register>; children: Node[]};
  const tree: Node = {dict: root, ref: rootRef, children: []};
  const stack: Node[] = [tree];
  for (const heading of headings) {
    stack.length = heading.level;
    const parent = stack[heading.level-1];
    const page = pdf.getPage(heading.page-1);
    const box = page.getCropBox();
    const dict = context.obj({Title: PDFHexString.fromText(heading.title.trim()), Parent: parent.ref,
      Dest: [page.ref, 'XYZ', Math.max(box.x, Math.min(box.x+box.width, box.x+(heading.x || 0))),
        box.y+box.height-Math.min(box.height, heading.y || 0), null]});
    const node: Node = {dict, ref: context.register(dict), children: []};
    parent.children.push(node); stack.push(node);
  }
  const link = (parent: Node): number => {
    if (!parent.children.length) return 0;
    parent.dict.set(PDFName.of('First'), parent.children[0].ref);
    parent.dict.set(PDFName.of('Last'), parent.children.at(-1)!.ref);
    let count=0;
    parent.children.forEach((node, i, siblings) => {
      if (i) node.dict.set(PDFName.of('Prev'), siblings[i-1].ref);
      if (i+1<siblings.length) node.dict.set(PDFName.of('Next'), siblings[i+1].ref);
      count += 1 + link(node);
    });
    parent.dict.set(PDFName.of('Count'), context.obj(count));
    return count;
  };
  link(tree);
  pdf.catalog.set(PDFName.of('Outlines'), rootRef);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  return pdf.save({useObjectStreams: false, updateFieldAppearances: false});
}
