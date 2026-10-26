import { reviews, reviewResponse } from "@/src/server";

export async function GET(_req: Request, { params }: { params: Promise<{ chatId: string }> }) {
	const { chatId } = await params;
	return reviewResponse(() => reviews.status(chatId));
}

export async function POST(req: Request, { params }: { params: Promise<{ chatId: string }> }) {
	const { chatId } = await params;
	const body = await req.json().catch(() => ({}));
	return reviewResponse(() => reviews.rate(chatId, body.concludeCallId, body.rating));
}
