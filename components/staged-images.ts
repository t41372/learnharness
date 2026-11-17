/**
 * Pasted images waiting to be sent (feat/message-attachments). Upstream's
 * native inline `images` channels are the only record format: this module
 * only holds the learner's unsent picks per input, persists them so a reload
 * or app restart restores them, and hands their ImageContent blocks to the
 * existing submission capture. Bytes are validated here only as far as the
 * client can; the server's prepareSubmissionImages stays the authority.
 */
import type { ImageContent } from "@earendil-works/pi-ai";
import { MAX_IMPORT_BODY_BYTES } from "@/lib/notes-import-limits";
import { browserImageCodec, fitStagedImage, type ImageCodec } from "./staged-image-resize";

export const MAX_STAGED_IMAGES = 10;
/** The largest file a learner may provide; it is downscaled before staging. */
export const MAX_STAGED_IMAGE_BYTES = 20 * 1024 * 1024;
/** next.config sets proxyClientMaxBodySize from MAX_IMPORT_BODY_BYTES: the
 *  proxy truncates any larger request body. One submission's images (base64,
 *  as sent) stay below it with 1 MiB left for its text and JSON. */
export const SUBMISSION_IMAGE_BUDGET = MAX_IMPORT_BODY_BYTES - 1024 * 1024;
export type StagedImageMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
/** The picker filter: the formats the submission transport carries. */
export const STAGED_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/** The inputs a staged image can belong to. */
export type StagedImageSurface = "composer" | "answer" | "thinking" | "readingThinking" | "practiceThinking";
/** Home and /chat/new have no chat yet; their opening images move to the
 *  created chat's composer key before navigation. */
export const NEW_SESSION_SCOPE = "new-session";

/** One draft per (chat or new-session, surface, target): composer text and
 *  steer share the chat's composer; question fields key on the pending
 *  question (its draft key: the call id, or its exact occurrence when an id
 *  repeats), practice thinking on the problem call. */
export function stagedImageKey(scope: string, surface: StagedImageSurface, target = ""): string {
	return [scope, surface, target].map(encodeURIComponent).join("/");
}

const QUESTION_SURFACES: readonly StagedImageSurface[] = ["answer", "thinking", "readingThinking"];
/** The drafts one submission can carry together: a question's answer,
 *  thinking and reading-thinking fields; every other draft is sent alone. */
export function submissionDraftKeys(key: string): string[] {
	const [scope, surface, target] = key.split("/").map(decodeURIComponent);
	if (scope === undefined || !QUESTION_SURFACES.includes(surface as StagedImageSurface)) return [key];
	return QUESTION_SURFACES.map(other => stagedImageKey(scope, other, target));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, offset: number, text: string) =>
	bytes.length >= offset + text.length && [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

/** The declared type the server will accept for these bytes. Mirrors
 *  prepareSubmissionImages: detectSupportedImageMimeType (minus BMP, which
 *  the transport refuses) plus any PNG signature, since the server falls
 *  back to PNG for animated PNGs. Anything else is refused before staging. */
export function detectStagedImageMimeType(bytes: Uint8Array): StagedImageMimeType | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return bytes[3] === 0xf7 ? null : "image/jpeg";
	if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return "image/png";
	if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) return "image/gif";
	if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
	return null;
}

/** Canonical base64 (the server re-encodes and compares). */
export function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	return btoa(binary);
}

export interface StagedImage {
	id: string;
	name: string;
	size: number;
	mimeType: StagedImageMimeType;
	/** Base64 bytes, exactly as they will ride the submission. */
	data: string;
}
/** Shown inline beside the strip, never persisted or sent. */
export type StagedImageProblem = "tooMany" | "tooLarge" | "unsupported" | "unreadable" | "overBudget";
export interface RejectedImage {
	id: string;
	name: string;
	problem: StagedImageProblem;
}
/** "browser": upstream's desktop-only file-path notice (a file without a
 *  path that is not an image). Translated at render, like the drop zone's. */
export type StagedImageNotice = "" | "browser";
export interface StagedImageDraft {
	readonly images: readonly StagedImage[];
	readonly rejected: readonly RejectedImage[];
	readonly notice: StagedImageNotice;
}

/** Durable storage behind the store: IndexedDB in the app, an in-memory
 *  fake in tests (and wherever IndexedDB is unavailable). */
export interface StagedImageStorage {
	read(key: string): Promise<readonly StagedImage[]>;
	/** An empty list deletes the draft. */
	write(key: string, images: readonly StagedImage[]): Promise<void>;
}

const MIME_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
function isStagedImage(value: unknown): value is StagedImage {
	if (!value || typeof value !== "object") return false;
	const image = value as Record<string, unknown>;
	return typeof image.id === "string" && typeof image.name === "string" && typeof image.size === "number"
		&& typeof image.mimeType === "string" && MIME_TYPES.includes(image.mimeType) && typeof image.data === "string" && image.data.length > 0;
}
const copyImages = (images: readonly StagedImage[]) => images.map(image => ({ ...image }));

export function memoryStagedImageStorage(): StagedImageStorage & { readonly records: Map<string, StagedImage[]> } {
	const records = new Map<string, StagedImage[]>();
	return {
		records,
		async read(key) { return copyImages(records.get(key) ?? []); },
		async write(key, images) {
			if (images.length) records.set(key, copyImages(images));
			else records.delete(key);
		},
	};
}

const DATABASE = "learnharness-staged-images";
const OBJECT_STORE = "drafts";
export function indexedDbStagedImageStorage(factory: IDBFactory): StagedImageStorage {
	let database: Promise<IDBDatabase> | null = null;
	const open = () => database ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = factory.open(DATABASE, 1);
		request.onupgradeneeded = () => { request.result.createObjectStore(OBJECT_STORE); };
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => { database = null; reject(request.error); };
	});
	const run = async (mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<unknown> => {
		const transaction = (await open()).transaction(OBJECT_STORE, mode);
		const request = action(transaction.objectStore(OBJECT_STORE));
		return new Promise<unknown>((resolve, reject) => {
			transaction.oncomplete = () => resolve(request.result);
			transaction.onerror = transaction.onabort = () => reject(transaction.error ?? request.error);
		});
	};
	return {
		async read(key) {
			const record = await run("readonly", store => store.get(key));
			const images = (record as { images?: unknown } | undefined)?.images;
			return Array.isArray(images) ? images.filter(isStagedImage) : [];
		},
		async write(key, images) {
			await run("readwrite", store => images.length ? store.put({ images: copyImages(images) }, key) : store.delete(key));
		},
	};
}

/** What a submission captured from one draft: cleared on acceptance only. */
export interface StagedImageCapture {
	key: string;
	ids: readonly string[];
	images: ImageContent[];
}

const EMPTY: StagedImageDraft = Object.freeze({ images: Object.freeze([]), rejected: Object.freeze([]), notice: "" });
const newId = () => globalThis.crypto.randomUUID();

/** Module-level draft state: one snapshot per key for useSyncExternalStore,
 *  hydrated from storage on first use and written back after every change. */
export class StagedImageStore {
	private drafts = new Map<string, StagedImageDraft>();
	private hydrations = new Map<string, Promise<void>>();
	private listeners = new Map<string, Set<() => void>>();
	private writes = new Map<string, Promise<void>>();

	constructor(private storage: StagedImageStorage, private codec: ImageCodec = browserImageCodec) {}

	get(key: string): StagedImageDraft { return this.drafts.get(key) ?? EMPTY; }

	subscribe(key: string, listener: () => void): () => void {
		let set = this.listeners.get(key);
		if (!set) this.listeners.set(key, set = new Set());
		set.add(listener);
		void this.ready(key);
		return () => { set.delete(listener); };
	}

	/** Resolves once the persisted draft has been merged in. */
	ready(key: string): Promise<void> {
		let hydration = this.hydrations.get(key);
		if (!hydration) {
			hydration = this.storage.read(key).then(stored => {
				if (!stored.length) return;
				const current = this.get(key);
				const known = new Set(current.images.map(image => image.id));
				this.set(key, { ...current, images: [...stored.filter(image => !known.has(image.id)), ...current.images].slice(0, MAX_STAGED_IMAGES) }, false);
			}).catch(() => { /* Unreadable storage: the draft simply starts empty. */ });
			this.hydrations.set(key, hydration);
		}
		return hydration;
	}

	/** Validate and stage image files. Rejections stay visible inline with
	 *  their reason; they are never persisted or sent. */
	async add(key: string, files: readonly File[]): Promise<void> {
		if (!files.length) return;
		await this.ready(key);
		const read: (StagedImage | RejectedImage)[] = [];
		for (const file of files) {
			const base = { id: newId(), name: file.name || "image" };
			if (file.size > MAX_STAGED_IMAGE_BYTES) { read.push({ ...base, problem: "tooLarge" }); continue; }
			let bytes: Uint8Array;
			try { bytes = new Uint8Array(await file.arrayBuffer()); }
			catch { read.push({ ...base, problem: "unreadable" }); continue; }
			const sniffed = detectStagedImageMimeType(bytes);
			if (!sniffed) { read.push({ ...base, problem: "unsupported" }); continue; }
			if (bytes.byteLength > MAX_STAGED_IMAGE_BYTES) { read.push({ ...base, problem: "tooLarge" }); continue; }
			const fitted = await fitStagedImage(bytes, sniffed, this.codec);
			const mimeType = fitted && detectStagedImageMimeType(fitted.bytes);
			if (!fitted || !mimeType) { read.push({ ...base, problem: "unreadable" }); continue; }
			read.push({ ...base, size: fitted.bytes.byteLength, mimeType, data: encodeBase64(fitted.bytes) });
		}
		// Count against the drafts as they are NOW: concurrent adds share the
		// per-input limit and the per-submission request budget.
		const current = this.get(key);
		const images = [...current.images];
		const rejected = [...current.rejected];
		let sending = submissionDraftKeys(key).filter(other => other !== key).reduce((sum, other) => sum + this.imageBytes(other), 0) + this.imageBytes(key);
		for (const entry of read) {
			if ("problem" in entry) rejected.push(entry);
			else if (images.length >= MAX_STAGED_IMAGES) rejected.push({ id: entry.id, name: entry.name, problem: "tooMany" });
			else if (sending + entry.data.length > SUBMISSION_IMAGE_BUDGET) rejected.push({ id: entry.id, name: entry.name, problem: "overBudget" });
			else { images.push(entry); sending += entry.data.length; }
		}
		this.set(key, { ...current, images, rejected }, images.length !== current.images.length);
	}

	/** Base64 characters (= request bytes) of one draft's images. */
	private imageBytes(key: string): number {
		return this.get(key).images.reduce((sum, image) => sum + image.data.length, 0);
	}

	remove(key: string, id: string): void {
		const current = this.get(key);
		const images = current.images.filter(image => image.id !== id);
		this.set(key, { ...current, images, rejected: current.rejected.filter(entry => entry.id !== id) }, images.length !== current.images.length);
	}

	setNotice(key: string, notice: StagedImageNotice): void {
		const current = this.get(key);
		if (current.notice !== notice) this.set(key, { ...current, notice }, false);
	}

	/** Await hydration, then snapshot the images a submission will carry. */
	async capture(key: string): Promise<StagedImageCapture> {
		await this.ready(key);
		const images = this.get(key).images;
		return { key, ids: images.map(image => image.id), images: images.map(({ mimeType, data }) => ({ type: "image", mimeType, data })) };
	}

	/** The submission was accepted: drop exactly what it carried (and the
	 *  stale rejections), keeping anything staged while it was in flight. */
	release(captures: readonly StagedImageCapture[]): void {
		for (const { key, ids } of captures) {
			const current = this.get(key);
			const sent = new Set(ids);
			const images = current.images.filter(image => !sent.has(image.id));
			this.set(key, { images, rejected: [], notice: "" }, images.length !== current.images.length);
		}
	}

	/** Hand the new-session draft over to a created chat before navigating. */
	async move(from: string, to: string): Promise<void> {
		await Promise.all([this.ready(from), this.ready(to)]);
		const moving = this.get(from).images;
		if (!moving.length) return;
		const target = this.get(to);
		this.set(to, { ...target, images: [...target.images, ...moving].slice(0, MAX_STAGED_IMAGES) }, true);
		this.set(from, EMPTY, true);
		await this.flush();
	}

	/** Every queued storage write has settled. */
	async flush(): Promise<void> {
		await Promise.all(this.writes.values());
	}

	private set(key: string, draft: StagedImageDraft, persist: boolean) {
		this.drafts.set(key, Object.freeze(draft));
		if (persist) {
			// Serialize per key; each write stores the latest snapshot.
			const previous = this.writes.get(key) ?? Promise.resolve();
			this.writes.set(key, previous.then(() => this.storage.write(key, this.get(key).images)).catch(() => { /* Kept in memory for this session. */ }));
		}
		for (const listener of this.listeners.get(key) ?? []) listener();
	}
}

function defaultStorage(): StagedImageStorage {
	try {
		if (typeof indexedDB !== "undefined" && indexedDB) return indexedDbStagedImageStorage(indexedDB);
	} catch { /* Blocked storage: fall through to memory. */ }
	return memoryStagedImageStorage();
}

/** The app's one store. Tests construct their own with a fake storage. */
export const stagedImages = new StagedImageStore(defaultStorage());

/** Home and /chat/new share the opening draft. */
export const OPENING_IMAGE_KEY = stagedImageKey(NEW_SESSION_SCOPE, "composer");

/** Before navigating to a created chat (`/chat/<id>`): its composer draft
 *  inherits the opening images, which its opening delivery sends. */
export function handOverOpeningImages(target: string, store = stagedImages): Promise<void> {
	const id = /^\/chat\/([A-Za-z0-9_-]+)$/.exec(target)?.[1];
	return id ? store.move(OPENING_IMAGE_KEY, stagedImageKey(id, "composer")) : Promise.resolve();
}

/** Clipboard/drop/picker files, split by whether they claim an image type. */
export function splitImageFiles(files: Iterable<File>): { images: File[]; others: File[] } {
	const images: File[] = [], others: File[] = [];
	for (const file of files) (file.type.startsWith("image/") ? images : others).push(file);
	return { images, others };
}

/** The files a clipboard carries (screenshots arrive as items only). */
export function clipboardFiles(data: Pick<DataTransfer, "files" | "items"> | null | undefined): File[] {
	if (!data) return [];
	const files = Array.from(data.files ?? []);
	if (files.length) return files;
	return Array.from(data.items ?? []).flatMap(item => {
		if (item.kind !== "file") return [];
		const file = item.getAsFile();
		return file ? [file] : [];
	});
}

/** Stage pasted image files; a pasted non-image file gets upstream's
 *  notice. Text in the same clipboard is PathInput's (it already ran). */
export function stagePastedFiles(key: string, data: Pick<DataTransfer, "files" | "items"> | null | undefined, store = stagedImages): void {
	const { images, others } = splitImageFiles(clipboardFiles(data));
	if (images.length) void store.add(key, images);
	store.setNotice(key, others.length ? "browser" : "");
}

/** Marks an input that owns a staged-image draft (read by drop and pick). */
export const STAGED_IMAGE_KEY_ATTRIBUTE = "data-staged-image-key";

/** A browser drop's destination: the focused staged-image input inside the
 *  zone, else the zone's default drop target, else its first one. */
export function stagedImageDropKey(zone: Element, active: Element | null): string | undefined {
	const focused = active?.closest<HTMLElement>(`[${STAGED_IMAGE_KEY_ATTRIBUTE}]`);
	if (focused && zone.contains(focused)) return focused.getAttribute(STAGED_IMAGE_KEY_ATTRIBUTE) ?? undefined;
	const fallback = zone.querySelector(`[data-file-path-default][${STAGED_IMAGE_KEY_ATTRIBUTE}]`) ?? zone.querySelector(`[${STAGED_IMAGE_KEY_ATTRIBUTE}]`);
	return fallback?.getAttribute(STAGED_IMAGE_KEY_ATTRIBUTE) ?? undefined;
}
