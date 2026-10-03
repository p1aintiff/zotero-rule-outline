# Zotero Rule Outline 0.2.1

Zotero 10 的本地规则 PDF 大纲插件。使用 **PDF.js 5.4.624** 提取文本、字体和页面位置，使用 **pdf-lib 1.17.1** 写入标准 PDF Outline / Bookmarks。无需 Python、PyMuPDF、Node 运行环境或 API Key，不上传论文。

安装包：`dist/zotero-rule-outline-0.2.1.xpi`，约 **2.1 MiB**。JavaScript 引擎、PDF.js 的中文 CMap、标准字体和依赖许可均已打包，安装后无需下载依赖。

0.2.1 将引擎脚本和字体/CMap 资源改用显式注册的 `chrome://` 地址，在主窗口注册菜单时预加载引擎。资源读取失败时显示重新安装并重启的提示，避免使用旧引擎导出。修复 Zotero IOUtils 与窗口 PDF 引擎的跨 JavaScript 环境字节数组兼容问题。

## 安装和使用

1. 在 Zotero 10 插件管理界面选择“从文件安装插件”，安装新版 XPI。旧版用户直接安装升级即可，原有 Python 路径配置不再读取。
2. 选中 PDF 附件，或仅包含一份 PDF 的文献，右键选择 **生成 PDF 大纲（规则）…**。
3. 自动分析后，在预览中查看识别依据、勾选候选、编辑标题/页码，自动重算层级，使用 ↑↓ 调整同页顺序。无需设置评分阈值。
4. 关闭目标 PDF 的所有 Zotero 阅读器标签页和独立窗口，再点击 **写入 PDF**。处理期间保持 PDF 关闭。
5. 写入成功后点击 **打开 PDF**，检查大纲与跳转位置。

从 0.2.0 升级后，请完全退出 Zotero 并重新启动，确保替换安装包后的资源加载状态刷新。若出现 `Error opening input stream`，请核对安装的是包含 `content/engine.js` 的完整新版 XPI，重新安装后重启。

页面编号是 PDF 的实际页序，从 1 开始。未编辑页码时保留检测到的标题位置；编辑页码后跳转到该页顶部。取消勾选父标题后，会按保留标题的字号自动重算层级与从属关系。

已有大纲默认保留；只有明确勾选“允许替换 PDF 已有大纲”才能写入。多份 PDF 的文献需要展开后直接选中目标附件。

## 恢复和文件保护

选中附件，右键选择 **恢复上次生成大纲前的 PDF…**。先关闭目标阅读器，再确认恢复。

- 使用 SHA-256 检查原文件是否在预览后变化，变化时拒绝写入。
- 同一 PDF 的写入/恢复使用互斥锁；异常退出遗留锁时，应先确认没有正在运行的任务，再移除对应 `.rule-outline.lock` 文件。
- 每次写入先保存完整原文件、校验备份，并用 PDF.js 重新读取输出校验书签标题、层级和页码。
- 备份保存于 `Zotero 数据目录/rule-outline-backups/<libraryID>/<itemKey>/`，与附件同步目录分离。保留多个版本，不自动清理。
- 备份和 PDF 使用同目录暂存文件、磁盘刷新和原子替换。替换失败且原文件完整时，保留之前的恢复记录。
- 自动恢复最近一次成功写入前的完整文件，并保留备份。生成后 PDF 被其他程序修改或备份损坏时，拒绝自动恢复。
- 保留原 PDF 页面、文字、PDF 批注对象与表单数据，不修改 Zotero 数据库中的批注。导入型附件通过 Zotero API 标记待上传，链接型附件仅刷新显示。

旧版本的备份目录和 `latest.json` 记录仍可读取。直接调用 JavaScript 文件服务而未传备份目录时，使用 PDF 旁的 `*.rule-outline-backups/`。

## 规则和限制

正文基准字号取全文按字符数量统计最常见的字号。字号沿用 PDF 提取时的 0.1 pt 精度，不再按 0.5 pt 合桶。

1. 统计全文最常见的字号，作为正文字号。
2. 每行字号大于正文，即列为候选。另外，独立单行、不超过 40 字、以阿拉伯数字编号加文字开头，且不含句号/分号/问号/叹号、末尾不为英文句点，也列为候选。编号后必须有以字母或汉字开头的标题文字。无需粗体，不自动合并换行标题。
3. 人工勾选保留标题后，数字编号标题按编号段数分级：`2` 一级、`2.1` 二级、`2.1.1` 三级；其余标题按保留标题的字号从大到小分级。消除跨级增加，首项为一级，最高六级。每项从属于前方最近的低一级标题，预览显示“上级标题”。取消勾选或调整顺序后自动重新计算，写入前再计算一次。
4. 写入标准 PDF 大纲。预览可编辑标题、页码及同页顺序，层级自动生成。

不同字号的文字分别提取成行，避免双栏正文覆盖另一栏标题的字号。粗体和关键词不参与候选或层级判断。较大的页眉、作者名、公式和图注会进入候选，由人工取消勾选；与正文同字号的标题，符合单行短文本数字编号条件时也会被识别。

无文字层或文字过少会提示先 OCR。加密、损坏、带数字签名的 PDF 不支持写入。暂不包含 OCR、AI、批处理或原大纲合并。

PDF.js 的解析处理器内置于引擎，在当前 JavaScript 线程运行；不创建外部进程，不下载远程 Worker。逐页提取会让出执行机会，但大型/复杂 PDF 的解析和完整保存仍可能暂时影响界面响应，且需足够内存。pdf-lib 完整重写 PDF，不做增量保存。

## 开发

使用 Node 22+（仅开发需要）：

```sh
npm ci
npm run typecheck
npm run build
npm test
```

Windows 受限环境可追加 `--cache .npm-cache` 指定项目内 npm 缓存。依赖版本固定在 `package-lock.json`。构建时不联网，将 `src/engine.ts` 打包为插件浏览器脚本，复制 CMap、标准字体和许可证，检查 Zotero 10 清单并生成 XPI；禁止 Python、wheel 或 ZIP 依赖混入插件。

- `src/extract.ts`：PDF.js 文本/字体/坐标提取、栏分离和间距计算。
- `src/scanner.ts`、`hierarchy.ts`、`layout.ts`：字号统计、候选识别、字号层级及阅读顺序。
- `src/pdf.ts`：pdf-lib PDF 检查、标准书签树和跳转目标写入。
- `src/engine.ts`：预览数据适配、文件校验、互斥锁、备份与恢复。
- `addon/content/main.js`：Zotero 菜单、权限/阅读器检查和文件服务桥接。
- `scripts/build.mjs`：浏览器引擎与 XPI 构建。
- `tests/`：真实 PDF 的 JavaScript 自动测试，不调用 Python。

可选真实浏览器检查：安装 Playwright 后运行 `node scripts/check_browser.cjs`。可通过 `BROWSER_EXECUTABLE` 指定本机 Chromium/Edge；检查中文扫描、写入后重新读取、预览交互和无远程资源请求。

TypeScript 检查、自动测试与 Edge 无头浏览器检查已通过。0.2.1 还在隔离配置的真实 Zotero 10.0.3 中验证了 XPI 脚本加载、插件 bootstrap、菜单注册、中文扫描、大纲写入、逐字节恢复和关闭清理。用户实际文献库中的附件选择、同步和阅读器跳转仍需验收，请先用可恢复的测试论文检查。唯一读取的 Reader 内部结构是 `Zotero.Reader._readers`，用于阻止打开状态下写入；后续 Zotero 修改此结构时需要适配。

本机 Zotero 运行时检查：设置 `ZOTERO_EXECUTABLE` 为可执行文件路径，运行 `node scripts/check_zotero.cjs`。它只使用项目内 `.qa-zotero-runtime/` 隔离配置和测试数据，不读取或修改用户文献库；结果保存在该目录的 `report.json`。此可选检查需桌面程序正常运行所需的系统权限。

清单限制为 Zotero 10.0–10.0.*。内嵌空更新清单不连接远程更新地址，当前版本需手动升级。

## 许可与参考

项目原创源码使用 MIT。PDF.js 使用 Apache-2.0，pdf-lib 及其依赖按各自许可分发，见 `addon/vendor/*LICENSE` 及字体/CMap 附带许可。当前插件不再包含 PyMuPDF/MuPDF。

- [PDF.js 官方 API](https://mozilla.github.io/pdf.js/api/)
- [pdf-lib 官方 API](https://pdf-lib.js.org/docs/api/)
- [Zotero 10 开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Mozilla IOUtils 文件 API](https://firefox-source-docs.mozilla.org/dom/ioutils_migration.html)
