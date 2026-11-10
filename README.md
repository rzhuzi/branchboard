# Branchboard

Branchboard 是运行在 ChatGPT 网页中的本地优先无限画布扩展。它不调用或反代
OpenAI API，而是直接使用当前已登录的 ChatGPT 页面，把提示词、参考图、生成结果
和迭代分支组织在同一个浮动创作空间里。

核心流程只有一条：**创建 → 编写 → 生成 → 查看 → 修改 → 再生成。**

当前源码版本：**2.1.2**，默认分支为 `v2`。扩展名称为「Branchboard — 图像创作画布」，包含新版前端、图片栏、统一图标和更新的隐私说明。
Chrome 网上应用店独立使用 **1.0**，版本号在 `webstore.config.json` 维护。商店提交材料已准备，尚未声明商店上架成功。

GitHub 最新已发布安装包为 **2.1.0**，与当前源码有界面差异。体验本分支的 2.1.2 请从源码构建；后续安装包以 Releases 页面实际发布的版本为准。

## V2 交互规则

### 画布

- 拖动空白、滚轮或中键拖动平移画布。
- `Ctrl/⌘ + 滚轮` 以光标位置为中心缩放；触控板缩放手势的兼容性取决于浏览器发送的滚轮事件。
- `Shift + 拖动` 框选，`Ctrl/⌘ + 点击` 多选。
- 双击空白建立提示词并立即聚焦输入框。
- 缩放范围 10%–250%；右下角提供缩放、查看全部和选中计数。
- 底部工具栏提供选择 (V)、平移 (H)、新建提示词 (N) 与导入图片；
  平移模式下拖动任意位置（包括节点）都会移动画布。
- 撤销/重做位于画布左上角；左下角的节点计数可定位对应内容。
- 顶部图片按钮可展开当前画布的图片栏，点击缩略图定位图片；收起后恢复完整画布。
- 每个画布独立保存视角；重新打开时恢复，不会因新增图片、切换标签或生成结束
  强制重置视图。

### 提示词节点

- 提示词正文为主体，头部显示可定位的结果/参考计数，⋯ 菜单收纳更多操作。
- 点击「生成」直接操作当前 ChatGPT 页面；点击「复制」只复制，不需要切换模式。
- 分支会复制原提示词、建立点线关系并聚焦新节点。
- `Ctrl/⌘ + Enter` 在输入框内直接生成。
- 「N 结果 / N 参考」可直接定位相关节点。

### 图片节点

- 图片保留完整比例，双击预览大图；底部显示图片名与尺寸。
- 「⋯」毛玻璃按钮始终可见，打开完整操作菜单。
- 悬停或选中图片后，底部显示继续修改、预览、下载、复制和标注操作，不遮挡图片。
- 继续修改会新建提示词节点，建立明确的图片 → 提示词参考关系，并聚焦输入框。
- 图片标注保留原图，菜单中可恢复原图。
- 拖入、粘贴图片不再偷偷连接到最后一个提示词。只有拖到提示词节点上，才会
  作为参考图建立关系。

### 关系与生成

- 实线：生成结果；虚线：参考图；点线：提示词分支。选中连线时显示关系名称。
- 支持从图片右侧端点拖到提示词左侧端点，手动建立参考关系。
- 生成任务按顺序执行，节点内显示状态、耗时和取消入口；顶部任务中心可定位或取消。
- 生成完成不会跳转画布，只显示轻提示和「定位」操作。
- 结果按画布与提示词回收；即使浮窗最小化或切到其他画布，也不会丢失。
- 如果 ChatGPT 输入框已有草稿，扩展会停止发送，避免覆盖用户内容。
- 支持取消、超时、纯文字回复、重复结果去重和页面结构变化错误提示。
- 页面结构失效时，可复制提示词手动发送，再把图片拖回画布。

### 多画布与本地数据

- 标签页内联重命名，菜单删除（不会误触）。
- 自动保存，保存失败显示原因与重试入口。
- 多个 ChatGPT 标签页同时编辑时进行版本检测与字段级合并。
- 图片 Blob 与节点布局分开存储；编辑提示词只写入轻量文档。
- 旧版 IndexedDB 数据一次性迁移到 V2 数据库，旧库保留。

## 安装

### 发布包

1. 从 [GitHub Releases](https://github.com/rzhuzi/branchboard/releases/latest) 下载并解压 `branchboard-v2.1.0.zip`。
2. 打开 `chrome://extensions`。
3. 开启右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择解压后的目录。
5. 刷新 ChatGPT 页面，右下角出现 Branchboard 图标。

ZIP 根目录直接包含 `manifest.json`，无需再进入子目录。

### 从源码构建

```powershell
npm ci
npm run icons
npm test
npm run build
npm run release:check
```

然后在 `chrome://extensions` 中加载 `dist` 文件夹。

### Chrome 网上应用店构建

```powershell
npm run build:webstore
$storeVersion = (Get-Content -Encoding UTF8 .\webstore.config.json | ConvertFrom-Json).version
Compress-Archive -Path .\dist-webstore\* -DestinationPath ".\branchboard-webstore-v$storeVersion.zip" -Force
```

`dist` 保留 GitHub 版本号，`dist-webstore` 使用独立的商店版本号；两者功能代码相同。
上传时选择商店 ZIP。后续更新商店版本只需修改 `webstore.config.json`，无需修改 GitHub 版本。
同一商店条目的后续上传必须递增版本号。

## 旧版数据迁移

- V2 使用独立数据库 `branchboard-v2`，不会改写旧库 `branchboard-db`。
- 首次启动 V2 时会自动迁移旧版画布、提示词、图片、关系、收件箱图片和工作区标题。
- 迁移完成后旧库仍保留，便于回退旧版本。代价是图片会在两个数据库中各存一份。
- 清理扩展本地数据可能同时删除当前画布。清理前请先保存需要的图片与提示词，不要把清理全部数据当作仅删除旧库。
- 迁移会跳过已经存在的 V2 画布文档，重复启动不会把同一张图重复加入画布。

## 开发

```powershell
npm run dev          # 独立画布开发预览
npm run typecheck
npm test             # 纯逻辑单元测试
npm run build        # 画布 + 内容脚本 + 后台脚本
npm run release:check
```

`npm run build` 会先由 Vite 构建 `canvas.html`，再由 esbuild 将
`src/content` 和 `src/background` 分别打包为 `dist/content.js` 与
`dist/background.js`。

独立预览地址为 `/canvas.html`。独立预览可编辑、导入和整理画布；自动发送与生图回收需要在已登录的 ChatGPT 页面中加载扩展后使用。

自动化范围与浏览器测试命令见 [开发与验证](docs/DEVELOPMENT.md)。账号内生图仍需用户实际测试，自动化不代表已经覆盖真实账号流程。

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 生成 | 提示词输入框内 `Ctrl/⌘ + Enter` |
| 撤销 / 重做 | `Ctrl/⌘ + Z` / `Shift + Ctrl/⌘ + Z` |
| 复制选中节点 | `Ctrl/⌘ + D` |
| 删除选中节点或连线 | `Delete` / `Backspace` |
| 全选节点 | `Ctrl/⌘ + A` |
| 新建提示词 | `N` 或双击空白 |
| 选择 / 平移工具 | `V` / `H` |
| 缩放 | `Ctrl/⌘ + +` / `Ctrl/⌘ + -` / `Ctrl/⌘ + 0` |
| 查看全部 | `Shift + 1` |

## 架构

```text
src/shared/      领域类型、IndexedDB、迁移、布局、合并、消息、剪贴板
src/canvas/      画布 UI、节点、关系边、覆盖层、编辑器状态与命令
src/content/     ChatGPT 页面浮窗、DOM 适配、发送与结果捕获
src/background/  后台存储、待回收结果、隐藏剪贴板页
public/          manifest、图标、offscreen 页面
scripts/         图标生成、扩展打包、发布校验
tests/           单元测试与 Puppeteer 浏览器走查
```

关键边界：

- 画布 UI 不直接操作 ChatGPT DOM。
- 页面自动化的选择器集中在 `src/content/dom.ts`，页面变化时影响范围可控。
- 节点操作统一走 `src/canvas/state/useEditor.ts` 的命令层，菜单、工具栏和快捷键
  不各自实现一套逻辑。
- 图片以 `assetId` 引用，不放进节点持久化数据。
- 撤销历史按画布隔离，只保存在当前会话内存中。

## 权限与隐私

扩展只申请：

- `storage`：浮窗位置、主题和本地设置；
- `clipboardWrite`：用户主动复制提示词或图片；
- `offscreen`：在扩展隐藏页完成剪贴板写入；
- `chatgpt.com` / `chat.openai.com`：显示浮动画布并执行用户主动触发的页面操作。

扩展不在后台主动读取剪贴板；用户主动粘贴时会处理该次粘贴内容。不主动读取或导出 ChatGPT Cookie，也不需要 API Key。生成时所选提示词和参考图片会提交给 ChatGPT；拖入网络图片时可能向图片来源发起请求，画布内容不上传到开发者服务器。详见 [PRIVACY.md](PRIVACY.md)。

## 已知边界

- ChatGPT 页面 DOM 更新可能导致自动生成失败；错误会明确显示，复制和手动导入
  始终可用。
- 同一个画布 iframe 内生成任务串行排队，避免多个任务争用同一个输入框。
- 删除节点或画布后，图片 Blob 仍可能留在本地。清理该扩展的全部本地数据或卸载可释放这些资源，同时会丢失本地画布。
- 旧版数据库会保留一份迁移前数据，因此升级后本地占用会暂时增加。
- 真实 ChatGPT 生成流程仍需人工验收，自动化测试不声称覆盖该部分。

## 相关文档

- [PRIVACY.md](PRIVACY.md)
- [CHANGELOG.md](CHANGELOG.md)
- [docs/PROJECT_APPLICATION.md](docs/PROJECT_APPLICATION.md)
