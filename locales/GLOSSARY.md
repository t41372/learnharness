# Interface glossary

The interface ships in English (the reference), Simplified Chinese (`zh-CN`) and Traditional Chinese (`zh-TW`). Keys live in `locales/<lang>/<namespace>.json`; `tests/i18n-locales.test.ts` checks that every language has exactly the English keys and the same `{{variables}}`.

## Rules

- Translate meaning, not words. Write what a native speaker would put on that button or in that tooltip.
- `zh-CN` uses mainland vocabulary, `zh-TW` uses Taiwan vocabulary. Converting one into the other character by character is not enough: 设置/設定, 文件/檔案, 文件夹/資料夾, 程序/程式, 窗口/視窗, 默认/預設, 链接/連結, 消息/訊息, 搜索/搜尋, 视频/影片, 质量/品質, 信息/資訊, 屏幕/螢幕, 打开/開啟, 保存/儲存, 删除/刪除, 加载/載入, 网络/網路, 支持/支援, 用户/使用者.
- Punctuation in Chinese is full width (，。：；！？「」（）), except inside code, keyboard shortcuts, numbers with units, and around ASCII-only fragments. `zh-CN` quotes with “”, `zh-TW` with 「」.
- Put one space between Chinese and Latin letters or digits, including a `{{variable}}` that holds a number or a Latin name: `{{count}} 个节点`, `Deepgram 密钥`, `导出为 Markdown…`. No space next to full-width punctuation, and none around a variable that holds Chinese text (`{{slot}}模型`).
- Keep product and provider names, model ids, file names, keyboard keys and code in English: LearnHarness, OpenRouter, Deepgram, ChatGPT, Standard ASR, `mermaid`, ⌘K.
- Keep `{{variables}}` exactly. Plurals: English has `_one` and `_other`; Chinese has only `_other`.

## Terms

| English | zh-CN | zh-TW |
| --- | --- | --- |
| session (a lesson with the teacher) | 会话 | 對話 |
| new session | 新建会话 | 新增對話 |
| practice / practice session | 练习 | 練習 |
| problem / problem set | 题目 / 题组 | 題目 / 題組 |
| quiz (graded question) | 测验 | 測驗 |
| question | 问题 | 問題 |
| answer | 回答 | 回答 |
| your thinking (the learner's reasoning field) | 你的思路 | 你的思路 |
| confidence | 把握程度 | 把握程度 |
| teacher | 老师 | 老師 |
| probe / prober (the first, measuring phase) | 摸底 / 摸底老师 | 前測 / 前測老師 |
| planning (phase) | 规划 | 規劃 |
| recall (free-recall quiz) | 回忆 | 回想 |
| brief (a research result) | 摘要 | 摘要 |
| figure (a visual) | 图示 | 圖示 |
| plan / plan tree | 计划 / 计划树 | 計畫 / 計畫樹 |
| step (of the plan) | 步骤 | 步驟 |
| knowledge graph / graph | 知识图谱 / 图谱 | 知識圖譜 / 圖譜 |
| node | 节点 | 節點 |
| proposition | 命题 | 命題 |
| reasoning chain / chain | 推理链 / 链 | 推理鏈 / 鏈 |
| premise / conclusion | 前提 / 结论 | 前提 / 結論 |
| cluster | 分组 | 分組 |
| extraction (graph building) | 提取 | 擷取 |
| notes / import notes | 笔记 / 导入笔记 | 筆記 / 匯入筆記 |
| agent | Agent | Agent |
| model | 模型 | 模型 |
| provider | 服务商 | 供應商 |
| Settings → Providers (where keys live) | 设置 → 服务商 | 設定 → 供應商 |
| API key / key | API 密钥 / 密钥 | API 金鑰 / 金鑰 |
| subscription | 订阅 | 訂閱 |
| thinking level | 思考强度 | 思考強度 |
| strong / cheap / vision (model slots) | 主力 / 经济 / 视觉 | 主力 / 經濟 / 視覺 |
| research / researcher | 研究 / 研究员 | 研究 / 研究員 |
| demo | 演示 | 示範 |
| visual | 图示 | 圖示 |
| job (background work) | 任务 | 任務 |
| activity | 活动 | 活動 |
| steer (a message to the running agent) | 引导 | 引導 |
| compaction | 压缩 | 壓縮 |
| context | 上下文 | 上下文 |
| tokens | token | token |
| cost | 费用 | 費用 |
| dictation / dictate | 语音输入 | 語音輸入 |
| settings | 设置 | 設定 |
| appearance | 外观 | 外觀 |
| keyboard shortcut | 快捷键 | 快速鍵 |
| sidebar | 侧栏 | 側欄 |
| search | 搜索 | 搜尋 |
| find (in page) | 查找 | 尋找 |
| rename | 重命名 | 重新命名 |
| delete | 删除 | 刪除 |
| cancel | 取消 | 取消 |
| save | 保存 | 儲存 |
| retry | 重试 | 重試 |
| loading… | 加载中… | 載入中… |
| stop | 停止 | 停止 |
| send / submit | 发送 / 提交 | 傳送 / 送出 |
| update (app) | 更新 | 更新 |
