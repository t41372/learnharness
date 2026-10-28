"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type Attachment } from "@/src/core";
import { useT } from "@/components/i18n";

interface Upload {
	key: string;
	file?: File;
	attachment?: Attachment;
	failed?: boolean;
}

export interface AttachmentDraft {
	items: Attachment[];
	uploads: Upload[];
	pending: boolean;
	error: string;
	add(files: readonly File[]): void;
	retry(key: string): void;
	remove(key: string): void;
	clear(ids?: readonly string[]): void;
	restore(items: readonly Attachment[]): void;
	current(): Attachment[];
	bind: {
		onPaste(event: ClipboardEvent<HTMLElement>): void;
		onDrop(event: DragEvent<HTMLElement>): void;
		onDragOver(event: DragEvent<HTMLElement>): void;
	};
}

/** Shared by all learner input surfaces; the ref protects rapid paste/send sequences. */
export function useAttachmentDraft(initialItems: readonly Attachment[] = []): AttachmentDraft {
	const { t } = useT("chat");
	const [uploads, setUploads] = useState<Upload[]>(() => initialItems.map(attachment => ({ key: attachment.id, attachment })));
	const ref = useRef<Upload[]>(uploads);
	const [error, setError] = useState("");
	const controllers = useRef(new Map<string, AbortController>());
	const update = (next: Upload[]) => {
		ref.current = next;
		setUploads(next);
	};
	useEffect(
		() => () => {
			for (const controller of controllers.current.values()) controller.abort();
		},
		[],
	);
	const upload = async (entry: Upload) => {
		if (!entry.file) return;
		const controller = new AbortController();
		controllers.current.set(entry.key, controller);
		try {
			const form = new FormData();
			form.append("file", entry.file);
			const response = await fetch("/api/attachments", {
				method: "POST",
				body: form,
				signal: controller.signal,
			});
			if (!response.ok) throw new Error("Upload failed");
			const { attachment } = (await response.json()) as { attachment: Attachment };
			update(
				ref.current.map((item) =>
					item.key === entry.key ? { ...item, attachment, failed: false } : item,
				),
			);
		} catch {
			if (!controller.signal.aborted)
				update(
					ref.current.map((item) => (item.key === entry.key ? { ...item, failed: true } : item)),
				);
		} finally {
			controllers.current.delete(entry.key);
		}
	};
	const add = (files: readonly File[]) => {
		if (!files.length) return;
		if (ref.current.length + files.length > MAX_ATTACHMENTS) {
			setError(t("attachments.tooMany"));
			return;
		}
		if (files.some((f) => f.size > MAX_ATTACHMENT_BYTES)) {
			setError(t("attachments.tooLarge"));
			return;
		}
		setError("");
		const entries = files.map((file) => ({ key: crypto.randomUUID(), file }));
		update([...ref.current, ...entries]);
		for (const entry of entries) void upload(entry);
	};
	return {
		items: uploads.flatMap((u) => (u.attachment ? [u.attachment] : [])),
		uploads,
		pending: uploads.some((u) => !u.attachment && !u.failed),
		error,
		add,
		current: () => ref.current.flatMap((u) => (u.attachment ? [u.attachment] : [])),
		retry(key) {
			const entry = ref.current.find((u) => u.key === key);
			if (!entry?.file || controllers.current.has(key)) return;
			update(ref.current.map((u) => (u.key === key ? { ...u, failed: false } : u)));
			void upload(entry);
		},
		remove(key) {
			controllers.current.get(key)?.abort();
			update(ref.current.filter((u) => u.key !== key));
			setError("");
		},
		restore(items) {
			const known = new Set(ref.current.flatMap(item => item.attachment ? [item.attachment.id] : []));
			const restored = items.filter(item => !known.has(item.id));
			if (restored.length) update([...ref.current, ...restored.map(attachment => ({ key: attachment.id, attachment }))]);
		},
		clear(ids) {
			if (ids && !ids.length) return;
			update(ids ? ref.current.filter((u) => !u.attachment || !ids.includes(u.attachment.id)) : []);
			setError("");
		},
		bind: {
			onPaste(event) {
				const files = Array.from(event.clipboardData.items)
					.filter((i) => i.kind === "file")
					.map((i) => i.getAsFile())
					.filter((f): f is File => f !== null);
				if (files.length) add(files); // Native text paste still runs for mixed text/file clipboards.
			},
			onDrop(event) {
				if (!event.dataTransfer.files.length) return;
				event.preventDefault();
				event.stopPropagation();
				add(Array.from(event.dataTransfer.files));
			},
			onDragOver(event) {
				if (event.dataTransfer.types.includes("Files")) event.preventDefault();
			},
		},
	};
}

export function AttachmentPicker({
	draft,
	disabled = false,
}: {
	draft: AttachmentDraft;
	disabled?: boolean;
}) {
	const { t } = useT("chat");
	const input = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={input}
				type="file"
				multiple
				accept={ATTACHMENT_ACCEPT}
				className="hidden"
				aria-label={t("attachments.choose")}
				disabled={disabled}
				onChange={(event) => {
					draft.add(Array.from(event.target.files ?? []));
					event.target.value = "";
				}}
			/>
			<button
				type="button"
				data-testid="attachment-picker"
				aria-label={t("attachments.choose")}
				title={t("attachments.supported")}
				disabled={disabled || draft.uploads.length >= MAX_ATTACHMENTS}
				className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-50"
				onClick={() => input.current?.click()}
			>
				<PaperclipIcon className="size-4" />
			</button>
		</>
	);
}

export function AttachmentDraftList({ draft }: { draft: AttachmentDraft }) {
	const { t } = useT("chat");
	return (
		<>
			{draft.uploads.length > 0 && (
				<div
					className="flex flex-wrap gap-2 px-2.5 pt-2"
					data-testid="attachment-draft"
					aria-live="polite"
				>
					{draft.uploads.map((upload) => (
						<div
							key={upload.key}
							className="flex max-w-full items-center gap-1 rounded-lg border bg-background px-2 py-1 text-xs"
						>
							{upload.attachment ? (
								<AttachmentList attachments={[upload.attachment]} />
							) : (
								<span className="truncate">
									{upload.file?.name} ·{" "}
									{upload.failed ? t("attachments.failed") : t("attachments.uploading")}
								</span>
							)}
							{upload.failed && (
								<button
									type="button"
									className="underline"
									onClick={() => draft.retry(upload.key)}
								>
									{t("attachments.retry")}
								</button>
							)}
							<button
								type="button"
								aria-label={t("attachments.remove", { name: (upload.attachment?.name ?? upload.file?.name ?? "") })}
								className="rounded p-1 hover:bg-accent"
								onClick={() => draft.remove(upload.key)}
							>
								<XIcon className="size-3" />
							</button>
						</div>
					))}
				</div>
			)}
			{draft.error && (
				<p role="alert" className="px-3 py-1 text-xs text-destructive">
					{draft.error}
				</p>
			)}
		</>
	);
}

export function AttachmentList({ attachments = [] }: { attachments?: readonly Attachment[] }) {
	const [selected, setSelected] = useState<Attachment | null>(null);
	if (!attachments.length) return null;
	return (
		<div className="flex flex-wrap gap-2 py-1" data-testid="attachment-list">
			{attachments.map((a) => (
				<button
					type="button"
					key={a.id}
					className="flex max-w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-xs hover:bg-accent"
					onClick={() => setSelected(a)}
				>
					{a.kind === "image" ? (
						<Image
							src={`/api/attachments/${a.id}`}
							alt={a.name}
							width={64}
							height={48}
							unoptimized
							className="h-12 w-16 rounded object-cover"
						/>
					) : (
						<FileTextIcon className="size-4 shrink-0" />
					)}
					<span className="truncate">{a.name}</span>
				</button>
			))}
			{selected && <AttachmentPreview attachment={selected} onClose={() => setSelected(null)} />}
		</div>
	);
}

function AttachmentPreview({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
	const { t } = useT("chat");
	const dialog = useRef<HTMLDialogElement>(null);
	const [text, setText] = useState<string | null>(null);
	const url = `/api/attachments/${attachment.id}`;
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	useEffect(() => {
		if (attachment.kind !== "text") return;
		const controller = new AbortController();
		void (async () => {
			try {
				const response = await fetch(url, { signal: controller.signal });
				if (!response.ok || !response.body) throw new Error("Preview unavailable");
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let output = "";
				try {
					while (output.length < 64_000) {
						const part = await reader.read();
						if (part.done) break;
						output += decoder.decode(part.value, { stream: true });
					}
					if (output.length >= 64_000) {
						await reader.cancel();
						output = output.slice(0, 64_000) + `\n\n${t("attachments.previewTruncated")}`;
					} else output += decoder.decode();
				} finally {
					reader.releaseLock();
				}
				if (!controller.signal.aborted) setText(output);
			} catch {
				if (!controller.signal.aborted) setText(t("attachments.previewError"));
			}
		})();
		return () => controller.abort();
	}, [attachment.kind, url, t]);
	return createPortal(
		<dialog
			ref={dialog}
			aria-label={attachment.name}
			onClose={onClose}
			onClick={(event) => {
				if (event.target === dialog.current) dialog.current?.close();
			}}
			className="m-auto w-[min(90vw,70rem)] max-w-none rounded-xl border bg-card p-0 text-foreground backdrop:bg-black/60"
		>
			<header className="flex items-center gap-3 border-b p-3">
				<span className="min-w-0 flex-1 truncate text-sm">{attachment.name}</span>
				<a href={`${url}?download=1`} download={attachment.name} className="text-xs underline">
					{t("attachments.download")}
				</a>
				<button
					type="button"
					aria-label={t("attachments.close")}
					onClick={() => dialog.current?.close()}
				>
					<XIcon className="size-5" />
				</button>
			</header>
			<div className="max-h-[80vh] overflow-auto p-3">
				{attachment.kind === "image" ? (
					<Image
						src={url}
						alt={attachment.name}
						width={1600}
						height={1200}
						unoptimized
						className="mx-auto h-auto max-h-[75vh] w-auto max-w-full object-contain"
					/>
				) : attachment.kind === "pdf" ? (
					<iframe title={attachment.name} src={url} className="h-[75vh] w-full" />
				) : (
					<pre className="whitespace-pre-wrap break-words text-xs">
						{text ?? t("attachments.loading")}
					</pre>
				)}
			</div>
		</dialog>,
		document.body,
	);
}
