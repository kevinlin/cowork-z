<p align="center">
  <img src="src-tauri/icons/app-icon.png" alt="Cowork-Z" width="200" />
</p>

<h1 align="center">Cowork-Z</h1>

<p align="center">
  <strong>本地优先的 AI 工作区，确保你的工作隐私、有序且随时可用。</strong>
</p>

<p align="center">
  <a href="https://github.com/kevinlin/cowork-z/releases/latest"><img src="https://img.shields.io/github/v/release/kevinlin/cowork-z?label=download&style=for-the-badge" alt="最新版本" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/kevinlin/cowork-z?style=for-the-badge" alt="MIT 许可证" /></a>
  <a href="https://github.com/kevinlin/cowork-z/actions"><img src="https://img.shields.io/github/actions/workflow/status/kevinlin/cowork-z/publish.yml?branch=release&style=for-the-badge&label=build" alt="构建状态" /></a>
</p>

<p align="center">
  <img src="assets/ScreenRecording_LocatePhotos.gif" alt="Cowork-Z — AI 智能体在本地定位和整理照片" width="800" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/kevinlinyu8)

---

## 为什么选择 Cowork-Z？

大多数 AI 工具迫使你在能力和隐私之间做出选择——而且每次都需要从零开始重建上下文。Cowork-Z 采用了不同的方式。

每个项目都有自己独立的工作区：一个文件夹，所有文件、会话和智能体历史记录集中在一处。你的数据永远不会离开你的电脑。内置的技能目录和入门包让你几分钟就能上手，而非几小时。

无论你是保护专有代码的开发者、处理敏感数据的研究人员，还是希望在本地文件上使用 AI 的知识工作者——如果隐私对你很重要，这就是为你准备的。

---

## 功能特性

### 🔒 隐私优先设计

#### 沙箱权限

你的文件永远不会离开你的电脑。智能体在本地读写——不会上传到云服务器。你可以精确控制它能访问什么：

- **文件夹级别的访问控制** — 按目录授予只读或读写权限
- **运行时权限提示** — 如果智能体需要访问你未批准的文件夹，它会先请求许可
- **按会话追踪** — 权限按任务范围设定并持久化

<p align="center">
  <img src="assets/Screenshot_PermissionRequest.png" alt="Cowork-Z — 运行时权限对话框" width="700" />
  <br />
  <em>智能体在访问你批准列表之外的文件夹前会先请求许可</em>
</p>

#### 多供应商灵活接入

连接 **12+ AI 供应商**，随时切换：

**直连 API** — Anthropic、OpenAI、Google Gemini、xAI、DeepSeek、Z.AI\
**云平台** — GitHub Copilot, AWS Bedrock、Azure AI Foundry\
**代理服务** — OpenRouter、LiteLLM\
**本地模型** — Ollama

凭证存储在 **操作系统钥匙串**（macOS 钥匙串、Windows 凭据管理器、Linux Secret Service）中——绝不以明文存储。

<p align="center">
  <img src="assets/Screenshot_MultiProvider.png" alt="Cowork-Z — 供应商设置" width="700" />
  <br />
  <em>连接任意供应商——凭证存储在操作系统钥匙串中</em>
</p>

---

### 📁 一次专注一个项目

#### 每项目独立工作区

工作围绕工作区组织——一个文件夹，一个焦点。每个工作区都有自己的文件、聊天会话、权限和智能体历史记录。切换工作区就是切换项目，互不干扰。

- **文件树浏览器** — 侧边栏懒加载文件树，支持实时文件系统监听和搜索
- **文件预览面板** — 预览代码（语法高亮）、Markdown、图片、视频、PDF 和 HTML，无需离开应用；支持全屏模式
- **"添加到聊天"** — 直接从预览面板将任意文件以 `@路径` 引用的方式插入聊天输入

<p align="center">
  <img src="assets/Screenshot_Workspace.png" alt="Cowork-Z — 工作区" width="700" />
  <br />
  <em>每个项目一个工作区——文件、会话和历史记录集中管理</em>
</p>

#### 丰富的聊天体验

- **内联文件预览** — 文件路径渲染为可点击链接，图片和视频带缩略图
- **图片画廊** — 点击任意缩略图打开应用内预览，可"在 Finder 中显示"
- **URL 预览** — 智能体回复中的链接在默认浏览器中打开
- **拖放支持** — 从 Finder 或文件树拖放文件或文件夹到聊天中引用它们
- **多行输入** — 使用 `Shift+Enter` 编写详细的提示词
- **待办追踪** — 在侧边栏面板中查看智能体的任务进度和进度条
- **产出物面板** — 智能体创建或修改的所有文件都在侧边栏中追踪

<p align="center">
  <img src="assets/Screenshot_MediaFileInChat.png" alt="Cowork-Z — 聊天中的媒体文件" width="700" />
  <br />
  <em>文件路径渲染为可点击链接，带内联媒体预览</em>
</p>

---

### ⚡ 几分钟即可上手

#### 入门包

通过 **6 个引导式工作区包** 快速开始，涵盖写作、研究、安全审计、法律审查等。每个包都包含模板文件、提示词和分步指南：

1. 在主页浏览入门包，点击 **安装**
2. 选择目标文件夹——应用会自动创建工作区
3. 智能体打开 `START_HERE.md` 引导你完成任务

无需配置，无需从零开始。

<p align="center">
  <img src="assets/Screenshot_StarterPacks.png" alt="Cowork-Z — 入门包" width="700" />
  <br />
  <em>在主页浏览并安装引导式工作区包</em>
</p>

#### 技能目录

内置的可复用 AI 技能模板目录，一键安装：

- **分类标签** — 按领域浏览（营销、销售、企业等）
- **搜索** — 按名称、描述或分类实时过滤
- **一键安装** — 技能复制到 `~/.config/opencode/skills/`，智能体自动发现
- **更新检测** — SHA256 校验和标记过期技能，提供重新安装提示

<p align="center">
  <img src="assets/Screenshot_SkillsCatalog.png" alt="Cowork-Z — 技能目录" width="700" />
  <br />
  <em>一键安装可复用 AI 技能——无需手动管理文件</em>
</p>

#### 技能管理器

专用窗口，用于管理来自 Git 仓库的技能：

- **注册 Git 仓库** — 添加任意公开或私有 Git 仓库作为技能来源
- **自动发现** — 通过扫描 `SKILL.md` 文件，从克隆的仓库中自动发现技能
- **浏览和安装** — 搜索、筛选并将仓库中的技能安装到任意全局技能目录
- **同步和更新** — 应用启动时自动同步仓库；过期技能显示更新提示
- **多目标目录** — 可安装到 `~/.config/opencode/skills/`、`~/.claude/skills/` 或 `~/.agents/skills/`

#### 通过 MCP 服务器扩展

通过 [模型上下文协议](https://opencode.ai/docs/mcp-servers/) 连接外部工具和数据源。支持本地（命令）和远程（URL）服务器，可在设置面板中配置。

---

### 🖥️ 原生桌面体验

- **键盘快捷键** — `Cmd+N` 新任务、`Cmd+,` 设置、`Escape` 取消
- **多主题** — 亮色和暗色模式，运行时切换
- **自动更新** — 启动时检查更新，使用签名验证的安装包
- **跨平台** — 目前支持 macOS（Apple Silicon 和 Intel）；Windows 和 Linux 构建版本可用

<p align="center">
  <img src="assets/Screenshot_DarkMode.png" alt="Cowork-Z — 暗色主题" width="700" />
  <br />
  <em>随时切换亮色和暗色主题</em>
</p>

---

## 下载

### macOS (Apple Silicon & Intel)

<p>
  <a href="https://github.com/kevinlin/cowork-z/releases/latest">
    <img src="https://img.shields.io/badge/Download_for_Mac-DMG-blue?style=for-the-badge&logo=apple&logoColor=white" alt="Mac 版下载" />
  </a>
</p>

前往 [**最新版本**](https://github.com/kevinlin/cowork-z/releases/latest) 下载适合你架构的 `.dmg` 文件：

| 芯片 | 文件 |
|------|------|
| Apple Silicon (M1+) | `cowork-z_*_aarch64.dmg` |
| Intel | `cowork-z_*_x64.dmg` |

### Windows

> **Windows 支持（开发中）** — Cowork-Z 现已可在 Windows 上运行。完整功能覆盖尚未完成，可能存在一些粗糙之处，请 [报告问题](https://github.com/kevinlin/cowork-z/issues/new)。

### Linux

> Linux 构建版本（x64 和 ARM64）由 CI 生成。请在 [发布页面](https://github.com/kevinlin/cowork-z/releases) 查看 `.deb` 和 `.AppImage` 文件。

---

## 快速开始

> [!NOTE]
> **早期预览版** — Cowork-Z 正在积极开发中。部分功能可能还不够完善。欢迎 [反馈和报告问题](https://github.com/kevinlin/cowork-z/issues/new)。

### 1. 安装 OpenCode

Cowork-Z 需要 [**OpenCode**](https://opencode.ai/) 作为 AI 引擎。全局安装：

```bash
npm install -g opencode-ai
```

> 如果应用在启动时找不到 `opencode`，会显示包含安装说明的对话框。请确保 `opencode` 可执行文件在你的 shell `PATH` 中。

### 2. 启动应用并配置供应商

1. 打开 Cowork-Z
2. 按 **`Cmd + ,`**（或点击齿轮图标）打开 **设置**
3. 选择 AI 供应商（如 Anthropic、OpenAI、Google Gemini、Ollama 等）
4. 输入你的 API 密钥——凭证安全存储在 **操作系统钥匙串** 中，绝不以明文存储

### 3. 开始任务

在启动器中输入提示词（或按 **`Cmd + N`**）然后按回车。智能体将进行规划、执行并报告结果——一切都在你的本地机器上运行。

**试试这些：**
- `"将这个文件夹中的所有 PDF 汇总成一份报告"`
- `"审查这个代码库的安全问题并将发现写入 AUDIT.md"`
- `"将 ~/Downloads 中的照片按日期整理到年/月文件夹中"`

### 进阶使用（可选）

- **入门包** — 在主页浏览，选择一个引导式工作区包，点击 **安装**。应用会创建工作区，智能体引导你完成 `START_HERE.md`。
- **技能目录** — 在主页点击任意技能的 **安装** 按钮，将其添加到你的 OpenCode 技能目录。无需重启。
- **技能管理器** — 从侧边栏打开技能管理器，注册 Git 仓库作为技能来源，浏览已发现的技能，并在多个技能目录中安装或更新它们。
- **MCP 服务器** — 打开 **设置 > MCP 服务器**，通过 [模型上下文协议](https://opencode.ai/docs/mcp-servers/) 连接外部工具和数据源（数据库、API、文件系统）。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri 2.x](https://tauri.app/)（Rust + Web） |
| 前端 | React 19、TypeScript、Tailwind CSS、Radix UI / shadcn/ui、Zustand |
| 构建工具 | Vite、Cargo、pnpm |
| 数据库 | SQLite (rusqlite) |
| 安全存储 | 操作系统钥匙串 (keyring crate) |
| AI 引擎 | [OpenCode](https://opencode.ai/) 通过 Node.js sidecar |

---

## 贡献

我们欢迎贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境设置、编码规范和如何提交 Pull Request。

### 快速开发入门

```bash
git clone https://github.com/kevinlin/cowork-z.git
cd cowork-z
pnpm install
cd src-tauri/sidecar-opencode && pnpm install && cd ../..
pnpm tauri dev
```

### 前置要求

- Node.js v20+、pnpm v9+
- Tauri v2 工具链（参见 https://v2.tauri.app/start/prerequisites/）
- Rust 工具链（用于 Tauri 后端）
- OpenCode (`npm install -g opencode-ai`)

#### Windows：使用 MSVC 工具链的 Rust

Tauri 在 Windows 上需要 **MSVC** 工具链。如果遇到 `missing dlltool.exe` 错误或 `rustc -vV` 显示 `host: x86_64-pc-windows-gnu`，请按以下步骤操作：

1. **安装 Microsoft C++ 构建工具**
   - 下载 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - 在安装程序中选择 **使用 C++ 的桌面开发** 工作负载
   - 确认包含 **MSVC v143** 工具集和 **Windows 10/11 SDK**
   - 安装完成后打开 **新终端** 并用 `where cl` 验证

2. **安装 rustup**（如果找不到 `rustup`/`cargo`）
   - 下载并运行 [rustup-init.exe](https://rustup.rs/) — 选择默认安装
   - 确保 `%USERPROFILE%\.cargo\bin` 在你的 `PATH` 中
   - 验证：`rustup --version && cargo --version`

3. **切换到 MSVC 工具链**
   ```powershell
   rustup toolchain install stable-x86_64-pc-windows-msvc
   rustup default stable-x86_64-pc-windows-msvc
   ```
   用 `rustc -vV` 验证——应显示 `host: x86_64-pc-windows-msvc`。

4. **移除仓库级别的 GNU 覆盖**（常见陷阱）
   ```powershell
   rustup override list
   # 如果你的仓库列出了 ...-gnu：
   cd path\to\cowork-z
   rustup override unset
   ```

5. **清理并重新构建**
   ```powershell
   cd src-tauri && cargo clean && cd ..
   pnpm tauri dev
   ```

> **注意：** Windows 11 预装了 WebView2。如果构建提示缺少 WebView2，请安装 [运行时](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) 后重试。

---

## 路线图

完整功能规格请参阅 [需求文档](docs/specs/cowork-z/requirements.md)。待办事项：

- [x] Windows 测试和打磨
- [ ] 静态数据库加密（需求 5.2.2）

在 [Issues 页面](https://github.com/kevinlin/cowork-z/issues) 跟踪进度，或查看 [更新日志](UPDATE_LOG.md) 了解最近的发布。

---

## 致谢

- Cowork-Z 的 UI 基于 [Accomplish](https://github.com/accomplish-ai/accomplish)。感谢 Accomplish 团队在原始实现上的工作。
- 工作区、入门包和技能目录功能的灵感来源于 [Tandem](https://github.com/frumu-ai/tandem)，并大量参考了其实现。感谢 Tandem 团队开创了这一模式。

---

## 许可证

[MIT](LICENSE) — Copyright (c) 2025-present Kevin Lin and contributors
