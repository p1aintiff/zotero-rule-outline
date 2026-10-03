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
    const path = await item.getFilePathAsync();
    if (!path || !await this.IO.exists(path)) throw new Error('PDF 尚未下载或文件不存在。');
    return {item, path};
  },

  async checkWritable(item, path) {
    if (!this.alive) throw new Error('插件已关闭。');
    if (!item.isEditable() || Zotero.Libraries.get(item.libraryID).filesEditable === false ||
        await item.getFilePathAsync() !== path) throw new Error('附件权限或路径已变化，请重新生成。');
    if (Zotero.Sync?.Runner?.syncInProgress) throw new Error('Zotero 正在同步，请等待同步完成后重试。');
  },

  async closeReaders(item, snapshots) {
    const readers = Zotero.Reader._readers.filter(reader => reader.itemID === item.id && !reader._isTabClosed);
    for (const reader of readers) {
      const initDeadline = Date.now() + 15000;
      while (!reader._internalReader) {
        if (Date.now() > initDeadline) throw new Error('阅读器初始化超时，PDF 未修改。');
        await Zotero.Promise.delay(50);
      }
      const internal = reader._internalReader;
      const manager = internal?._annotationManager;
      if (!manager?._unsavedAnnotations || typeof manager._triggerSaving !== 'function' ||
          typeof internal.freeze !== 'function' || typeof internal.unfreeze !== 'function' || typeof reader._flushState !== 'function' ||
          typeof reader._getState !== 'function' || typeof reader.close !== 'function') {
        throw new Error('当前阅读器不支持安全保存和关闭，请手动关闭该 PDF 后重试。');
      }
      const skipDebounce = manager._skipAnnotationSavingDebounce;
      let closed = false, saveError;
      internal.freeze();
      manager._skipAnnotationSavingDebounce = true;
      try {
        const deadline = Date.now() + 15000;
        while (manager._unsavedAnnotations.size || manager._savingInProgress) {
          if (Date.now() > deadline) throw new Error('等待批注保存超时，PDF 未修改。');
          if (saveError) throw saveError;
          if (!manager._savingInProgress) manager._triggerSaving().catch(error => { saveError = error; });
          await Zotero.Promise.delay(50);
        }
        if (saveError) throw saveError;
        if (internal._state.errorMessage) throw new Error('阅读器批注保存失败，PDF 未修改。');
        await reader._flushState();
        const state = await reader._getState();
        const snapshot = {state, openInWindow: !reader.tabID, secondViewState: reader.getSecondViewState?.()};
        await reader.close();
        closed = true;
        snapshots.push(snapshot);
      } finally {
        manager._skipAnnotationSavingDebounce = skipDebounce;
        if (!closed) internal.unfreeze();
      }
    }
    // ReaderTab.close() initiates closing; wait for Zotero to unregister it.
    const deadline = Date.now() + 5000;
    while (Zotero.Reader._readers.some(reader => reader.itemID === item.id && !reader._isTabClosed)) {
      if (Date.now() > deadline) throw new Error('阅读器未能关闭，PDF 未修改。');
      await Zotero.Promise.delay(50);
    }
  },

  async reopenReaders(item, snapshots) {
    const errors = [];
    for (const snapshot of snapshots) {
      try {
        await Zotero.Reader.open(item.id, snapshot.state, {
          openInWindow: snapshot.openInWindow, allowDuplicate: true, secondViewState: snapshot.secondViewState,
        });
      } catch(error) { errors.push(error.message || String(error)); }
    }
    return errors.length ? '阅读器恢复失败，请重新打开原附件：' + errors.join('；') : '';
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
    let completed = false;
    const io = {
      result,
      name: item.getField('title') || this.Path.filename(path),
      apply: async (headings, overwrite) => {
        if (!this.alive) throw new Error('插件已关闭。');
        if (this.busy) throw new Error('正在处理另一份 PDF，请稍候。');
        // Recheck permissions/path after an arbitrarily long preview session.
        await this.checkWritable(item, path);
        if (this.busy) throw new Error('正在处理另一份 PDF，请稍候。');
        this.busy = true;
        const snapshots = [];
        let written, failure, resumeSync;
        try {
          if (typeof Zotero.Sync?.Runner?.delayIndefinite !== 'function') throw new Error('无法暂缓 Zotero 同步，PDF 未修改。');
          resumeSync = Zotero.Sync.Runner.delayIndefinite();
          await this.closeReaders(item, snapshots);
          const stored = item.isStoredFileAttachment();
          const previousSyncState = item.attachmentSyncState;
          if (stored && typeof Zotero.Sync?.Storage?.Local?.SYNC_STATE_TO_UPLOAD !== 'number') {
            throw new Error('无法访问 Zotero 文件同步接口，PDF 未修改。');
          }
          written = await this.run({action: 'apply', pdf: path, sha256: result.sha256, headings, overwrite}, {
            beforeReplace: async () => {
              await this.checkWritable(item, path);
              if (Zotero.Reader._readers.some(reader => reader.itemID === item.id && !reader._isTabClosed)) {
                throw new Error('PDF 阅读器已重新打开，请关闭后重试。');
              }
            },
            afterReplace: async () => {
              if (stored) {
                item.attachmentSyncState = Zotero.Sync.Storage.Local.SYNC_STATE_TO_UPLOAD;
                try { await item.saveTx(); }
                catch(error) { item.attachmentSyncState = previousSyncState; throw error; }
              }
            },
          });
          completed = true;
          written.attachmentID = item.id;
        } catch(error) { failure = error; }
        finally {
          const warning = await this.reopenReaders(item, snapshots);
          resumeSync?.();
          this.busy = false;
          if (written && warning) written.warning = [written.warning, warning].filter(Boolean).join('\n');
          if (failure && warning) failure = new Error((failure.message || String(failure)) + '\n' + warning);
        }
        if (failure) throw failure;
        if (item.isStoredFileAttachment()) {
          try { Zotero.Sync.Runner.setSyncTimeout(1); }
          catch(error) { written.warning = [written.warning, '已标记待上传；请手动同步。'].filter(Boolean).join('\n'); }
        }
        return written;
      },
      open: async () => {
        if (!completed) throw new Error('请先写入大纲。');
        await Zotero.Reader.open(item.id);
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

  async run(request, hooks) {
    if (!this.alive) throw new Error('插件已关闭。');
    const win = [...this.windows.keys()].find(w => !w.closed);
    if (!win) throw new Error('请打开 Zotero 主窗口后重试。');
    if (this.engineErrors.has(win)) throw this.engineErrors.get(win);
    const service = this.initializeEngine(win);
    const operation = service.run(request, hooks);
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
