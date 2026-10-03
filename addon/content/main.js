var RuleOutline = {
  windows: new Map(),
  dialogs: new Set(),
  operations: new Set(),
  services: new Map(),
  engineErrors: new Map(),
  busy: false,
  alive: true,
  IO: IOUtils,
  Path: PathUtils,

  addWindow(win) {
    if (this.windows.has(win)) return;
    const doc = win.document;
    const elements = [], listeners = [];
    const add = (parent, id, label, action) => {
      if (!parent) return;
      const node = doc.createXULElement('menuitem');
      node.id = id;
      node.setAttribute('label', label);
      node.addEventListener('command', () => this.guard(win, action));
      parent.append(node);
      elements.push(node);
      return node;
    };
    const context = doc.getElementById('zotero-itemmenu');
    const generate = add(context, 'rule-outline-generate', '生成 PDF 大纲（规则）…', () => this.generate(win));
    if (context) {
      const refresh = () => {
        const selected = win.ZoteroPane.getSelectedItems();
        const valid = selected.length === 1 && (selected[0].isRegularItem() || selected[0].isPDFAttachment());
        generate.disabled = !valid || this.busy;
      };
      context.addEventListener('popupshowing', refresh);
      listeners.push([context, 'popupshowing', refresh]);
    }
    this.windows.set(win, {elements, listeners});
    // Load while the addon is starting, before upgrades can replace its XPI.
    try { this.initializeEngine(win); }
    catch (error) { this.engineErrors.set(win, error); Zotero.logError(error); }
  },

  removeWindow(win) {
    const record = this.windows.get(win);
    if (!record) return;
    for (const [node, event, listener] of record.listeners) node.removeEventListener(event, listener);
    for (const node of record.elements) node.remove();
    this.windows.delete(win);
    this.services.delete(win);
    this.engineErrors.delete(win);
  },

  async guard(win, action) {
    try { await action(); }
    catch (error) {
      Zotero.logError(error);
      if (this.alive) Services.prompt.alert(win, '规则大纲', error.message || String(error));
    }
  },

  async selectedPDF(win) {
    const selected = win.ZoteroPane.getSelectedItems();
    if (selected.length !== 1) throw new Error('请选择一份 PDF 或一条文献。');
    let item = selected[0];
    if (item.isRegularItem()) {
      const pdfs = Zotero.Items.get(item.getAttachments()).filter(x => x.isPDFAttachment());
      if (!pdfs.length) throw new Error('所选文献没有 PDF 附件。');
      if (pdfs.length > 1) throw new Error('该文献有多份 PDF，请展开文献并直接选中目标 PDF。');
      item = pdfs[0];
    }
    if (!item.isPDFAttachment()) throw new Error('请选择 PDF 附件。');
    if (!item.isEditable()) throw new Error('此附件不可编辑。');
    const library = Zotero.Libraries.get(item.libraryID);
    if (library.filesEditable === false) throw new Error('此文献库没有文件编辑权限。');
    if (library.libraryType === 'group') throw new Error('群组文献库不支持链接文件附件，请在个人文献库中生成大纲副本。');
    const path = await item.getFilePathAsync();
    if (!path || !await this.IO.exists(path)) throw new Error('PDF 尚未下载或文件不存在。');
    return {item, path};
  },

  async generate(win) {
    if (this.busy) throw new Error('正在处理另一份 PDF，请稍候。');
    const {item, path} = await this.selectedPDF(win);
    this.busy = true;
    const progress = new Zotero.ProgressWindow({closeOnClick: true});
    progress.changeHeadline('规则大纲');
    progress.addDescription('正在本地分析 PDF，请稍候…');
    progress.show();
    let result;
    try { result = await this.run({action: 'scan', pdf: path}); }
    finally { this.busy = false; progress.close(); }
    if (!this.alive) return;
    let outputPath, outputAttachment, registration;
    const registerOutput = async () => {
      if (!this.alive) throw new Error('插件已关闭。');
      if (!outputPath) throw new Error('请先生成大纲副本。');
      if (outputAttachment) return outputAttachment;
      if (registration) return registration;
      // Store the promise so repeated open clicks cannot create duplicate attachments.
      const options = {file: outputPath, title: '带大纲版本', contentType: 'application/pdf'};
      if (item.parentID) options.parentItemID = item.parentID;
      else options.collections = item.getCollections();
      registration = Zotero.Attachments.linkFromFile(options);
      this.operations.add(registration);
      try {
        outputAttachment = await registration;
        return outputAttachment;
      } finally {
        this.operations.delete(registration);
        registration = undefined;
      }
    };
    const io = {
      result,
      name: item.getField('title') || this.Path.filename(path),
      apply: async (headings, overwrite) => {
        if (!this.alive) throw new Error('插件已关闭。');
        if (this.busy) throw new Error('正在处理另一份 PDF，请稍候。');
        // Recheck permissions/path after an arbitrarily long preview session.
        if (!item.isEditable() || Zotero.Libraries.get(item.libraryID).filesEditable === false || await item.getFilePathAsync() !== path) throw new Error('附件权限或路径已变化，请重新生成。');
        this.busy = true;
        try {
          const written = await this.run({action: 'apply', pdf: path, sha256: result.sha256, headings, overwrite});
          outputPath = written.output;
          try {
            const attachment = await registerOutput();
            written.attachmentID = attachment.id;
          } catch (error) {
            // The valid PDF already exists. Keep it and allow registration to be retried.
            Zotero.logError(error);
            written.warning = '副本已保存，但自动添加链接附件失败。点击“打开新 PDF”重试，或手动添加该文件。';
          }
          return written;
        } finally { this.busy = false; }
      },
      open: async () => {
        const attachment = await registerOutput();
        await Zotero.Reader.open(attachment.id);
      },
    };
    const dialog = win.openDialog('chrome://rule-outline/content/preview.xhtml', '', 'chrome,centerscreen,resizable,width=1000,height=720', io);
    this.dialogs.add(dialog);
    dialog.addEventListener('unload', () => this.dialogs.delete(dialog), {once: true});
  },

  initializeEngine(win) {
    let service = this.services.get(win);
    if (!service) {
      try {
        Services.scriptloader.loadSubScriptWithOptions('chrome://rule-outline/content/engine.js', {target: win, ignoreCache: true});
      } catch (error) {
        const detail = error?.message || String(error);
        throw new Error('无法加载插件内的 PDF 引擎。请重新安装最新版 XPI，完全退出 Zotero 后再启动。\n' + detail);
      }
      if (typeof win.RuleOutlineEngine?.createService !== 'function') throw new Error('PDF 引擎未正确初始化，请重新安装插件并重启 Zotero。');
      service = win.RuleOutlineEngine.createService(this.IO, this.Path, 'chrome://rule-outline-vendor/content/',
        () => Services.uuid.generateUUID().toString().replace(/[{}]/g, ''));
      this.services.set(win, service);
    }
    return service;
  },

  async run(request) {
    if (!this.alive) throw new Error('插件已关闭。');
    const win = [...this.windows.keys()].find(w => !w.closed);
    if (!win) throw new Error('请打开 Zotero 主窗口后重试。');
    if (this.engineErrors.has(win)) throw this.engineErrors.get(win);
    const service = this.initializeEngine(win);
    const operation = service.run(request);
    this.operations.add(operation);
    try { return await operation; }
    finally { this.operations.delete(operation); }
  },

  async shutdown() {
    this.alive = false;
    for (const win of [...this.windows.keys()]) this.removeWindow(win);
    for (const dialog of this.dialogs) dialog.close();
    this.dialogs.clear();
    await Promise.allSettled([...this.operations]);
    this.services.clear();
    this.engineErrors.clear();
  },
};
