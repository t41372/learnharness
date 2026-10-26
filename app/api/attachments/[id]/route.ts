import { serveAttachment } from "@/src/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return serveAttachment(id, new URL(req.url).searchParams.get("download") === "1");
}
