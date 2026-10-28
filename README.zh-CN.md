# LearnHarness — t41372 的个人修改版

[English](README.md) · [原始项目](https://github.com/amosblomqvist/learnharness) · [开发文档](docs/development.md)

这是 **t41372 根据个人需要修改并长期维护的 LearnHarness fork**。原始项目由 [amosblomqvist](https://github.com/amosblomqvist/learnharness) 创建；这个仓库在原版学习应用的基础上，增加了下列功能。`fork-preview` 是我自己日常使用和本地构建的版本。

LearnHarness 使用 AI Agent 了解你的起点、规划课程，通过推理、提问和练习帮助你建立理解。持久化知识图谱把命题和推理链保留下来，供后续会话继续使用。

![LearnHarness 教学会话](docs/assets/teaching-session.png)

## 这个 fork 增加了什么

| 主题 | 额外功能 |
| --- | --- |
| 界面语言 | 支持英语、简体中文和繁体中文，可在“设置 → 通用”切换。 |
| 个人指令 | “设置 → Agent”中的个人指令会传递给学习 Agent，例如指定回答语言。 |
| 本地语音输入 | 在 Deepgram 之外，加入 Standard ASR 插件与本地模型。插件安装、模型选择和模型下载分别由你明确操作；切换引擎或模型后，下一次语音输入会使用新设置。 |
| 间隔复习 | 使用 FSRS 安排复习，提供到期／后续复习队列、可恢复的练习会话，以及完成题目后的自我评分。 |
| 图像与附件 | 在对话、问题回答和练习中粘贴、拖入或选择图片、PDF、文本与源代码文件；支持只发送附件。文件内容保存在本地附件存储中，每条消息最多 10 个文件，每个文件最大 20 MB。 |
| 本地桌面构建 | 为 Apple Silicon Mac 生成采用 ad hoc 签名的 App 和 ZIP，跳过公证，不发布。构建前检查最新上游基线与全部已登记功能是否齐全。 |
| Fork 维护流程 | 按主题长期维护分支，在这个 fork 内保留比较 PR，并构建完整的组合预览。来源清单保存在 `fork-features.json` 和每次桌面构建的 manifest 中。 |

**语音输入设置位于“设置 → 语音输入”。** Deepgram 使用自己的 API 密钥和支持的语言选项；本地识别使用所选 Standard ASR 模型及其语言选项。安装插件不会自动下载模型。

**附件能力取决于模型。** 图片需要支持图像输入的模型；不兼容时，会在写入会话历史之前拒绝发送。PDF、文本和代码可通过对应的阅读工具读取。新建会话时，文字与附件引用一起保存在可恢复的草稿中，长消息与文件列表不会放入导航网址。

## 分支与预览

- **`main`**：跟踪原始仓库的 `main`，保持原版基线，不加入个人修改。
- **`feat/<topic>`**：按主题维护功能及明确声明的依赖。每个主题都在**这个 fork 内**保留一个以 `main` 为目标的比较 PR，用来长期查看差异；这些 PR 不合并进原版跟踪分支。
- **`fork-preview`**：合并当前上游基线与所有受管理主题。交付预览之前，必须通过完整性检查、测试和构建。
- **`archive/`**：在经过确认的分支整理中保留旧历史。

同步顺序为：原始仓库 → 这个 fork 的 `main` → 各主题分支 → `fork-preview`。个人版本的推送、PR 和 issue 全部留在 **`t41372/learnharness`** 内。即使把默认分支设为 `fork-preview`，原版跟踪分支仍然叫 `main`；同步时必须明确指定它。

完整的维护与验收要求见 [AGENTS.md](AGENTS.md)。

## 运行或构建这个版本

```sh
git clone --branch fork-preview https://github.com/t41372/learnharness.git
cd learnharness
npm ci
npm run dev        # http://localhost:3000
```

配置模型服务连接并选择模型后，就可以开始学习。对话、知识图谱、设置、附件和凭据保存在本地；模型服务、云端语音输入和网络研究仍会接收完成相应工作所需的数据。本地存储不代表所有处理都离线进行。

在 **Apple Silicon Mac** 上构建桌面版本：

```sh
npm run desktop:dist
```

请从干净且已提交的 `fork-preview` 执行。构建前会获取最新分支状态，缺少任何已登记功能时拒绝构建。产物包括：

- `dist/mac-arm64/LearnHarness.app`
- `dist/LearnHarness-<version>-arm64-mac.zip`
- `dist/fork-preview-manifest.json`：记录上游、预览和各功能分支的提交。

这个 fork 目前通过本地构建和预览交付，不依赖发布或 App 自动更新流程。App 内置的更新来源只指向**这个 fork**，以便将来的预览构建保留个人功能。

## 学习方式

1. **了解起点**：根据你的回答、把握程度和推理，判断理解从哪里开始出现缺口。
2. **规划**：把起点到目标之间需要的推理步骤组织起来。
3. **教学**：通过预测、解释和检查逐步建立理解。
4. **练习与复习**：在不同题目中运用知识，再通过复习队列重新巩固。

“你的思路”输入框让你用自己的话说明推理、困惑和反应。Agent 也可以开展研究、生成图示和交互演示。知识图谱持续积累命题与推理链，并保留它们与来源会话的联系。

![LearnHarness 知识图谱](docs/assets/knowledge-graph.png)

## 开发与反馈

参阅[开发文档](docs/development.md)、[架构文档](docs/architecture.md)、[附件说明](docs/attachments.md)和[桌面构建指南](docs/desktop-release.md)。关于这个个人版本的讨论，请使用[这个 fork 的 issue](https://github.com/t41372/learnharness/issues)。

## 许可证与来源

采用 [AGPL-3.0](LICENSE) 许可证。原始 LearnHarness 应用及文中的截图来自 [amosblomqvist/learnharness](https://github.com/amosblomqvist/learnharness)；本文说明的额外功能与 fork 维护工作保存在 [t41372/learnharness](https://github.com/t41372/learnharness)。
