# BranchScope · 对话地图

适用于 Chrome 和 Edge 的 Manifest V3 浏览器扩展，把当前 ChatGPT 会话中已挂载的消息展示在可搜索的地图上。节点支持拖动、缩放、预览和查看消息详情。

## 安装和运行

```powershell
cd extension
npm.cmd ci
npm.cmd run build
```

打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式，加载 `extension/dist`。

- **合成演示**：点击浏览器工具栏的扩展图标。
- **采样当前会话**：打开或刷新 ChatGPT 的普通已保存会话（路径为 `/c/<UUID>`），点右下角「会话地图」和「采样当前会话」。点击采样表示授权读取该会话。默认尝试自动识别，手动配置位于「手动调试配置」。
- **跟踪更新**：从同一面板启动，最长 60 秒。「停止采集」清除数据并结束当前面板的采集授权，「清除数据」清除数据和正在进行的跟踪。
- **验收诊断**：一次采样后即可展开。只包含计数、问题码和可用时的候选 UUID 集合指纹。当前默认规则已通过本地模拟 DOM 回归，真实网站的 T10、T11、T13 验收仍待实测。

采样范围限于当前已挂载消息。只有可靠的关系证据才绘制连线，活动状态和关系缺证时显示「未知」。实时采样正文只在内存中使用。

## 测试

在仓库根目录运行采集器测试。

```powershell
node --test research/m2-prototype/parser.test.cjs research/m2-prototype/probe.test.cjs research/m2-prototype/observe.test.cjs
```

在 `extension` 下运行画布和打包扩展回归。本地打包扩展使用隔离的 Chromium 和拦截响应提供合成 DOM。

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
npm.cmd exec -- playwright install chromium --no-shell
npm.cmd run test:extension
```
