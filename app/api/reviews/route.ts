import { reviews, reviewResponse } from "@/src/server";

export async function GET() {
	return reviewResponse(() => ({ items: reviews.list() }));
}

export async function POST(req: Request) {
	const body = await req.json().catch(() => ({}));
	return reviewResponse(() => ({
		message: reviews.enroll(body.nodeIds, "manual", "Chosen by the learner"),
	}));
}
