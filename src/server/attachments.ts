import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
	AttachmentError,
	MAX_ATTACHMENT_BYTES,
	parseAttachments,
	type Attachment,
	type AttachmentStore,
} from "../core/attachments.ts";
import type { TurnInput } from "../core/input-events.ts";
import { stores } from "./stores.ts";

export function resolveAttachments(
	refs: readonly Attachment[] = [],
	store: AttachmentStore = stores.attachmentStore,
): Attachment[] {
	return parseAttachments(refs).map((a) => store.get(a.id));
}

export function resolveInputAttachments(input: TurnInput): TurnInput {
	if (input.type === "answer" && input.answer.attachments?.length)
		return {
			...input,
			answer: { ...input.answer, attachments: resolveAttachments(input.answer.attachments) },
		};
	if ((input.type === "text" || input.type === "thinking") && input.attachments?.length)
		return { ...input, attachments: resolveAttachments(input.attachments) };
	return input;
}

/** Only this provider-boundary projection loads image bytes. Chat records keep references. */
export function attachmentContent(
	refs: readonly Attachment[],
	store: AttachmentStore = stores.attachmentStore,
): Array<TextContent | ImageContent> {
	return resolveAttachments(refs, store).flatMap((a): Array<TextContent | ImageContent> => {
		if (a.kind === "image")
			return [
				{ type: "text", text: `[Attached image: ${a.name}]` },
				{
					type: "image",
					data: Buffer.from(store.read(a.id)).toString("base64"),
					mimeType: a.mimeType,
				},
			];
		const instruction =
			a.kind === "pdf"
				? "Use the pdf tool to read this document."
				: "Use the read tool to read this file; continue with offsets if needed.";
		return [
			{
				type: "text",
				text: `[Attached file: ${a.name}; ${a.size} bytes]\nSaved at: ${JSON.stringify(store.filePath(a.id))}\n${instruction}`,
			},
		];
	});
}

export function attachmentErrorResponse(error: unknown): Response {
	if (error instanceof AttachmentError)
		return Response.json({ error: error.message }, { status: error.status });
	console.error("[attachments]", error);
	return Response.json({ error: "Could not read or save the attachment" }, { status: 500 });
}

/** One file per upload bounds multipart buffering even when messages contain ten files. */
export async function uploadAttachment(
	req: Request,
	store: AttachmentStore = stores.attachmentStore,
): Promise<Response> {
	try {
		const limit = MAX_ATTACHMENT_BYTES + 1024 * 1024;
		if (Number(req.headers.get("content-length")) > limit)
			throw new AttachmentError("Each attachment must be 20 MB or smaller", 413);
		if (!req.body) throw new AttachmentError("Choose a file to attach");
		const reader = req.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > limit) {
					await reader.cancel();
					throw new AttachmentError("Each attachment must be 20 MB or smaller", 413);
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const form = await new Response(Buffer.concat(chunks), {
			headers: { "Content-Type": req.headers.get("content-type") ?? "" },
		})
			.formData()
			.catch(() => {
				throw new AttachmentError("Invalid attachment upload");
			});
		const files = form.getAll("file");
		if (files.length !== 1 || !(files[0] instanceof File))
			throw new AttachmentError("Upload one file at a time");
		const file = files[0];
		if (file.size > MAX_ATTACHMENT_BYTES)
			throw new AttachmentError("Each attachment must be 20 MB or smaller", 413);
		return Response.json(
			{ attachment: store.put(file.name, new Uint8Array(await file.arrayBuffer())) },
			{ status: 201 },
		);
	} catch (error) {
		return attachmentErrorResponse(error);
	}
}

export function serveAttachment(
	id: string,
	download: boolean,
	store: AttachmentStore = stores.attachmentStore,
): Response {
	try {
		const a = store.get(id);
		return new Response(Buffer.from(store.read(id)), {
			headers: {
				"Content-Type": a.mimeType,
				"Content-Length": String(a.size),
				"Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.name).replaceAll("'", "%27")}`,
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "sandbox; default-src 'none'",
				"Cache-Control": "private, max-age=31536000, immutable",
			},
		});
	} catch (error) {
		return attachmentErrorResponse(error);
	}
}
