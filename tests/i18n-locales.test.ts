/**
 * The locale files' integrity (i18n wave, 2026-10-25): English is the
 * reference, and every other language must carry exactly its keys — a
 * missing key would silently render English, an extra one is dead copy.
 * Plural forms compare by base key (English has _one/_other, Chinese only
 * _other). Interpolation variables must match too: a translation that
 * drops {{count}} hides a number the English shows.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { LANGUAGES } from "../src/core/language.ts";

const ROOT = path.join(import.meta.dirname, "..", "locales");
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(value: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
	if (typeof value === "string") {
		out.set(prefix, value);
		return out;
	}
	assert.ok(value && typeof value === "object" && !Array.isArray(value), `${prefix || "<root>"} must be an object or a string`);
	for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
	return out;
}

function read(lang: string, ns: string): Map<string, string> {
	return flatten(JSON.parse(fs.readFileSync(path.join(ROOT, lang, `${ns}.json`), "utf-8")));
}

/** base key → the set of {{variables}} its forms use */
function byBase(entries: Map<string, string>): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const [key, text] of entries) {
		const base = key.replace(PLURAL, "");
		const vars = out.get(base) ?? new Set<string>();
		for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)) vars.add(m[1]!);
		out.set(base, vars);
	}
	return out;
}

const namespaces = fs
	.readdirSync(path.join(ROOT, "en"))
	.filter((f) => f.endsWith(".json"))
	.map((f) => f.slice(0, -".json".length))
	.sort();

describe("locale files", () => {
	it("every language ships the same namespaces as English", () => {
		for (const lang of LANGUAGES) {
			const files = fs.readdirSync(path.join(ROOT, lang)).filter((f) => f.endsWith(".json")).sort();
			assert.deepEqual(files, namespaces.map((ns) => `${ns}.json`), lang);
		}
	});

	for (const ns of namespaces) {
		it(`${ns}: every language carries exactly the English keys and variables`, () => {
			const en = byBase(read("en", ns));
			for (const lang of LANGUAGES) {
				if (lang === "en") continue;
				const other = byBase(read(lang, ns));
				const missing = [...en.keys()].filter((k) => !other.has(k));
				const extra = [...other.keys()].filter((k) => !en.has(k));
				assert.deepEqual(missing, [], `${lang}/${ns}.json is missing keys`);
				assert.deepEqual(extra, [], `${lang}/${ns}.json has keys English lacks`);
				for (const [key, vars] of en) {
					assert.deepEqual([...other.get(key)!].sort(), [...vars].sort(), `${lang}/${ns}.json ${key}: interpolation variables differ`);
				}
			}
		});

		it(`${ns}: no empty strings`, () => {
			for (const lang of LANGUAGES) {
				for (const [key, text] of read(lang, ns)) assert.ok(text.trim() !== "", `${lang}/${ns}.json ${key} is empty`);
			}
		});
	}
});
