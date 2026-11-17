"use client";

import { useCallback, useSyncExternalStore, type ClipboardEvent } from "react";
import { ImageOffIcon, XIcon } from "lucide-react";
import { useT } from "@/components/i18n";
import { cn } from "@/lib/utils";
import { stagePastedFiles, stagedImages, type StagedImageDraft, type StagedImageProblem, type StagedImageStore } from "./staged-images";

const EMPTY: StagedImageDraft = { images: [], rejected: [], notice: "" };
const noSubscribe = () => () => {};

/** The live draft for one input; no key means no staging on that input. */
export function useStagedImages(key: string | undefined, store: StagedImageStore = stagedImages): StagedImageDraft {
	const subscribe = useCallback((listener: () => void) => key === undefined ? noSubscribe() : store.subscribe(key, listener), [key, store]);
	return useSyncExternalStore(subscribe, () => key === undefined ? EMPTY : store.get(key), () => EMPTY);
}

/** PathInput's onPaste: its own native listener has already handled text. */
export function stagedImagePasteHandler(key: string | undefined, store: StagedImageStore = stagedImages) {
	return key === undefined ? undefined : (event: ClipboardEvent<HTMLElement>) => stagePastedFiles(key, event.clipboardData, store);
}

const PROBLEM_KEY = {
	tooMany: "attachments.tooMany",
	tooLarge: "attachments.tooLarge",
	unsupported: "attachments.unsupported",
	unreadable: "attachments.unreadable",
	overBudget: "attachments.overBudget",
} as const satisfies Record<StagedImageProblem, string>;

/** The compact strip attached to its input: one thumbnail per staged image,
 *  inline reasons for refused ones, and a keyboard-reachable remove. */
export function StagedImageStrip({ draftKey, className, store = stagedImages }: { draftKey: string | undefined; className?: string; store?: StagedImageStore }) {
	const { t } = useT("chat");
	const draft = useStagedImages(draftKey, store);
	if (draftKey === undefined || (!draft.images.length && !draft.rejected.length && !draft.notice)) return null;
	const remove = (id: string) => store.remove(draftKey, id);
	return (
		<div data-testid="staged-images" className={cn("flex flex-col gap-1.5 px-1 pt-1", className)}>
			{(draft.images.length > 0 || draft.rejected.length > 0) && (
				<ul aria-label={t("attachments.staged")} className="flex flex-wrap gap-2">
					{draft.images.map(image => (
						<li key={image.id} data-testid="staged-image" className="relative">
							{/* Local unsent bytes: no remote optimization applies. */}
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={`data:${image.mimeType};base64,${image.data}`} alt={t("attachments.preview", { name: image.name })} draggable={false}
								className="block size-14 rounded-md border bg-muted/50 object-cover" />
							<button type="button" aria-label={t("attachments.remove", { name: image.name })} onClick={() => remove(image.id)}
								className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground">
								<XIcon className="size-3" aria-hidden />
							</button>
						</li>
					))}
					{draft.rejected.map(entry => (
						<li key={entry.id} data-testid="staged-image-error" className="flex max-w-full items-center gap-1.5 rounded border bg-muted/50 px-1.5 py-0.5 text-sm">
							<ImageOffIcon className="size-3.5 shrink-0 text-destructive" aria-hidden />
							<span className="min-w-0 truncate" title={entry.name}>{entry.name}</span>
							<span role="alert" className="shrink-0 text-xs text-destructive">{t(PROBLEM_KEY[entry.problem])}</span>
							<button type="button" aria-label={t("attachments.remove", { name: entry.name })} onClick={() => remove(entry.id)}
								className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
								<XIcon className="size-3" aria-hidden />
							</button>
						</li>
					))}
				</ul>
			)}
			{draft.notice && (
				<div role="status" className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 font-ui text-xs">
					<span className="min-w-0 flex-1">{t("filePaths.browserNotice")}</span>
					<button type="button" aria-label={t("filePaths.dismissNotice")} onClick={() => store.setNotice(draftKey, "")} className="shrink-0 rounded-sm p-1 hover:bg-accent"><XIcon className="size-3" aria-hidden /></button>
				</div>
			)}
		</div>
	);
}
