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
    const restore = add(context, 'rule-outline-restore', '恢复上次生成大纲前的 PDF…', () => this.restore(win));
    if (context) {
      const refresh = () => {
        const selected = win.ZoteroPane.getSelectedItems();
        const valid = selected.length === 1 && (selected[0].isRegularItem() || selected[0].isPDFAttachment());
        for (const node of [generate, restore]) node.disabled = !valid || this.busy;
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
    const path = await item.getFilePathAsync();
    if (!path || !await this.IO.exists(path)) throw new Error('PDF 尚未下载或文件不存在。');
    return {item, path};
  },

  assertClosed(item) {
    // Reader has no public lookup by item ID. This is the only Reader-internal access.
    if (!Array.isArray(Zotero.Reader._readers)) throw new Error('无法检查阅读器状态，请关闭所有 PDF 后重启 Zotero 再试。');
    if (Zotero.Reader._readers.some(r => r.itemID === item.id && !r._isTabClosed)) {
      throw new Error('请先关闭这份 PDF 的 Zotero 阅读器标签页/窗口，再点击写入或恢复。预览窗口可以保持打开。');
    }
  },

  backupDirectory(item) {
    return this.Path.join(Zotero.DataDirectory.dir, 'rule-outline-backups', String(item.libraryID), item.key);
  },

  async syncChanged(item) {
    if (item.isImportedAttachment()) {
      item.attachmentSyncState = 'to_upload';
      await item.saveTx();
    }
    await Zotero.Notifier.trigger('refresh', 'item', [item.id]);
  },

  async generate(win) {
    if (this.busy) throw new Error('正在处理另一份 PDF，请稍候。');
    const {item, path} = await this.selectedPDF(win);
    const input = {value: '7'};
    if (!Services.prompt.prompt(win, '生成 PDF 大纲', '评分阈值（4–15，默认 7）：\n偏高会减少误判，偏低会保留更多标题候选。', input, null, {})) return;
    const threshold = Number(input.value);
    if (!Number.isInteger(threshold) || threshold < 4 || threshold > 15) throw new Error('阈值必须为 4–15 的整数。');
    this.busy = true;
    const progress = new Zotero.ProgressWindow({closeOnClick: true});
    progress.changeHeadline('规则大纲');
    progress.addDescription('正在本地分析 PDF，请稍候…');
    progress.show();
    let result;
    try { result = await this.run({action: 'scan', pdf: path, threshold}); }
    finally { this.busy = false; progress.close(); }
    if (!this.alive) return;
    const io = {
      result,
      name: item.getField('title') || this.Path.filename(path),
      apply: async (headings, overwrite) => {
        if (!this.alive) throw new Error('插件已关闭。');
        if (this.busy) throw new Error('正在处理另一份 PDF，请稍候。');
        // Recheck permissions/path after an arbitrarily long preview session.
        if (!item.isEditable() || Zotero.Libraries.get(item.libraryID).filesEditable === false || await item.getFilePathAsync() !== path) throw new Error('附件权限或路径已变化，请重新生成。');
        this.assertClosed(item);
        this.busy = true;
        try {
          const written = await this.run({action: 'apply', pdf: path, sha256: result.sha256, headings, overwrite, backup_directory: this.backupDirectory(item)});
          try { await this.syncChanged(item); }
          catch (error) { written.warning = 'PDF 已成功写入，但 Zotero 同步状态更新失败。请重启 Zotero 并检查同步。'; Zotero.logError(error); }
          return written;
        } finally { this.busy = false; }
      },
      open: () => Zotero.Reader.open(item.id),
    };
    const dialog = win.openDialog('chrome://rule-outline/content/preview.xhtml', '', 'chrome,centerscreen,resizable,width=1000,height=720', io);
    this.dialogs.add(dialog);
    dialog.addEventListener('unload', () => this.dialogs.delete(dialog), {once: true});
  },

  async restore(win) {
    if (this.busy) throw new Error('正在处理另一份 PDF，请稍候。');
    const {item, path} = await this.selectedPDF(win);
    this.assertClosed(item);
    if (!Services.prompt.confirm(win, '恢复 PDF', '恢复最近一次生成大纲前的完整 PDF？\n若生成后文件又发生变化，将拒绝自动恢复。')) return;
    this.busy = true;
    try {
      await this.run({action: 'restore', pdf: path, backup_directory: this.backupDirectory(item)});
      try { await this.syncChanged(item); }
      catch (error) { Zotero.logError(error); Services.prompt.alert(win, '同步提醒', 'PDF 已恢复，但同步状态更新失败，请重启并检查同步。'); }
      Services.prompt.alert(win, '规则大纲', '已恢复原 PDF，备份仍然保留。重新打开 PDF 即可查看。');
    } finally { this.busy = false; }
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
