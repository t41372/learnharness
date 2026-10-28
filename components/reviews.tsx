"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClockIcon } from "lucide-react";
import {
	reviewContextOf,
	reviewConclusionOf,
	type LhMessage,
	type ReviewItem,
	type ReviewRating,
} from "@/src/core";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { useLanguage, useT } from "@/components/i18n";
import { useServerEvent, useServerResync } from "@/components/server-events";

async function responseData<T>(response: Response): Promise<T> {
	const data = await response.json();
	if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
	return data as T;
}

export function AddToReviewButton({ nodeIds }: { nodeIds: string[] }) {
	const { t } = useT("shell");
	const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
	const [error, setError] = useState("");
	const key = nodeIds.join(",");
	useEffect(() => {
		setState("idle");
		setError("");
	}, [key]);
	return (
		<span className="flex items-center gap-2">
			<button
				type="button"
				data-testid="add-to-review"
				disabled={state !== "idle"}
				className="rounded-full px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
				onClick={async () => {
					setState("saving");
					setError("");
					try {
						// Batches preserve the API's bounded payload even for whole-cluster selections.
						for (let i = 0; i < nodeIds.length; i += 100)
							await responseData(
								await fetch("/api/reviews", {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({ nodeIds: nodeIds.slice(i, i + 100) }),
								}),
							);
						setState("saved");
					} catch {
						setError(t("reviews.saveError"));
						setState("idle");
					}
				}}
			>
				{state === "saved" ? t("reviews.added") : t("reviews.add")}
			</button>
			{error && (
				<span role="alert" className="text-xs text-destructive">
					{error}
				</span>
			)}
		</span>
	);
}

export function ReviewNavigation() {
	const { t } = useT("shell");
	const [due, setDue] = useState<number | null>(null);
	const refresh = useCallback(() => {
		void fetch("/api/reviews")
			.then(responseData<{ items: ReviewItem[] }>)
			.then(({ items }) => setDue(items.filter((i) => i.due).length))
			.catch(() => setDue(null));
	}, []);
	useEffect(refresh, [refresh]);
	useServerEvent("reviews-changed", refresh);
	useServerResync(refresh);
	return (
		<Link
			href="/reviews"
			data-testid="review-navigation"
			className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
		>
			<CalendarClockIcon className="size-3" />
			{t("reviews.title")}
			{due !== null && <span className="ml-auto tabular-nums">{due}</span>}
		</Link>
	);
}

export function ReviewsPage() {
	const { t } = useT("shell");
	const { language } = useLanguage();
	const router = useRouter();
	const [items, setItems] = useState<ReviewItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [starting, setStarting] = useState<string | null>(null);
	const refresh = useCallback(() => {
		void fetch("/api/reviews")
			.then(responseData<{ items: ReviewItem[] }>)
			.then((data) => {
				setItems(data.items);
				setError("");
			})
			.catch(() => setError(t("reviews.loadError")))
			.finally(() => setLoading(false));
	}, [t]);
	useEffect(refresh, [refresh]);
	useServerEvent("reviews-changed", refresh);
	useServerResync(refresh);
	// Due times can pass while the app stays open, without a server mutation.
	useEffect(() => {
		const due = items
			.filter((i) => !i.due)
			.map((i) => Date.parse(i.memory.due))
			.sort((a, b) => a - b)[0];
		if (due === undefined) return;
		const timer = setTimeout(refresh, Math.min(2_147_483_647, Math.max(1000, due - Date.now())));
		return () => clearTimeout(timer);
	}, [items, refresh]);
	const start = async (nodeId: string) => {
		setStarting(nodeId);
		setError("");
		try {
			const { chatId } = await responseData<{ chatId: string }>(
				await fetch(`/api/reviews/${encodeURIComponent(nodeId)}/start`, { method: "POST" }),
			);
			router.push(`/chat/${chatId}?prompt=${encodeURIComponent(t("reviews.beginPrompt"))}`);
		} catch {
			setError(t("reviews.startError"));
			setStarting(null);
		}
	};
	const due = items.filter((i) => i.due).length;
	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<span className="text-sm font-medium">{t("reviews.title")}</span>
				<span className="ml-auto text-xs text-muted-foreground">
					{t("reviews.dueCount", { count: due })}
				</span>
			</TopBar>
			<main className="mx-auto w-full max-w-3xl overflow-y-auto px-6 py-8">
				<p className="mb-6 text-sm text-muted-foreground">{t("reviews.description")}</p>
				{error && (
					<div role="alert" className="mb-4 text-sm text-destructive">
						{error}
						<button className="ml-3 underline" onClick={refresh}>
							{t("reviews.retry")}
						</button>
					</div>
				)}
				{loading ? (
					<p>{t("reviews.loading")}</p>
				) : items.length === 0 ? (
					<p data-testid="reviews-empty">{t("reviews.empty")}</p>
				) : (
					<div className="divide-y rounded-xl border">
						{items.map((item) => (
							<article
								key={item.nodeId}
								data-testid="review-item"
								className="flex flex-wrap items-center gap-4 p-4"
							>
								<div className="min-w-0 flex-1">
									<p className="font-medium">{item.name}</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{item.due
											? t("reviews.dueNow")
											: new Date(item.memory.due).toLocaleString(language)}
										{item.retrievability !== null &&
											` · ${t("reviews.retention", { percent: Math.round(item.retrievability * 100) })}`}
									</p>
									<details className="mt-2 text-xs text-muted-foreground">
										<summary className="cursor-pointer">{t("reviews.history")}</summary>
										<p className="mt-2">
											{item.source === "agent"
												? item.reason
												: item.source === "automatic"
													? t("reviews.sourceAutomatic")
													: t("reviews.sourceManual")}
										</p>
										{item.history.map((entry) => (
											<p key={entry.id} className="mt-1">
												{new Date(entry.reviewedAt).toLocaleString(language)} ·{" "}
												{t(RATING_KEYS[entry.rating])}
											</p>
										))}
									</details>
								</div>
								{(item.due || item.activeChatId) && (
									<Button
										disabled={starting !== null}
										onClick={() => void start(item.nodeId)}
									>
										{item.activeChatId ? t("reviews.resume") : t("reviews.start")}
									</Button>
								)}
							</article>
						))}
					</div>
				)}
			</main>
		</div>
	);
}

const RATING_KEYS = { 1: "reviews.again", 2: "reviews.hard", 3: "reviews.good", 4: "reviews.easy" } as const;

export function ReviewRatingPanel({
	chatId,
	messages,
	busy,
}: {
	chatId: string;
	messages: readonly LhMessage[];
	busy: boolean;
}) {
	const { t } = useT("shell");
	const { language } = useLanguage();
	const context = reviewContextOf(messages);
	const conclusion = context ? reviewConclusionOf(messages, context.nodeId) : null;
	const [data, setData] = useState<{ rated: boolean; outcomes: Record<ReviewRating, string> } | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		if (!conclusion || busy) return;
		let alive = true;
		void fetch(`/api/reviews/sessions/${chatId}`)
			.then(responseData<{ rated: boolean; outcomes: Record<ReviewRating, string> }>)
			.then((value) => {
				if (alive) setData(value);
			})
			.catch(() => {
				if (alive) setError(t("reviews.loadError"));
			});
		return () => {
			alive = false;
		};
	}, [chatId, conclusion, busy, t]);
	if (!context || !conclusion || busy) return null;
	return (
		<section data-testid="review-rating" className="my-4 rounded-xl border bg-card p-4">
			{data?.rated ? (
				<p>
					{t("reviews.scheduled")}{" "}
					<Link className="underline" href="/reviews">
						{t("reviews.back")}
					</Link>
				</p>
			) : (
				<>
					<p className="mb-3 text-sm">{t("reviews.ratePrompt")}</p>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{([1, 2, 3, 4] as const).map((rating) => (
							<Button
								key={rating}
								variant="outline"
								disabled={saving || !data}
								className="h-auto flex-col gap-1 py-2"
								onClick={async () => {
									setSaving(true);
									setError("");
									try {
										await responseData(
											await fetch(`/api/reviews/sessions/${chatId}`, {
												method: "POST",
												headers: { "Content-Type": "application/json" },
												body: JSON.stringify({ rating, concludeCallId: conclusion }),
											}),
										);
										setData((current) => current && { ...current, rated: true });
									} catch {
										setError(t("reviews.saveError"));
									} finally {
										setSaving(false);
									}
								}}
							>
								{t(RATING_KEYS[rating])}
								{data && (
									<span className="text-[10px] font-normal text-muted-foreground">
										{new Date(data.outcomes[rating]).toLocaleString(language)}
									</span>
								)}
							</Button>
						))}
					</div>
				</>
			)}
			{error && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{error}
				</p>
			)}
		</section>
	);
}
