/**
 * The graph namespace in Chinese (i18n wave, 2026-10-25): the graph
 * chrome, the chain table, the node-delete dialog and the coverage block
 * render in the provider's language — mainland vocabulary for zh-CN,
 * Taiwan vocabulary for zh-TW — while user data (node names, session
 * titles) stays as written. Without a provider every surface keeps the
 * English reference (the render suites pin it).
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, i18n } from "../components/i18n/index.ts";
import type { Language } from "../src/core/language.ts";
import { GraphChromeRow } from "../components/graph-view.tsx";
import type { GraphRenderSettings } from "../components/graph-canvas.ts";
import { ChainTableBody, type ChainSort } from "../components/chain-table.tsx";
import { DeleteNodeBody } from "../components/delete-node-dialog.tsx";
import { CoverageMenuBody, type SessionCoverage } from "../components/extraction-coverage.tsx";
import { parseNotesImportResults } from "../components/notes-import.tsx";
import type { GraphChain, GraphNode } from "../src/core/contracts.ts";

function inLanguage(language: Language, element: React.ReactElement): string {
	return renderToStaticMarkup(
		<I18nProvider setting={language} language={language}>
			{element}
		</I18nProvider>,
	);
}

const ref = { current: null };
const chrome = (
	<GraphChromeRow
		isEmpty={false}
		query="zzz"
		onQuery={() => {}}
		noMatch
		importing={false}
		searchInputRef={ref}
		fileInputRef={ref}
		onImportFiles={() => {}}
		settings={{} as GraphRenderSettings}
		changeSettings={() => {}}
		onOpenChains={() => {}}
	/>
);

function node(id: string, name: string, chatId: string): GraphNode {
	return {
		id,
		name,
		statement: `Statement ${id}.`,
		aliases: [] as string[],
		state: "new",
		createdAt: "2026-09-20T10:00:00.000Z",
		provenance: [{ chatId, messageId: `m_${id}` }],
	} as unknown as GraphNode;
}
const NODES = [node("a", "Premise one", "chat1"), node("c", "Conclusion", "chat1")];
const CHAINS: GraphChain[] = [
	{ id: "c", premises: ["a"], conclusion: "c", provenance: [], createdAt: "2026-09-20T10:00:00.000Z" },
] as GraphChain[];
const chainTable = (
	<ChainTableBody
		nodes={NODES}
		chains={CHAINS}
		sessions={{ chat1: "Ethics lesson" }}
		fileSources={{}}
		query=""
		onQuery={() => {}}
		sort={{ col: "name", dir: 1 } as ChainSort}
		onSort={() => {}}
		selection={new Set(["a", "c"])}
		expandedClusters={new Set(["chat1"])}
		expandedChains={new Set()}
		onToggleCluster={() => {}}
		onToggleChain={() => {}}
		onToggleNodes={() => {}}
		onClear={() => {}}
		onDelete={() => {}}
		onClose={() => {}}
	/>
);

const deleteBody = (
	<DeleteNodeBody
		nodes={[{ id: "a", name: "Kepler's three laws" }, { id: "b", name: "Hooke's law" }]}
		busy={false}
		failure={{ code: "extraction_running", error: "server line" }}
		onClose={() => {}}
		onRun={() => {}}
	/>
);

const coverage: SessionCoverage = {
	totalMessages: 12,
	coveredCount: 7,
	uncoveredCount: 5,
	coveredTokens: 30_000,
	uncoveredTokens: 2_000,
	running: false,
	lastFoldedAt: null,
};
const coverageBody = <CoverageMenuBody coverage={coverage} extracting={false} onExtract={() => {}} />;

describe("graph namespace — Simplified Chinese", () => {
	it("the graph chrome: search, chains, import", () => {
		const html = inLanguage("zh-CN", chrome);
		assert.ok(html.includes("搜索节点…"));
		assert.ok(html.includes("没有匹配的节点。"));
		assert.ok(html.includes("推理链"));
		assert.ok(html.includes("导入笔记…"));
		assert.ok(!html.includes("Import notes…"));
	});
	it("the chain table: counts, columns, the selection bar; names stay data", () => {
		const html = inLanguage("zh-CN", chainTable);
		assert.ok(html.includes("1 条链 · 2 个节点"));
		assert.ok(html.includes("名称") && html.includes("创建时间"));
		assert.ok(html.includes("2 个节点 → 1 条链"));
		assert.ok(html.includes('aria-label="删除选中的 2 个节点"'));
		assert.ok(html.includes("Ethics lesson"), "the session title is user data");
	});
	it("the delete dialog: title, permanence, the known 409 line", () => {
		const html = inLanguage("zh-CN", deleteBody);
		assert.ok(html.includes("删除 2 个节点？"));
		assert.ok(html.includes("这将永久删除全部 2 个节点，且无法撤销。"));
		assert.ok(html.includes("活动面板"));
		assert.ok(!html.includes("server line"));
		assert.ok(html.includes("Kepler&#x27;s three laws"));
	});
	it("the coverage block", () => {
		const html = inLanguage("zh-CN", coverageBody);
		assert.ok(html.includes("2k token 未覆盖"));
		assert.ok(html.includes("5 条消息未提取"));
		assert.ok(html.includes(">提取</button>"));
	});
});

describe("graph namespace — Traditional Chinese (Taiwan vocabulary)", () => {
	it("the graph chrome", () => {
		const html = inLanguage("zh-TW", chrome);
		assert.ok(html.includes("搜尋節點…"));
		assert.ok(html.includes("匯入筆記…"));
		assert.ok(html.includes("推理鏈"));
	});
	it("the chain table", () => {
		const html = inLanguage("zh-TW", chainTable);
		assert.ok(html.includes("1 條鏈 · 2 個節點"));
		assert.ok(html.includes("建立時間"));
	});
	it("the delete dialog and the coverage block", () => {
		assert.ok(inLanguage("zh-TW", deleteBody).includes("刪除 2 個節點？"));
		const html = inLanguage("zh-TW", coverageBody);
		assert.ok(html.includes("5 則訊息未擷取"));
		assert.ok(html.includes(">擷取</button>"));
	});
});

describe("notes-import copy outside React", () => {
	it("defaults to the English reference; a passed t speaks its language", () => {
		assert.throws(() => parseNotesImportResults({ results: [] }, [new File(["x"], "a.md")]), /Please retry the file/);
		assert.throws(
			() => parseNotesImportResults({ results: [] }, [new File(["x"], "a.md")], i18n.getFixedT("zh-TW", "graph")),
			/匯入回應無效/,
		);
	});
});
