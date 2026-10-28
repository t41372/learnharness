<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fork、主題分支與預覽維護

## 倉庫與分支角色

- 本 fork 是 `t41372/learnharness`（`origin`）；原始倉庫是 `amosblomqvist/learnharness`（`upstream`）。
- **所有推送、PR、issue 與工作紀錄都只留在本 fork。絕不向原始倉庫推送、開 PR 或 issue。** 讀取及 fetch 原始倉庫的提交是允許的。
- `main` 是原版追蹤分支，必須與選定的最新 `upstream/main` 完全相同。只允許 fast-forward 同步，不放個人提交、不合併 feature PR。
- `fork-preview` 是使用者日常使用、預覽及建置 App 的分支，也是預計的 GitHub 預設分支。更改 GitHub 預設分支不改變 `main` 的追蹤角色；同步一律明確指定 `main`，不可依賴 default branch。
- 使用者自行在 GitHub 更改 default branch，Agent 不代為變更。

## 長期主題分支與比較 PR

- 主題清單與必要依賴由 `fork-features.json` 管理。所有要保留的個人功能與維護改動都必須有來源主題分支，包括圖像／附件、FSRS、Standard ASR、i18n、agent instructions、桌面建置及 fork 維護規則。
- 分支按長期話題組織。所有 Standard ASR 改動更新 `feat/standard-asr-dictation`；所有翻譯與後續上游新增文字更新 `feat/i18n`；其他主題同理。臨時子分支完成後回到對應主題分支，不建立另一份平行的同主題來源。
- 每個主題分支在 **`t41372/learnharness` 內**保留一個 open、base 明確為 `main` 的比較 PR，讓差異、目的、驗證與上游關係可追蹤。即使 default branch 是 `fork-preview`，也必須指定 base `main`。
- 比較 PR 不合進 `main`，整合進 preview 後也不關閉、不刪除來源分支。需要額外的整合 PR 時，其 base 才是 `fork-preview`。
- 主題從原版基線建立，只包含該主題的提交與明確記錄的必要依賴，不從整個 preview 分出來夾帶無關功能。跨主題翻譯屬於 i18n 主題，功能本身留在其主題。
- 同步既有主題時優先 merge 更新後的 `main`，保留歷史。已發布分支的 rebase／重寫需先獲使用者同意，保留 `archive/` 備份並使用明確舊 SHA 的 `--force-with-lease`；不得覆蓋未知的新提交。
- 提交遵守 Conventional Commits；程式碼應易於閱讀與維護。

## fork-preview 的驗收條件

`fork-preview` 必須等於「當前上游版本合併所有受管理主題的最新版本後的樣子」。成功合併、測試與建置的結果，就是該組上游與主題提交可共同整合的實證。

- 交付時 `origin/main`、本機 `main`（若存在）與剛 fetch 的 `upstream/main` 必須指向同一提交。
- `fork-features.json` 中每個來源分支的最新本機／遠端 head 必須一致，且全部已成為 preview 的祖先；不得漏掉只存在遠端的更新。新出現但未登記的 `feat/` 分支必須先釐清，不能默默忽略。
- 產品功能修正必須先回到主題分支，再合併 preview。preview 的 merge commit 可以記錄保留雙方意圖的衝突整合，不可成為遺漏來源主題的功能開發分支。
- 合併後必須通過受影響主題測試、typecheck、lint、完整測試與正式編譯，並驗證打包後的伺服器、圖像／附件輸入、FSRS 與 ASR 修正。既有或環境失敗必須列出，不能宣稱全通過。
- 預覽與 App 建置使用最新已提交的 `fork-preview`；執行 `node scripts/verify-fork-preview.mjs --fetch` 驗證來源完整性，建置清單保存於 `dist/fork-preview-manifest.json`。檢查失敗不得交付舊產物假裝是完整 preview。

## 定期同步順序

1. 確認所有工作目錄狀態並保存現有工作；fetch `origin` 與 `upstream/main`，比較新提交、版本、安全及相依變更。
2. 將本 fork 的 `main` fast-forward 到 `upstream/main`，再推送到 **origin**。本機 `main` 有個人提交時先停下釐清，不用 reset 丟棄。
3. 按清單的依賴順序，把新 `main` 更新到每個主題；解決衝突、補齊新文字翻譯、保留個人功能及設定，在各自主題驗證並更新 fork 內的比較 PR。
4. 將全部最新主題合併到 `fork-preview`，驗證來源完整性與功能，記錄上游 SHA、各主題 SHA、衝突處理與驗證結果，再推送及建置供使用者使用。
5. 上游、任一主題或依賴再次更新，就重做對應主題與 preview 的驗證；不得只按分支名稱認定產物已包含所有功能。

## 本機建置與 App 更新

- 目前交付以本機建置與預覽為主，不主動啟用發布流程或 App 自動更新。`npm run desktop:dist` 使用 ad hoc 簽名、跳過公證及 DMG、明確 `--publish never`。
- App 的更新來源只能指向 `t41372/learnharness`，絕不能下載或安裝原始倉庫的 release。未來若啟用發布／自動更新，其產物也必須通過上述 preview 驗收；方式另行確認。
- Git 上游同步與 App 下載安裝更新是兩個獨立流程。

# No guessing

All design authority belongs to the human. **Never guess a design or implementation decision.** If anything is ambiguous — naming, behavior, data shapes, UX, defaults, scope boundaries, prompt wording — STOP and ask with the ask-user-question tool before proceeding. If you are "a little unsure," you are unsure: ask. A wrong guess is far more expensive than a question. Ask early, ask specific, one question per call.

Concretely: first investigate and plan rigorously (asking the user design questions along the way), get the plan approved by the user, and only then implement. Implementation should be mechanical execution of an approved plan — not interpretation.
