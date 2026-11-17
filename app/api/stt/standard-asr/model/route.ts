/** One installed model's file status (GET ?key=engine/model): the
 *  dictation mode's artifact report, read fresh (no download). */
import { standardAsrModelStatus } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const key = new URL(req.url).searchParams.get("key") ?? "";
	if (!/^[a-z0-9][a-z0-9._-]*\/\S*$/.test(key)) return Response.json({ error: "Invalid model key" }, { status: 400 });
	return Response.json(await standardAsrModelStatus(key), { headers: { "Cache-Control": "no-store" } });
}
