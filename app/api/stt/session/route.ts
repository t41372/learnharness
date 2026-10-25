/**
 * One dictation run's connection (local dictation, 2026-10-25): Deepgram's
 * short-lived token, or the local Standard ASR recognizer's loopback URL +
 * launch token — whichever engine Settings → Dictation selects. Refusals
 * carry a machine `code` the Dictate button keys its message on.
 */
import { dictationSession } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const session = await dictationSession();
	if ("engine" in session) return Response.json(session, { headers: { "Cache-Control": "no-store" } });
	return Response.json({ code: session.code, message: session.message }, { status: session.status });
}
