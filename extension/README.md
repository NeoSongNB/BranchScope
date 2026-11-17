# BranchScope · 对话地图

产品源码包含 M1 合成地图和 M2 当前会话地图。两种模式共用画布、搜索和消息详情。M2 的采样内容只在当前窗口内使用。

## 本地构建

在仓库根目录的 PowerShell 执行。

```powershell
Set-Location extension
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run licenses
npm.cmd test
npm.cmd run build
```

`dist/`是可加载产物。依赖仅本目录安装，生命周期脚本关闭；没有全局包或系统工具。`npm.cmd run dev`只启动127.0.0.1开发预览，页面有“合成测试模式”；这里IndexedDB属于localhost，不等同扩展来源，数据不会自动迁移。

## Chrome/Edge加载

1. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
2. 加载已解压扩展，选择仓库中的 `extension/dist`。
3. 点击浏览器扩展图标，可直接打开独立的**合成数据测试页面**，不需要登录ChatGPT。
4. 在 chatgpt.com 刷新后，右下角“合成对话地图”可打开同一合成测试页。“会话地图”打开当前会话采样面板。
5. 左侧场景下拉框切换九组fixtures；输入搜索词，点击结果定位并选中。节点可拖动；背景可平移，滚轮缩放；工具栏适配视图。
6. 紫色轮廓表示选中、黄色背景表示搜索命中、蓝色连线表示活动路径；未知状态有文本/虚线标记。点节点查看全文及原始关系链。
7. 等底部显示“布局已保存”后刷新或关闭再开。所选场景、坐标、视口、布局方向、节点选择应恢复。“重排”是显式重新自动布局，会替换手调坐标。
8. “追加测试节点”仅在本次场景实例中追加固定合成消息，用来验证新增不移动旧节点；刷新后恢复原fixture，追加消息不持久化。其坐标可能作为孤立布局元数据保留，但不会制造消息。

IndexedDB：扩展来源，数据库 `conversation-map-m1`，版本1，stores为layouts/preferences；只保存白名单布局字段和fixture ID。存储失败会提示未保存并支持重试；损坏/未来版本记录阻止加载，原记录不覆盖。没有跨设备同步。多窗口同时操作同一fixture采用最后完成写入覆盖，M1不支持协同编辑；测试恢复时只保留一个地图窗口。清理测试数据可在该扩展测试页DevTools Application中删除此数据库（仅删除本扩展测试布局）。

## M2 当前会话采样

打开 ChatGPT 普通已保存会话（`/c/<UUID>`），点击「会话地图」和「采样当前会话」。自动识别规则会确认可见线程、消息身份、角色和正文范围。出现歧义时可查看脱敏验收诊断；需要排查页面结构时可开启「手动调试配置」。默认规则已在合成页面通过回归，真实 ChatGPT 页面仍待验收。

采样范围是当前已挂载线程，缺少父关系或活动状态证据时显示未知。「跟踪更新」观察最多 60 秒或 60 次快照；「清除数据」清空地图并结束跟踪，「停止采集」同时阻止当前面板再次采样。切换会话或刷新后需重新授权。M2 的正文和布局均留在内存。

本地打包扩展回归使用现有 Playwright。构建后运行 `npm.cmd exec -- playwright install chromium --no-shell`（首次），再运行 `npm.cmd run test:extension`。测试在隔离浏览器内用本地合成 DOM 响应校验扩展入口、采样与画布；实际 ChatGPT 兼容性单独验收。

## 实现与复用边界

技术栈沿用Convograph的MV3、React18、TypeScript、Vite、React Flow方向；未复制其消息适配器、组件或写入代码。没有CRXJS：两个无依赖入口以静态JS打包，减少不必要构建与权限。消息模型、布局与UI为本产品新实现；DSH仅借鉴画布/数据分离思想，没有其宿主API。

参考的 Convograph 固定 commit 为 415ac00c519cc925e2b8c3c4b9640ac7dfd180f3。参考 MIT 原文位于 `public/licenses/Convograph-MIT.txt`。`npm run licenses` 根据锁文件生成依赖许可证清单和可获得的许可证文本。

结构：

- src/model.ts：唯一身份、祖先证据、异常隔离、活动状态、搜索/预览。
- src/fixtures.ts：九组固定合成数据。
- src/layout.ts：自动布局与既有坐标合并。
- src/storage.ts：扩展来源IndexedDB、schema校验、白名单序列化。
- src/App.tsx、style.css：画布、搜索、详情、持久状态和失败恢复。
- public/manifest.json、content.js、background.js：最小MV3入口；无安装统计或欢迎页。
- tests/：本产品U01/U02/U05/U06离线测试；e2e/：现有Chrome上的本地合成页面测试。

## 测试与范围

`npm.cmd run test:e2e` 默认使用本机已安装Chrome（可设置环境变量M1_BROWSER=msedge测试Edge），独立临时浏览器上下文，访问127.0.0.1合成测试页面；不下载浏览器、不使用日常profile、不访问真实ChatGPT。结果/截图在test-results。它验证浏览器交互，不代表真实ChatGPT兼容性。

正文采用React纯文本渲染：保留Markdown源文本，不生成HTML、可点击链接或远程图片，避免脚本和URL执行。完整Markdown排版不属于本轮。

M2 真实站点采样及动态跟踪验收、真实父关系和活动路径证据、原文定位及写入仍待完成。
