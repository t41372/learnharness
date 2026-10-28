/** Immutable file references. Bytes stay in the attachment store, outside chat JSON. */
export interface Attachment {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	kind: "image" | "pdf" | "text";
}

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_ACCEPT =
	"image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.rs,.go,.c,.cpp,.h,.java,.swift,.sql,.sh,.yaml,.yml,.toml,.xml,.html,.css,.ipynb";
export const ATTACHMENT_ID = /^att_[a-f0-9]{32}$/;

export class AttachmentError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
	}
}

/** The server replaces all client metadata with the stored, canonical reference. */
export function parseAttachments(value: unknown): Attachment[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS)
		throw new AttachmentError("A message can contain at most 10 attachments");
	const seen = new Set<string>();
	return value.map((raw) => {
		if (!raw || typeof raw !== "object") throw new AttachmentError("Invalid attachment reference");
		const a = raw as Attachment;
		if (
			!ATTACHMENT_ID.test(a.id) ||
			typeof a.name !== "string" ||
			typeof a.mimeType !== "string" ||
			!Number.isInteger(a.size) ||
			a.size < 0 ||
			a.size > MAX_ATTACHMENT_BYTES ||
			!["image", "pdf", "text"].includes(a.kind) ||
			seen.has(a.id)
		) {
			throw new AttachmentError("Invalid or duplicate attachment reference");
		}
		seen.add(a.id);
		return { id: a.id, name: a.name, mimeType: a.mimeType, size: a.size, kind: a.kind };
	});
}

export interface AttachmentStore {
	put(name: string, bytes: Uint8Array): Attachment;
	get(id: string): Attachment;
	read(id: string): Uint8Array;
	filePath(id: string): string;
}
