import { reviews, reviewResponse } from "@/src/server";

export async function POST(_req: Request, { params }: { params: Promise<{ nodeId: string }> }) {
	const { nodeId } = await params;
	return reviewResponse(() => reviews.start(nodeId));
}
