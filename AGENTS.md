<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fork、分支與上游同步

## 倉庫定位

本倉庫是原始專案的個人 fork，主要服務使用者自己的需求：

- 本 fork：`t41372/learnharness`（`origin`）。
- 原始倉庫：`amosblomqvist/learnharness`（`upstream`），用於讀取、比較及同步原始專案的更新。
- **不向原始倉庫提交任何 issue 或 PR，也不推送到原始倉庫。** 此規則包含代使用者提交、回報或提出功能建議。
- 目前不以上游接受 PR 為目標，也不主動進行向上游提案、開 PR 或追蹤合併的工作。保留日後貢獻的可能性即可；個人需求優先。

## 個人整合分支與功能分支

- 保留一個包含所有個人改動的整合分支，供使用者日常使用、預覽及建置 App。目前是 `integration/i18n-instructions-asr`；本文件中的 integration／preview 都指這類個人整合分支。
- 主要功能及可獨立描述的改進，應各自保留在範圍清楚的 feature branch。提交與改動應便於獨立理解、維護及移植，方便未來需要時整理成上游貢獻。
- 要交付給使用者使用的功能，應整合到個人 integration／preview 分支；該分支應包含所有要保留的個人功能與修正。
- 可以依任務需要，從本 fork 的 feature branch 向**本 fork 的 integration／preview 分支**開 PR，作為功能目的、改動範圍、驗證結果及更新狀態的紀錄。這不代表要向原始倉庫開 PR，也不是每項修改都必須開 PR。
- 提交遵守 Conventional Commits。整合版預覽及 App 建置前，確認使用的是個人整合分支的最新已提交版本。

## 定期同步原始專案

- Agent 應定期檢查原始倉庫的提交、版本及安全修正，評估並安排同步，避免 fork 長期脫離上游。
- 同步前先比較上游與個人整合分支的差異、相依變更、衝突及行為影響；需要產品或設計取捨時，遵守下方的 No guessing 規則。
- 同步必須保留本 fork 的個人功能及設定。處理衝突時整合雙方意圖，避免直接覆蓋或重設而丟棄 fork 改動。
- 同步完成後記錄採用的上游版本／提交、重要衝突處理及驗證結果；驗證受影響的個人功能，再整合回 integration／preview。
- 從原始倉庫同步程式碼，與 App 從網路下載並安裝更新，是兩件不同的事。

## 發布與 App 自動更新

- 本 fork 目前供使用者自己使用，暫時不建立、啟用或依賴發布流程與 App 自動更新。交付以個人整合分支的本機建置及預覽為主。
- **本 fork 的 App 不應自動下載或安裝原始倉庫的發行版**，以免個人功能被原版覆蓋。同步上游設定時也必須維持此政策。
- 未來若使用者決定啟用自動更新，來源應是本 fork 的 integration／preview 分支所建置的產物；發布及更新方式屆時另行確認。

# No guessing

All design authority belongs to the human. **Never guess a design or implementation decision.** If anything is ambiguous — naming, behavior, data shapes, UX, defaults, scope boundaries, prompt wording — STOP and ask with the ask-user-question tool before proceeding. If you are "a little unsure," you are unsure: ask. A wrong guess is far more expensive than a question. Ask early, ask specific, one question per call.

Concretely: first investigate and plan rigorously (asking the user design questions along the way), get the plan approved by the user, and only then implement. Implementation should be mechanical execution of an approved plan — not interpretation.
