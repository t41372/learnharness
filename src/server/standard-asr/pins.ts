/**
 * What the one-click install puts in the speech environment (local
 * dictation, 2026-10-25). Standard ASR has no PyPI release carrying
 * protocol 0.2 yet, and its engine plugins track the core's `main` — so
 * every requirement is PINNED to a commit: an install made today and one
 * made next month resolve the same code. The core pin also goes in as an
 * uv override, so a plugin's own `standard-asr @ …@main` dependency
 * converges on it instead of floating.
 *
 * Upgrading: bump the commits together (core first), reinstall, and run
 * the opt-in live check (docs/development.md, "Local dictation").
 */

export const STANDARD_ASR_COMMIT = "57f7f5cabf7c148bb6ea2ee1601f6dc520eaf747";

export const CORE_REQUIREMENT = `standard-asr @ git+https://github.com/standard-voice/standard_asr.git@${STANDARD_ASR_COMMIT}`;

/** The bridge's own WebSocket server (src/server/standard-asr/bridge.py). */
export const BRIDGE_REQUIREMENTS = ["websockets==15.0.1"];

/** The Python the venv is created with (uv fetches it when absent). */
export const PYTHON_VERSION = "3.12";

/** The engine the one-click install recommends on this platform. */
export interface RecommendedEngine {
	/** The model's display name. */
	label: string;
	/** What runs it — shown beside the label. */
	runtime: string;
	/** A model provided by the recommended plugin. */
	model: string;
	/** The plugin's distribution name (its sources.json key). */
	package: string;
	/** The pinned requirement. */
	requirement: string;
}

const MLX: RecommendedEngine = {
	label: "Qwen3-ASR 0.6B",
	runtime: "MLX on Apple Silicon",
	model: "mlx-audio/qwen3-asr-0.6b",
	package: "std-mlx-audio",
	requirement: "std-mlx-audio @ git+https://github.com/standard-voice/std-mlx-audio.git@7af16dd734e98cf11ec7f897b4962626ee654526",
};

const FASTER_WHISPER: RecommendedEngine = {
	label: "Whisper small",
	runtime: "faster-whisper",
	model: "faster-whisper/small",
	package: "std-faster-whisper",
	requirement: "std-faster-whisper @ git+https://github.com/standard-voice/std-faster-whisper.git@92af8712c64a1ce8f390b92cdbb9a2335c4a8b52",
};

/** MLX runs only on Apple Silicon; everywhere else faster-whisper (CPU). */
export function recommendedEngine(platform: string = process.platform, arch: string = process.arch): RecommendedEngine {
	return platform === "darwin" && arch === "arm64" ? MLX : FASTER_WHISPER;
}
