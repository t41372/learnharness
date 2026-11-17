/**
 * POST-less BYOK mint: the renderer never holds the real Deepgram key.
 *
 * The key lives server-side only (auth.json → process.env in the desktop
 * app; .env.local in dev — same seam as OPENROUTER_API_KEY). The mint
 * itself lives in src/server/dictation.ts; dictation runs reach it through
 * GET /api/stt/session, which also serves the local Standard ASR engine.
 * This route stays as the Deepgram-only entry.
 */
import { mintDeepgramToken } from "@/src/server";

export async function GET() {
	const minted = await mintDeepgramToken();
	if ("token" in minted) return Response.json({ token: minted.token });
	return Response.json({ message: minted.message }, { status: minted.status });
}
