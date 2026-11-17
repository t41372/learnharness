/**
 * Local dictation's environment (Standard ASR, 2026-10-25).
 *
 *   GET   the status the Dictation settings page renders: install state,
 *         the running step + progress, installed engines and models, the
 *         selected model's files, the recognizer.
 *   POST  {op: "install" | "installEngine" | "uninstallEngine" | "download"
 *         | "warm", …}. Long steps run in the background — 202, then the
 *         page polls GET; 409 while another step runs.
 */
import { AsrBusyError, parseStandardAsrCommand, standardAsrCommand, standardAsrOverview } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(await standardAsrOverview(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
	const command = parseStandardAsrCommand(await req.json().catch(() => null));
	if (!command) return Response.json({ error: "Invalid command" }, { status: 400 });
	try {
		// Claimed synchronously inside; the work continues after we answer.
		void standardAsrCommand(command).catch(() => {});
		return Response.json({ ok: true }, { status: 202 });
	} catch (error) {
		if (error instanceof AsrBusyError) return Response.json({ error: error.message }, { status: 409 });
		throw error;
	}
}
