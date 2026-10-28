# LearnHarness — t41372's personal fork

[简体中文](README.zh-CN.md) · [Original project](https://github.com/amosblomqvist/learnharness) · [Development guide](docs/development.md)

This is **t41372's personally modified and maintained version of LearnHarness**, originally created by [amosblomqvist](https://github.com/amosblomqvist/learnharness). It combines the upstream learning application with the additional features below. `fork-preview` is the version I use and build locally.

LearnHarness uses AI agents to measure your understanding, plan lessons, teach through reasoning and questions, and provide practice. A persistent knowledge graph carries propositions and reasoning chains between sessions.

![LearnHarness teaching session](docs/assets/teaching-session.png)

## What's added in this fork

| Topic | Additional behavior |
| --- | --- |
| Interface languages | English, Simplified Chinese, and Traditional Chinese, selectable in Settings → General. |
| Learner instructions | Your instructions in Settings → Agent reach the learning agents, including preferences such as response language. |
| Local dictation | Standard ASR plugins and local models alongside Deepgram. Plugin installation, model selection, and model downloads are explicit; changing the selected engine or model refreshes the next dictation session. |
| Spaced repetition | FSRS scheduling, due/upcoming review queues, resumable Practice reviews, and self-ratings after completed problems. |
| Images and attachments | Paste, drop, or select images, PDFs, text, and source-code files in conversations, questions, and Practice. File-only input is supported; bytes stay in a local attachment store. Up to 10 files per message, 20 MB each. |
| Local desktop builds | macOS Apple Silicon App and ZIP with ad hoc signing, no notarization, and no publishing. Builds verify that all registered features and the current upstream baseline are present. |
| Fork maintenance | Long-lived topic branches, comparison PRs within this fork, and a complete combined preview. The source set is recorded in `fork-features.json` and each desktop build's manifest. |

**Dictation settings live in Settings → Dictation.** Deepgram uses its API key and documented language choices. Local recognition uses the selected Standard ASR model and its language choices. Installing a plugin does not automatically download a model.

**Attachment compatibility depends on the model.** Images require an image-capable model; incompatible selections are refused before the input is added to conversation history. PDF and text/code content remains available through the corresponding reading tools. Text and attachment references travel together through the recoverable new-session draft; long messages and file lists do not go in the navigation URL.

## Branches and previews

- **`main`** mirrors the original repository's `main`, without this fork's personal changes.
- **`feat/<topic>`** branches maintain individual topics and any declared dependencies. Each has a comparison PR targeting **this fork's `main`**. These PRs remain open for tracking rather than being merged into the mirror.
- **`fork-preview`** combines the current upstream baseline and every maintained topic. It must pass the completeness check, tests, and build before being delivered as a preview.
- **`archive/`** retains previous branch histories when an approved migration needs them.

Updates flow from upstream → this fork's `main` → topic branches → `fork-preview`. All pushes, PRs, and issues for this personal version stay in **`t41372/learnharness`**. Changing the default branch to `fork-preview` leaves the mirror's name as `main`; synchronization must explicitly select `main`.

The full maintenance and validation rules are in [AGENTS.md](AGENTS.md).

## Run or build this version

```sh
git clone --branch fork-preview https://github.com/t41372/learnharness.git
cd learnharness
npm ci
npm run dev        # http://localhost:3000
```

Configure your provider connection and models, then start a session. Your conversations, graph, settings, attachments, and credentials are stored locally. Model providers, cloud dictation, and web research still receive the data needed for those services; local storage does not imply fully offline operation.

For a local **macOS Apple Silicon** build:

```sh
npm run desktop:dist
```

Run it from a clean, committed `fork-preview`. The prebuild check fetches the current branch heads and refuses incomplete previews. Outputs include:

- `dist/mac-arm64/LearnHarness.app`
- `dist/LearnHarness-<version>-arm64-mac.zip`
- `dist/fork-preview-manifest.json`, recording the upstream, preview, and feature commits.

This fork currently uses local builds and previews for delivery. Release publishing and automatic-update delivery are not part of that workflow. The embedded update source targets **this fork**, preserving the personal features in future preview builds.

## How learning works

1. **Measure:** establish where understanding ends using your answers, confidence, and reasoning.
2. **Plan:** map the reasoning steps between that starting point and the goal.
3. **Teach:** build each step through predictions, explanations, and checks.
4. **Practice and review:** apply the knowledge in varied problems, then revisit it through the review queue.

The thinking fields let you explain uncertainties and reactions in your own words. The agent can research questions, produce visual explanations, and create interactive demonstrations. Propositions and reasoning chains accumulate in the knowledge graph, with links back to their source sessions.

![LearnHarness knowledge graph](docs/assets/knowledge-graph.png)

## Development and feedback

See the [development guide](docs/development.md), [architecture](docs/architecture.md), [attachment documentation](docs/attachments.md), and [desktop build guide](docs/desktop-release.md). Use [this fork's issues](https://github.com/t41372/learnharness/issues) for discussion of this personal version.

## License and attribution

[AGPL-3.0](LICENSE). The original LearnHarness application and included screenshots come from [amosblomqvist/learnharness](https://github.com/amosblomqvist/learnharness); the additional features and fork maintenance described here are maintained in [t41372/learnharness](https://github.com/t41372/learnharness).
