import { uploadAttachment } from "@/src/server";

export async function POST(req: Request) {
	return uploadAttachment(req);
}
