/**
 * Pasted-image layer (feat/message-attachments): the staged-image store, its
 * persistence seam (an in-memory fake stands in for IndexedDB), paste,
 * browser drop/pick, and the unchanged desktop paperclip. Same linkedom
 * shims as composer-attach.test.tsx.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { detectSupportedImageMimeType } from "../src/agent/image-processing/mime.mjs";
import {
	MAX_STAGED_IMAGES, MAX_STAGED_IMAGE_BYTES, StagedImageStore, detectStagedImageMimeType, encodeBase64, handOverOpeningImages,
	memoryStagedImageStorage, OPENING_IMAGE_KEY, stagedImageKey, stagedImages, stagePastedFiles,
} from "../components/staged-images.ts";
import { StagedImageStrip } from "../components/staged-image-strip.tsx";
import { IMAGE_TARGET, encodingOrder, fitStagedImage, fitWithin, type EncodedType, type ImageCodec } from "../components/staged-image-resize.ts";
import { SUBMISSION_IMAGE_BUDGET, submissionDraftKeys } from "../components/staged-images.ts";
import nextConfig from "../next.config.ts";
import { Composer } from "../components/composer.tsx";
import { FilePathDropZone } from "../components/file-path-drop-zone.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import { quoteFilePath } from "../src/core/file-paths.ts";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1];
const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap(part => typeof part === "string" ? [...part].map(char => char.charCodeAt(0)) : part));
const png = (name = "shot.png", extra = 0) => new File([bytes(PNG, new Array(extra).fill(7))], name, { type: "image/png" });
const pdf = (name = "notes.pdf") => new File(["%PDF-1.7"], name, { type: "application/pdf" });
/** A size claim only: limits are enforced before any bytes are read. */
const huge = (name = "huge.png") => Object.defineProperties(png(name), { size: { value: MAX_STAGED_IMAGE_BYTES + 1 }, arrayBuffer: { value: () => { throw new Error("oversized bytes must not be read"); } } });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("client byte check", () => {
	it("accepts exactly what server admission accepts for the transport's four formats", () => {
		const samples = {
			png: bytes(PNG), apng: bytes(PNG.slice(0, 8), [0, 0, 0, 8], "acTL"), jpeg: bytes([0xff, 0xd8, 0xff, 0xe0]), jpegLs: bytes([0xff, 0xd8, 0xff, 0xf7]),
			gif87: bytes("GIF87a"), gif89: bytes("GIF89a"), webp: bytes("RIFF", [0, 0, 0, 0], "WEBP"),
			bmp: bytes("BM", [70, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 24, 0, 0, 0]), text: bytes("hello"),
		};
		for (const [name, sample] of Object.entries(samples)) {
			// prepareSubmissionImages: the sniffer, else any PNG signature; the
			// transport itself carries only PNG/JPEG/WebP/GIF.
			const server = detectSupportedImageMimeType(Buffer.from(sample)) ?? (Buffer.from(sample).subarray(0, 8).equals(Buffer.from(PNG.slice(0, 8))) ? "image/png" : null);
			const transported = server && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(server) ? server : null;
			assert.equal(detectStagedImageMimeType(sample), transported, name);
		}
	});
	it("encodes canonical base64", () => {
		const sample = new Uint8Array(70_000).map((_, index) => index % 251);
		assert.equal(encodeBase64(sample), Buffer.from(sample).toString("base64"));
	});
});

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
/** Bytes of a given length that the client sniffer accepts as this type. */
const encoded = (type: EncodedType, length: number) => { const out = new Uint8Array(length).fill(7); out.set(type === "image/png" ? PNG : JPEG_HEAD); return out; };
/** A decoder reporting fixed dimensions; `size` decides each encoding's length. */
function fakeCodec(width: number, height: number, size: (width: number, height: number, type: EncodedType, quality?: number) => number = () => 1000) {
	const calls: string[] = [];
	const codec: ImageCodec = { async decode() {
		return { width, height, close() {}, async encode(w, h, type, quality) { calls.push(`${w}x${h} ${type}${quality === undefined ? "" : ` ${quality}`}`); return encoded(type, size(w, h, type, quality)); } };
	} };
	return { codec, calls };
}
const failingCodec: ImageCodec = { decode: async () => { throw new Error("no decoder"); } };
const OVER = Math.ceil(IMAGE_TARGET.maxBytes / 4 * 3) + 10; // raw bytes whose base64 exceeds 4.5 MiB

describe("client downscale", () => {
	it("fits into 2000×2000 keeping the aspect ratio", () => {
		assert.deepEqual(fitWithin(4000, 1000), { width: 2000, height: 500 });
		assert.deepEqual(fitWithin(1000, 3000), { width: 667, height: 2000 });
		assert.deepEqual(fitWithin(5000, 5000), { width: 2000, height: 2000 });
	});

	it("stages images within the target byte for byte, animated GIFs included", async () => {
		for (const [type, input] of [["image/png", bytes(PNG)], ["image/gif", bytes("GIF89a", [1, 2, 3])]] as const) {
			const { codec, calls } = fakeCodec(2000, 1200);
			const result = await fitStagedImage(input, type, codec);
			assert.equal(result?.bytes, input, type);
			assert.equal(result?.mimeType, type);
			assert.deepEqual(calls, []);
		}
	});

	it("keeps PNG for a PNG that fits once scaled down", async () => {
		const { codec, calls } = fakeCodec(4000, 3000);
		const result = await fitStagedImage(bytes(PNG), "image/png", codec);
		assert.equal(result?.mimeType, "image/png");
		assert.deepEqual(calls, ["2000x1500 image/png"]);
	});

	it("falls back to JPEG at descending quality, then shrinks by 3/4 like the server", async () => {
		assert.deepEqual(encodingOrder("image/png").map(step => step.quality ?? "png"), ["png", 0.9, 0.85, 0.7, 0.55, 0.4]);
		assert.deepEqual(encodingOrder("image/webp").map(step => step.type), Array(5).fill("image/jpeg"));
		const { codec, calls } = fakeCodec(3000, 3000, (w, _h, type, quality) => w === 2000 && (type === "image/png" || quality! > 0.7) ? OVER : 1000);
		const result = await fitStagedImage(bytes(PNG), "image/png", codec);
		assert.deepEqual(calls, ["2000x2000 image/png", "2000x2000 image/jpeg 0.9", "2000x2000 image/jpeg 0.85", "2000x2000 image/jpeg 0.7"]);
		assert.equal(result?.mimeType, "image/jpeg");
		const shrinking = fakeCodec(2400, 1600, w => w === 2000 ? OVER : 1000);
		await fitStagedImage(bytes(JPEG_HEAD), "image/jpeg", shrinking.codec);
		assert.equal(shrinking.calls.length, 6, "five JPEG qualities at full size, no PNG for a JPEG source");
		assert.equal(shrinking.calls.at(-1), "1500x999 image/jpeg 0.9");
	});

	it("re-encodes small images whose bytes exceed 4.5 MiB; an animated GIF over the target becomes a still JPEG", async () => {
		const { codec, calls } = fakeCodec(800, 600);
		const result = await fitStagedImage(encoded("image/png", OVER), "image/png", codec);
		assert.deepEqual(calls, ["800x600 image/png"]);
		assert.equal(result?.bytes.byteLength, 1000);
		const gif = fakeCodec(2500, 2500);
		assert.equal((await fitStagedImage(bytes("GIF89a"), "image/gif", gif.codec))?.mimeType, "image/jpeg");
		assert.deepEqual(gif.calls, ["2000x2000 image/jpeg 0.9"]);
	});

	it("without a decoder, small bytes pass unchanged and large ones are refused", async () => {
		const small = bytes(PNG);
		assert.equal((await fitStagedImage(small, "image/png", failingCodec))?.bytes, small);
		assert.equal(await fitStagedImage(encoded("image/png", OVER), "image/png", failingCodec), null);
	});

	it("the store keeps only the downscaled result", async () => {
		const store = new StagedImageStore(memoryStagedImageStorage(), fakeCodec(6000, 4000, () => 2048).codec);
		const key = stagedImageKey("chat", "composer");
		await store.add(key, [png("camera.png")]);
		assert.deepEqual(store.get(key).images.map(image => [image.mimeType, image.size]), [["image/png", 2048]]);
	});
});

describe("per-submission request budget", () => {
	it("is the proxy body cap from next.config minus 1 MiB", () => {
		assert.equal(SUBMISSION_IMAGE_BUDGET + 1024 * 1024, nextConfig.experimental?.proxyClientMaxBodySize);
	});

	it("groups a question's answer, thinking and reading drafts; other drafts send alone", () => {
		const answer = stagedImageKey("c", "answer", "q/1");
		assert.deepEqual(submissionDraftKeys(answer), [answer, stagedImageKey("c", "thinking", "q/1"), stagedImageKey("c", "readingThinking", "q/1")]);
		assert.deepEqual(submissionDraftKeys(stagedImageKey("c", "composer")), [stagedImageKey("c", "composer")]);
		assert.deepEqual(submissionDraftKeys(stagedImageKey("c", "practiceThinking", "p")), [stagedImageKey("c", "practiceThinking", "p")]);
	});

	it("rejects the image that would push a combined submission over budget and keeps the others", async () => {
		// ~4.4 MiB of base64 each: within the target, so staged unchanged.
		const big = (name: string) => new File([encoded("image/jpeg", Math.floor(IMAGE_TARGET.maxBytes / 4 * 3) - 30_000)], name, { type: "image/jpeg" });
		const store = new StagedImageStore(memoryStagedImageStorage(), fakeCodec(1000, 1000).codec);
		const keys = (["answer", "thinking", "readingThinking"] as const).map(surface => stagedImageKey("c", surface, "q"));
		await store.add(keys[0]!, [big("a1"), big("a2")]);
		await store.add(keys[1]!, [big("t1"), big("t2")]);
		await store.add(keys[2]!, [big("r1"), big("r2")]);
		const total = keys.reduce((sum, key) => sum + store.get(key).images.reduce((size, image) => size + image.data.length, 0), 0);
		assert.ok(total <= SUBMISSION_IMAGE_BUDGET);
		assert.deepEqual(store.get(keys[2]!).images.map(image => image.name), ["r1"]);
		assert.deepEqual(store.get(keys[2]!).rejected.map(entry => [entry.name, entry.problem]), [["r2", "overBudget"]]);
		// A separate submission has its own budget.
		const composer = stagedImageKey("c", "composer");
		await store.add(composer, [big("m1")]);
		assert.equal(store.get(composer).images.length, 1);
	});
});

describe("staged image store", () => {
	it("stages, enforces the per-input limits inline, and persists only sendable images", async () => {
		const storage = memoryStagedImageStorage();
		const store = new StagedImageStore(storage);
		const key = stagedImageKey("chat", "composer");
		await store.add(key, [png("a.png"), huge(), new File([bytes("BM")], "b.bmp", { type: "image/bmp" })]);
		assert.deepEqual(store.get(key).images.map(image => [image.name, image.mimeType, image.data]), [["a.png", "image/png", encodeBase64(bytes(PNG))]]);
		assert.deepEqual(store.get(key).rejected.map(entry => [entry.name, entry.problem]), [["huge.png", "tooLarge"], ["b.bmp", "unsupported"]]);
		await store.add(key, Array.from({ length: MAX_STAGED_IMAGES }, (_, index) => png(`${index}.png`)));
		assert.equal(store.get(key).images.length, MAX_STAGED_IMAGES);
		assert.deepEqual(store.get(key).rejected.slice(2).map(entry => [entry.name, entry.problem]), [["9.png", "tooMany"]]);
		await store.flush();
		assert.equal(storage.records.get(key)?.length, MAX_STAGED_IMAGES, "rejections are never persisted");
	});

	it("a reload restores the draft from storage; acceptance clears only what was sent, refusal keeps it", async () => {
		const storage = memoryStagedImageStorage();
		const key = stagedImageKey("chat", "answer", "call_1");
		const first = new StagedImageStore(storage);
		await first.add(key, [png("one.png"), png("two.png")]);
		await first.flush();
		const reloaded = new StagedImageStore(storage);
		assert.equal(reloaded.get(key).images.length, 0, "hydration is lazy");
		const captured = await reloaded.capture(key);
		assert.deepEqual(captured.images, reloaded.get(key).images.map(({ mimeType, data }) => ({ type: "image", mimeType, data })));
		assert.equal(captured.images.length, 2);
		// Refusal: nothing is released.
		assert.equal(reloaded.get(key).images.length, 2);
		await reloaded.add(key, [png("while-sending.png")]);
		reloaded.release([captured]);
		assert.deepEqual(reloaded.get(key).images.map(image => image.name), ["while-sending.png"]);
		await reloaded.flush();
		assert.deepEqual(storage.records.get(key)?.map(image => image.name), ["while-sending.png"]);
		reloaded.remove(key, reloaded.get(key).images[0]!.id);
		await reloaded.flush();
		assert.equal(storage.records.has(key), false, "an emptied draft is deleted");
	});

	it("hands the opening draft to the created chat's composer", async () => {
		const storage = memoryStagedImageStorage();
		const store = new StagedImageStore(storage);
		await store.add(OPENING_IMAGE_KEY, [png("opening.png")]);
		await handOverOpeningImages("/chat/chat_abc-1", store);
		const target = stagedImageKey("chat_abc-1", "composer");
		assert.deepEqual(store.get(target).images.map(image => image.name), ["opening.png"]);
		assert.equal(store.get(OPENING_IMAGE_KEY).images.length, 0);
		assert.deepEqual([...storage.records.keys()], [target]);
	});

	it("paste stages images; a non-image file raises the browser notice; text-only clipboards do nothing", async () => {
		const store = new StagedImageStore(memoryStagedImageStorage());
		const key = stagedImageKey("chat", "composer");
		stagePastedFiles(key, { files: [] as unknown as FileList, items: [{ kind: "file", type: "image/png", getAsFile: () => png("clip.png") }] as unknown as DataTransferItemList }, store);
		await store.ready(key); await settle();
		assert.deepEqual(store.get(key).images.map(image => image.name), ["clip.png"]);
		stagePastedFiles(key, { files: [pdf()] as unknown as FileList, items: [] as unknown as DataTransferItemList }, store);
		assert.equal(store.get(key).notice, "browser");
		stagePastedFiles(key, { files: [] as unknown as FileList, items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] as unknown as DataTransferItemList }, store);
		assert.equal(store.get(key).notice, "");
		assert.equal(store.get(key).images.length, 1);
	});
});

describe("staged image strip", () => {
	it("renders nothing for an empty draft or no key", () => {
		assert.equal(renderToStaticMarkup(<StagedImageStrip draftKey={undefined} />), "");
		assert.equal(renderToStaticMarkup(<StagedImageStrip draftKey="empty" store={new StagedImageStore(memoryStagedImageStorage())} />), "");
	});
});

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

/** A mounted Composer with a staged-image draft, inside the real drop zone. */
async function fixture({ desktop = false, key = stagedImageKey(`ui-${Math.random()}`, "composer") } = {}) {
	const { window: win, document: doc } = parseHTML("<html><body><div id='root'></div></body></html>");
	let active: Element = doc.body;
	Object.defineProperty(doc, "activeElement", { get: () => active });
	const selection = { anchorNode: null as Node | null, anchorOffset: 0, focusNode: null as Node | null, focusOffset: 0,
		setBaseAndExtent(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number) { Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset }); } };
	Object.assign(doc, { getSelection: () => selection, oninput: null });
	win.HTMLElement.prototype.focus = function () { active = this; };
	win.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, right: 40, top: 600, bottom: 640, width: 40, height: 40, toJSON() {} });
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [name, next] of Object.entries({ React, window: win, document: doc, Node: win.Node, HTMLElement: win.HTMLElement, Element: win.Element, Event: win.Event, CustomEvent: win.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true, innerWidth: 1000, innerHeight: 800 })) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: next });
	}
	const backingPaths = new Map<File, string>();
	Object.defineProperty(win, "lh", { configurable: true, value: desktop ? { getPathForFile: (file: File) => backingPaths.get(file) ?? "", chooseAttachmentFolder: async () => null } : undefined });
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(doc.getElementById("root")!);
	let value = "";
	const draw = () => root.render(<InteractionLayersProvider><FilePathDropZone>
		<div data-attachment-composer=""><Composer busy={false} value={value} onChange={(next) => { value = next; draw(); }} onSend={() => {}} onStop={() => {}} canSend imageDraftKey={key} /></div>
		<div data-testid="elsewhere">Elsewhere</div>
	</FilePathDropZone></InteractionLayersProvider>);
	await act(async () => { draw(); });
	const picker = doc.querySelector<HTMLInputElement>('[data-testid="attach-files-input"]')!;
	let pickerClicks = 0;
	picker.click = () => { pickerClicks++; };
	cleanup = async () => {
		await act(async () => { root.unmount(); });
		for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; }
	};
	const editor = doc.querySelector<HTMLElement>("[data-file-path-input]")!;
	const flush = async () => { await act(async () => { await stagedImages.ready(key); await settle(); }); };
	return {
		doc, editor, key, backingPaths, flush,
		get value() { return value; },
		get pickerClicks() { return pickerClicks; },
		button: () => doc.querySelector<HTMLButtonElement>('[data-testid="attach-files"]')!,
		get status() { return Array.from(doc.querySelectorAll('[role="status"]')).map(node => node.textContent).join(" | "); },
		thumbnails: () => Array.from(doc.querySelectorAll('[data-testid="staged-image"] img')).map(img => img.getAttribute("alt")),
		async paste(text: string, files: File[]) {
			const clipboardData = { getData: (type: string) => type === "text/plain" ? text : "", files, items: files.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })) };
			editor.focus();
			await act(async () => { editor.dispatchEvent(Object.assign(new win.Event("paste", { bubbles: true, cancelable: true }), { clipboardData })); });
			await flush();
		},
		async drop(files: File[], target: Element = doc.querySelector('[data-testid="elsewhere"]')!) {
			const dataTransfer = { types: ["Files"], files, items: files.map(file => ({ kind: "file", type: file.type, getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false }) })), dropEffect: "none" };
			await act(async () => { target.dispatchEvent(Object.assign(new win.Event("drop", { bubbles: true, cancelable: true }), { dataTransfer })); });
			await flush();
		},
		async pick(files: File[]) {
			Object.defineProperty(picker, "files", { configurable: true, value: files });
			await act(async () => { picker.dispatchEvent(new win.Event("change", { bubbles: true })); });
			await flush();
		},
	};
}

describe("input surfaces", () => {
	it("pasting a screenshot stages it in the strip; mixed text keeps the normal text paste", async () => {
		const f = await fixture();
		await f.paste("", [png("screenshot.png")]);
		assert.equal(f.value, "", "an image-only clipboard inserts no text");
		assert.deepEqual(f.thumbnails(), ["Image to send: screenshot.png"]);
		await f.paste("caption", [png("second.png")]);
		assert.equal(f.value, "caption");
		assert.equal(stagedImages.get(f.key).images.length, 2);
		await act(async () => { f.doc.querySelector<HTMLButtonElement>('[aria-label="Remove screenshot.png"]')!.click(); });
		assert.deepEqual(f.thumbnails(), ["Image to send: second.png"]);
	});

	it("plain text paste is unaffected and stages nothing", async () => {
		const f = await fixture();
		await f.paste("just words", []);
		assert.equal(f.value, "just words");
		assert.equal(stagedImages.get(f.key).images.length, 0);
		assert.equal(f.doc.querySelector('[data-testid="staged-images"]'), null);
	});

	it("an oversized paste shows its reason inline and is never staged for sending", async () => {
		const f = await fixture();
		await f.paste("", [huge("big.png")]);
		assert.equal(stagedImages.get(f.key).images.length, 0);
		assert.match(f.doc.querySelector('[data-testid="staged-image-error"]')!.textContent!, /big\.png.*Larger than 20 MB/);
	});

	it("an image over the per-submission budget is refused inline with its reason", async () => {
		const f = await fixture();
		const big = (name: string) => new File([new Uint8Array(Math.floor(IMAGE_TARGET.maxBytes / 4 * 3) - 30_000).fill(7).map((byte, index) => index < 4 ? [0xff, 0xd8, 0xff, 0xe0][index]! : byte)], name, { type: "image/jpeg" });
		await f.paste("", Array.from({ length: 6 }, (_, index) => big(`photo${index}.jpg`)));
		assert.equal(stagedImages.get(f.key).images.length, 5);
		assert.match(f.doc.querySelector('[data-testid="staged-image-error"]')!.textContent!, /photo5\.jpg.*Too much image data for one send/);
	});

	it("a pasted non-image file shows upstream's browser notice in the strip", async () => {
		const f = await fixture();
		await f.paste("", [pdf()]);
		assert.match(f.status, /Local file paths can only be attached in the desktop app/);
	});

	it("browser drop: images stage on the default input, non-images keep the notice", async () => {
		const f = await fixture();
		await f.drop([png("dropped.png"), pdf()]);
		assert.deepEqual(f.thumbnails(), ["Image to send: dropped.png"]);
		assert.match(f.status, /Local file paths can only be attached in the desktop app/);
		assert.equal(f.value, "", "no File.name or path is inferred");
	});

	it("browser paperclip picks images into the draft; other files get the notice", async () => {
		const f = await fixture();
		assert.equal(f.button().getAttribute("aria-disabled"), "false");
		assert.equal(f.button().getAttribute("aria-label"), "Attach images");
		await act(async () => { f.button().click(); });
		assert.equal(f.pickerClicks, 1, "the picker opens directly, with no Files/Folder menu");
		assert.equal(f.doc.querySelector('[role="menu"]'), null);
		await f.pick([png("picked.png"), pdf()]);
		assert.deepEqual(f.thumbnails(), ["Image to send: picked.png"]);
		assert.match(f.doc.querySelector('[data-testid="attachment-popup"]')!.textContent!, /desktop app/);
	});

	it("desktop paperclip and drop keep upstream path chips, images included", async () => {
		const f = await fixture({ desktop: true });
		assert.equal(f.button().getAttribute("aria-label"), "Attach files");
		assert.equal(f.button().getAttribute("aria-haspopup"), "menu");
		const image = png("board.png");
		f.backingPaths.set(image, "/photos/board.png");
		await f.pick([image]);
		assert.equal(f.value, quoteFilePath("/photos/board.png"));
		f.editor.focus();
		const dropped = png("dropped.png");
		f.backingPaths.set(dropped, "/photos/dropped.png");
		await f.drop([dropped], f.editor);
		assert.match(f.value, /`\/photos\/dropped\.png`/);
		assert.equal(stagedImages.get(f.key).images.length, 0, "desktop files never become inline images");
	});
});
