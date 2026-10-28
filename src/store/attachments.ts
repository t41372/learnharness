import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import {
	ATTACHMENT_ID,
	MAX_ATTACHMENT_BYTES,
	AttachmentError,
	parseAttachments,
	type Attachment,
	type AttachmentStore,
} from "../core/attachments.ts";

const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".markdown",
	".json",
	".jsonl",
	".csv",
	".tsv",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".rs",
	".go",
	".c",
	".cpp",
	".cc",
	".h",
	".hpp",
	".java",
	".swift",
	".kt",
	".rb",
	".php",
	".sql",
	".sh",
	".bash",
	".zsh",
	".yaml",
	".yml",
	".toml",
	".xml",
	".html",
	".css",
	".scss",
	".log",
	".tex",
	".ipynb",
	".r",
	".srt",
	".vtt",
]);

/** Check bytes rather than trusting a browser MIME claim or a renamed executable. */
export function classifyAttachment(name: string, bytes: Uint8Array): Pick<Attachment, "kind" | "mimeType"> {
	const buffer = Buffer.from(bytes);
	const ext = path.extname(name).toLowerCase();
	if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
		return { kind: "image", mimeType: "image/png" };
	if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
		return { kind: "image", mimeType: "image/jpeg" };
	if (/^GIF8[79]a/.test(buffer.subarray(0, 6).toString("ascii")))
		return { kind: "image", mimeType: "image/gif" };
	if (
		buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
		buffer.subarray(8, 12).toString("ascii") === "WEBP"
	)
		return { kind: "image", mimeType: "image/webp" };
	if (buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")))
		return { kind: "pdf", mimeType: "application/pdf" };
	if (!TEXT_EXTENSIONS.has(ext) && ext !== "")
		throw new AttachmentError("Supported files: PNG, JPEG, GIF, WebP, PDF, text, and source code", 415);
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		if (text.includes("\0")) throw new Error("Binary content");
	} catch {
		throw new AttachmentError("Text attachments must contain UTF-8 text", 415);
	}
	return { kind: "text", mimeType: "text/plain" };
}

export function createAttachmentStore(root = path.join(PATHS.data, "attachments")): AttachmentStore {
	const directory = (id: string) => {
		if (!ATTACHMENT_ID.test(id)) throw new AttachmentError("Invalid attachment id");
		return path.join(root, id);
	};
	const get = (id: string): Attachment => {
		try {
			return parseAttachments([
				JSON.parse(fs.readFileSync(path.join(directory(id), "metadata.json"), "utf8")),
			])[0]!;
		} catch (error) {
			if (error instanceof AttachmentError) throw error;
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new AttachmentError("Attachment not found", 404);
			throw error;
		}
	};
	const filePath = (id: string) => {
		const a = get(id);
		const extension = a.kind === "pdf" ? "pdf" : a.kind === "text" ? "txt" : a.mimeType.split("/")[1];
		return path.join(directory(id), `content.${extension}`);
	};
	return {
		get,
		filePath,
		read: (id) => fs.readFileSync(filePath(id)),
		put(originalName, bytes) {
			if (bytes.byteLength > MAX_ATTACHMENT_BYTES)
				throw new AttachmentError("Each attachment must be 20 MB or smaller", 413);
			const name =
				path
					.basename(originalName.replaceAll("\\", "/"))
					.replace(/[\x00-\x1f\x7f]/g, "")
					.slice(0, 255) || "attachment";
			const type = classifyAttachment(name, bytes);
			const id = `att_${crypto.randomUUID().replaceAll("-", "")}`;
			const attachment: Attachment = { id, name, size: bytes.byteLength, ...type };
			const temporary = `${directory(id)}.tmp`;
			fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
			try {
				const extension =
					type.kind === "pdf" ? "pdf" : type.kind === "text" ? "txt" : type.mimeType.split("/")[1];
				fs.writeFileSync(path.join(temporary, `content.${extension}`), bytes, { mode: 0o600 });
				fs.writeFileSync(path.join(temporary, "metadata.json"), JSON.stringify(attachment), {
					mode: 0o600,
				});
				fs.renameSync(temporary, directory(id));
			} finally {
				fs.rmSync(temporary, { recursive: true, force: true });
			}
			return attachment;
		},
	};
}
