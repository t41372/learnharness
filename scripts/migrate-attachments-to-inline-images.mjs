/**
 * One-off migration for data written by the retired attachment store
 * (feat/message-attachments before upstream v0.6.1). Converts its file
 * references into upstream's native records:
 *
 *   user/steer message `attachments`      → inline image blocks in content
 *   question answer `attachments`         → "Answer images:" blocks + details.images.answer
 *   practice-thinking marker `attachments` → details.images
 *
 * Image bytes are normalized with upstream's processImage (default resize).
 * PDF and text references become quoted file-path chips pointing at the kept
 * files. <data>/attachments/ is left in place. Dry run by default; records
 * without old references are never touched, and a second run is a no-op.
 *
 * Usage:
 *   node --import tsx scripts/migrate-attachments-to-inline-images.mjs [--data <dir>] [--apply --backup <existing dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { processImage } from "../src/agent/image-processing/index.ts";
import { quoteFilePath } from "../src/core/file-paths.ts";
import { nativeAnswerContent, nativeInlineImageContent, newThinkingMessage } from "../src/core/native-messages.ts";
import { compactAnswerForModel } from "../src/core/question-core.ts";
import { writeFileAtomicSync } from "../src/store/atomic-write.ts";

export const USAGE = "Usage: node --import tsx scripts/migrate-attachments-to-inline-images.mjs [--data <dir>] [--apply --backup <existing dir>]";
const ATTACHMENT_ID = /^att_[a-f0-9]{32}$/;
const CHAT_FILE = /^[A-Za-z0-9_-]+\.json$/;

/** The old reference lists on one record (top level and details), merged by id. */
function oldRefs(message) {
	const lists = [message.attachments, message.details?.attachments].filter(Array.isArray);
	if (!lists.length) return null;
	const byId = new Map();
	for (const ref of lists.flat()) byId.set(ref?.id, ref);
	return [...byId.values()];
}

/** The record kinds the retired store wrote references on. */
function recordKind(message) {
	if (message.role === "user") return "user";
	if (message.role === "toolResult") return "answer";
	if (message.role === "custom" && message.customType === "practice-thinking") return "thinking";
	return null;
}

/** One reference → a normalized image block or a quoted path; throws a
 *  reason when the reference or its bytes cannot be used. */
async function resolveRef(data, ref) {
	if (!ref || typeof ref !== "object" || !ATTACHMENT_ID.test(ref.id) || !["image", "pdf", "text"].includes(ref.kind)) throw new Error("invalid reference");
	const directory = path.join(data, "attachments", ref.id);
	let entries;
	try { entries = fs.readdirSync(directory).filter(name => name.startsWith("content.")); }
	catch { throw new Error(`missing ${ref.id}`); }
	if (entries.length !== 1) throw new Error(`missing content for ${ref.id}`);
	const file = path.resolve(directory, entries[0]);
	if (ref.kind !== "image") return { path: quoteFilePath(file) };
	const result = await processImage(fs.readFileSync(file), ref.mimeType);
	if (!result.ok) throw new Error(`unprocessable image ${ref.id}`);
	return { image: { type: "image", data: result.data, mimeType: result.mimeType } };
}

const withPaths = (text, paths) => [text.replace(/\s+$/, ""), ...paths].filter(Boolean).join(" ");

/** The upstream shape of one record (a new object; the input is unchanged). */
function convert(message, kind, images, paths) {
	const { attachments: _attachments, ...next } = message;
	if (kind === "user") {
		if (typeof next.content === "string") next.content = nativeInlineImageContent(withPaths(next.content, paths), images);
		else next.content = [...next.content, ...(paths.length ? [{ type: "text", text: paths.join(" ") }] : []), ...images];
		return next;
	}
	const { attachments: _detailRefs, ...details } = next.details ?? {};
	if (kind === "thinking") {
		// Upstream's own constructor fixes content and details together.
		const rebuilt = newThinkingMessage(details.problemCallId, withPaths(details.text ?? "", paths), images);
		return { ...next, content: rebuilt.content, details: { ...details, ...rebuilt.details } };
	}
	// Answer: files join the learner's own text (the answer in text mode,
	// otherwise the thinking); images ride the answer channel.
	if (paths.length) {
		if (typeof details.text === "string") details.text = withPaths(details.text, paths);
		else details.thinking = withPaths(details.thinking ?? details.note ?? "", paths); // `note`: the pre-rename key
	}
	if (images.length) details.images = { ...details.images, answer: [...(details.images?.answer ?? []), ...images] };
	const first = next.content?.[0];
	const answerText = paths.length || first?.type !== "text" ? JSON.stringify(compactAnswerForModel(details)) : first.text;
	return { ...next, content: nativeAnswerContent(answerText, details.images), details };
}

/**
 * Convert every chat under `<data>/chats`. Returns one summary per chat
 * with old references; `apply` writes atomically after backing up each
 * changed chat file into `<backup>/chats/`.
 * @param {{ data: string; apply?: boolean; backup?: string; log?: (line: string) => void }} options
 */
export async function migrateAttachments({ data, apply = false, backup, log = console.log }) {
	if (apply && (!backup || !fs.statSync(backup, { throwIfNoEntry: false })?.isDirectory())) throw new Error("--apply requires --backup <existing directory>");
	const chatsDir = path.join(data, "chats");
	const files = fs.existsSync(chatsDir) ? fs.readdirSync(chatsDir).filter(name => CHAT_FILE.test(name)).sort() : [];
	const summaries = [];
	for (const name of files) {
		const file = path.join(chatsDir, name);
		const original = fs.readFileSync(file, "utf8");
		const record = JSON.parse(original);
		const summary = { chat: name.slice(0, -".json".length), user: 0, answer: 0, thinking: 0, images: 0, paths: 0, skipped: [] };
		let changed = false;
		const messages = [];
		for (const message of record.messages ?? []) {
			const refs = oldRefs(message);
			if (!refs) { messages.push(message); continue; }
			const kind = recordKind(message);
			try {
				if (!kind) throw new Error(`unsupported ${message.role} record`);
				const images = [], paths = [];
				for (const ref of refs) {
					const resolved = await resolveRef(data, ref);
					if (resolved.image) images.push(resolved.image); else paths.push(resolved.path);
				}
				messages.push(convert(message, kind, images, paths));
				summary[kind]++; summary.images += images.length; summary.paths += paths.length;
				changed = true;
			} catch (error) {
				messages.push(message); // Left exactly as it was.
				summary.skipped.push(`${message.id ?? "?"}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		if (!changed && !summary.skipped.length) continue;
		if (apply && changed) {
			const copy = path.join(backup, "chats", name);
			fs.mkdirSync(path.dirname(copy), { recursive: true });
			if (fs.existsSync(copy) && fs.readFileSync(copy, "utf8") !== original) {
				summary.skipped.push(`backup ${copy} already exists with other content; chat not written`);
				changed = false;
			} else {
				fs.writeFileSync(copy, original);
				writeFileAtomicSync(file, JSON.stringify({ ...record, messages }, null, "\t"), { allowInPlaceFallback: true });
			}
		}
		summary.written = apply && changed;
		summaries.push(summary);
		const verb = apply ? (summary.written ? "converted" : "not written") : "would convert";
		log(`${summary.chat}: ${verb} ${summary.user} user/steer, ${summary.answer} answer, ${summary.thinking} thinking (${summary.images} images, ${summary.paths} file paths)`
			+ (summary.skipped.length ? `; left unchanged: ${summary.skipped.join("; ")}` : ""));
	}
	if (!summaries.length) log("No records with old attachment references.");
	return summaries;
}

function parseArgs(argv) {
	const options = { data: process.env.LH_DATA_DIR || "./data", apply: false, backup: undefined };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--apply") options.apply = true;
		else if ((arg === "--data" || arg === "--backup") && argv[index + 1]) options[arg.slice(2)] = argv[++index];
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return { ...options, data: path.resolve(options.data), backup: options.backup && path.resolve(options.backup) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		const summaries = await migrateAttachments(parseArgs(process.argv.slice(2)));
		if (summaries.some(summary => summary.skipped.length)) process.exitCode = 2;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(USAGE);
		process.exitCode = 1;
	}
}
