import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import type { ReviewState, ReviewStore } from "../core/review-types.ts";
import { emit } from "../core/events.ts";

/** A single atomic snapshot keeps card state and its history in the same commit. */
export function createReviewStore(file = path.join(PATHS.data, "reviews", "state.json")): ReviewStore {
	return {
		read() {
			let raw: string;
			try {
				raw = fs.readFileSync(file, "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
			const state = JSON.parse(raw) as ReviewState;
			if (
				state.version !== 1 ||
				!Array.isArray(state.knownNodeIds) ||
				!state.cards ||
				typeof state.cards !== "object"
			) {
				throw new Error("Unsupported or damaged review state");
			}
			return state;
		},
		write(state) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			const temporary = `${file}.${crypto.randomUUID()}.tmp`;
			try {
				fs.writeFileSync(temporary, JSON.stringify(state, null, "\t"), {
					encoding: "utf8",
					mode: 0o600,
				});
				fs.renameSync(temporary, file);
			} finally {
				fs.rmSync(temporary, { force: true });
			}
			emit("reviews-changed", {});
		},
	};
}
