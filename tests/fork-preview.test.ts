import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const verifier = fileURLToPath(new URL("../scripts/verify-fork-preview.mjs", import.meta.url));

function repository() {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "fork-preview-test-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	git("init", "--initial-branch=main");
	git("config", "user.name", "Preview Test");
	git("config", "user.email", "preview@example.invalid");
	git("config", "commit.gpgsign", "false");
	writeFileSync(path.join(cwd, "fork-features.json"), JSON.stringify({
		baseline: "main", preview: "fork-preview", features: [{ branch: "feat/example", dependsOn: [] }],
	}));
	git("add", ".");
	git("commit", "-m", "test: establish upstream baseline");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("update-ref", "refs/remotes/upstream/main", "HEAD");
	git("checkout", "-b", "feat/example");
	git("commit", "--allow-empty", "-m", "feat: example");
	git("update-ref", "refs/remotes/origin/feat/example", "HEAD");
	git("checkout", "-b", "fork-preview", "main");
	git("merge", "--no-ff", "feat/example", "-m", "chore: preview example");
	return { cwd, git, verify: () => spawnSync(process.execPath, [verifier], { cwd, encoding: "utf8", env: { ...process.env, CI: "" } }), cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("preview verifier accepts the complete, committed feature set", () => {
	const repo = repository();
	try { assert.equal(repo.verify().status, 0); } finally { repo.cleanup(); }
});

test("preview verifier refuses remote feature updates omitted from the preview", () => {
	const repo = repository();
	try {
		const update = repo.git("commit-tree", "feat/example^{tree}", "-p", "feat/example", "-m", "fix: remote update");
		repo.git("update-ref", "refs/remotes/origin/feat/example", update);
		const result = repo.verify();
		assert.equal(result.status, 1);
		assert.match(result.stderr, /preview is missing feat\/example/);
		assert.match(result.stderr, /local and remote feat\/example differ/);
	} finally { repo.cleanup(); }
});

test("preview verifier refuses an unregistered remote feature", () => {
	const repo = repository();
	try {
		repo.git("update-ref", "refs/remotes/origin/feat/forgotten", "HEAD");
		assert.match(repo.verify().stderr, /unregistered feature branch: feat\/forgotten/);
	} finally { repo.cleanup(); }
});

test("preview verifier refuses a baseline that no longer matches upstream", () => {
	const repo = repository();
	try {
		repo.git("update-ref", "refs/remotes/upstream/main", "feat/example");
		const result = repo.verify();
		assert.equal(result.status, 1);
		assert.match(result.stderr, /origin\/main must equal upstream\/main/);
	} finally { repo.cleanup(); }
});

test("preview verifier refuses uncommitted source changes", () => {
	const repo = repository();
	try {
		writeFileSync(path.join(repo.cwd, "uncommitted.txt"), "uncommitted");
		assert.match(repo.verify().stderr, /commit or preserve working tree changes/);
	} finally { repo.cleanup(); }
});

test("preview verifier refuses a tracked local dependency link", () => {
	const repo = repository();
	try {
		symlinkSync("/local/dependencies", path.join(repo.cwd, "node_modules"));
		repo.git("add", "node_modules");
		repo.git("commit", "-m", "test: accidentally track dependencies");
		const result = repo.verify();
		assert.equal(result.status, 1);
		assert.match(result.stderr, /must not track dependencies or build outputs/);
	} finally { repo.cleanup(); }
});

test("preview verifier refuses changes developed directly on the preview", () => {
	const repo = repository();
	try {
		repo.git("commit", "--allow-empty", "-m", "fix: untracked preview-only development");
		const result = repo.verify();
		assert.equal(result.status, 1);
		assert.match(result.stderr, /preview-only commit .* must belong to a feature branch/);
	} finally { repo.cleanup(); }
});
