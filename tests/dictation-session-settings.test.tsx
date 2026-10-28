import React, { act } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { useDictation } from "../components/dictation.tsx";
import { notifySettingsSaved } from "../components/settings-signal.ts";

test("saving dictation settings refreshes the session on the already mounted composer", async () => {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	Object.assign(globalThis, {
		React, window: dom.window, document: dom.document, CustomEvent: dom.window.CustomEvent,
		IS_REACT_ACT_ENVIRONMENT: true,
	});
	const originalFetch = globalThis.fetch;
	let sessions = 0;
	globalThis.fetch = async (url) => {
		assert.equal(url, "/api/stt/session");
		sessions++;
		return Response.json({ engine: "deepgram", token: `session-${sessions}` });
	};
	function Composer() {
		useDictation({ append: () => {} });
		return null;
	}
	const root = createRoot(document.getElementById("root")!);
	try {
		await act(async () => root.render(<Composer />));
		assert.equal(sessions, 1);
		await act(async () => notifySettingsSaved("dictation"));
		assert.equal(sessions, 2, "the next run uses a freshly resolved engine, model and language");
		await act(async () => notifySettingsSaved("appearance"));
		assert.equal(sessions, 2, "unrelated settings keep the warm session");
	} finally {
		await act(async () => root.unmount());
		globalThis.fetch = originalFetch;
	}
});
