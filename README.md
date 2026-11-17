# LearnHarness — t41372's personal fork

[简体中文](README.zh-CN.md) · [Original project](https://github.com/amosblomqvist/learnharness) · [Documentation](docs/README.md) · [Development guide](docs/development.md)

This is **t41372's personally modified and maintained version of LearnHarness**, originally created by [amosblomqvist](https://github.com/amosblomqvist/learnharness). It combines the upstream learning application with the additional features below. `fork-preview` is the version I use and build locally.

LearnHarness uses AI agents to measure your understanding, plan lessons, teach through reasoning and questions, and provide practice. A persistent knowledge graph carries propositions and reasoning chains between sessions.

![LearnHarness teaching session](docs/assets/teaching-session.png)

## What's added in this fork

| Topic | Additional behavior |
| --- | --- |
| Interface languages | English, Simplified Chinese, and Traditional Chinese, selectable in Settings → General. |
| Learner instructions | Your instructions in Settings → Agent reach every agent — teaching, practice, side questions, background work and plugins — including preferences such as response language. |
| Local dictation | Standard ASR plugins and local models alongside Deepgram. Plugin installation, model selection, and model downloads are explicit; changing the selected engine or model refreshes the next dictation session. |
| Pasted images | Paste images — screenshots included — into messages, steering, question and Practice answers, and thinking fields; in the browser, drop or select them too. They go straight into the model's context, image-only input is supported, and unsent images survive a reload. Desktop file attachments use the upstream paperclip and path chips. |
| Local desktop builds | macOS Apple Silicon App and ZIP with ad hoc signing, no notarization, and no publishing. Builds verify that all registered features and the current upstream baseline are present. |
| Fork maintenance | Long-lived topic branches, comparison PRs within this fork, and a complete combined preview. The source set is recorded in `fork-features.json` and each desktop build's manifest. |

**Dictation settings live in Settings → Dictation.** Deepgram uses its API key and documented language choices. Local recognition uses the selected Standard ASR model and its language choices. Installing a plugin does not automatically download a model.

**Pasted images need an image-capable model.** Otherwise the input is refused and kept, before anything is added to the conversation. In the browser, files other than images need the desktop app's paperclip or a pasted full path.

**Spaced repetition comes from upstream.** The optional Flashcards core plugin schedules reviews of knowledge-graph propositions with FSRS; enable it under Settings → Core plugins. This fork's earlier review queue was retired in its favour.

## Branches and previews

- **`main`** mirrors the original repository's `main`, without this fork's personal changes.
- **`feat/<topic>`** branches maintain individual topics and any declared dependencies. Each has a comparison PR targeting **this fork's `main`**. These PRs remain open for tracking rather than being merged into the mirror.
- **`fork-preview`** combines the current upstream baseline and every maintained topic. It must pass the completeness check, tests, and build before being delivered as a preview.
- **`archive/`** retains previous branch histories when an approved migration needs them, and topics retired because upstream replaced them.

Updates flow from upstream → this fork's `main` → topic branches → `fork-preview`. All pushes, PRs, and issues for this personal version stay in **`t41372/learnharness`**. Changing the default branch to `fork-preview` leaves the mirror's name as `main`; synchronization must explicitly select `main`.

The full maintenance and validation rules are in [AGENTS.md](AGENTS.md).

## Run or build this version

```sh
git clone --branch fork-preview https://github.com/t41372/learnharness.git
cd learnharness
npm ci
npm run plugins:setup
npm run dev        # http://localhost:3000
```

Configure your provider connection and models, then start a session. Your conversations, graph, settings, attachments, and credentials are stored locally. Model providers, cloud dictation, and web research still receive the data needed for those services; local storage does not imply fully offline operation.

For a local **macOS Apple Silicon** build:

```sh
npm run desktop:dist
```

Run it from a clean, committed `fork-preview`. It clears `dist`, then its check fetches the current branch heads and refuses incomplete previews before compiling. Outputs include:

- `dist/mac-arm64/LearnHarness.app`
- `dist/LearnHarness-<version>-arm64-mac.zip`
- `dist/fork-preview-manifest.json`, recording the upstream, preview, and feature commits.

This fork currently uses local builds and previews for delivery. Release publishing and automatic-update delivery are not part of that workflow. The embedded update source targets **this fork**, preserving the personal features in future preview builds.

## How learning works

1. **Measure:** establish where understanding ends using your answers, confidence, and reasoning.
2. **Plan:** map the reasoning steps between that starting point and the goal.
3. **Teach:** build each step through predictions, explanations, and checks.
4. **Practice:** apply the knowledge in varied problems; the Flashcards plugin can schedule later reviews.

The thinking fields let you explain uncertainties and reactions in your own words. The agent can research questions, produce visual explanations, show and annotate your own images, and create interactive demonstrations. Propositions and reasoning chains accumulate in the knowledge graph, with links back to their source sessions.

![LearnHarness knowledge graph](docs/assets/knowledge-graph.png)

## Development and feedback

See the [documentation index](docs/README.md), [development guide](docs/development.md), [architecture](docs/architecture.md), [attachment documentation](docs/attachments.md), and [desktop build guide](docs/desktop-release.md). Use [this fork's issues](https://github.com/t41372/learnharness/issues) for discussion of this personal version.

## License and attribution

[AGPL-3.0](LICENSE). The original LearnHarness application and included screenshots come from [amosblomqvist/learnharness](https://github.com/amosblomqvist/learnharness); the additional features and fork maintenance described here are maintained in [t41372/learnharness](https://github.com/t41372/learnharness).
