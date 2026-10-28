/** Refuse incomplete preview builds before compiling or replacing artifacts. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const exists = (ref) => {
	try { git("rev-parse", "--verify", ref); return true; } catch { return false; }
};
const sha = (ref) => git("rev-parse", "--verify", `${ref}^{commit}`);
const ancestor = (parent, child) => {
	try { git("merge-base", "--is-ancestor", parent, child); return true; } catch { return false; }
};

function verify() {
	const config = JSON.parse(readFileSync(resolve(root, "fork-features.json"), "utf8"));
	if (process.argv.includes("--fetch")) {
		const origin = git("remote", "get-url", "origin");
		if (!origin.replace(/\.git$/, "").endsWith(`/${config.repository}`) && !origin.replace(/\.git$/, "").endsWith(`:${config.repository}`)) {
			throw new Error(`origin must point to ${config.repository}`);
		}
		git("fetch", "--no-tags", "origin");
		git("fetch", "--no-tags", `https://github.com/${config.upstream}.git`, "main:refs/remotes/upstream/main");
	}
	const failures = [];
	const branch = git("rev-parse", "--abbrev-ref", "HEAD");
	if (branch !== config.preview && !(process.env.CI && branch === "HEAD")) failures.push(`build from ${config.preview}, currently ${branch}`);
	if (git("status", "--porcelain")) failures.push("commit or preserve working tree changes before building a preview");
	const head = sha("HEAD");
	const upstream = sha("refs/remotes/upstream/main");
	const baseline = sha(`refs/remotes/origin/${config.baseline}`);
	if (baseline !== upstream) failures.push(`origin/${config.baseline} must equal upstream/main`);
	if (exists(`refs/heads/${config.baseline}`) && sha(`refs/heads/${config.baseline}`) !== upstream) failures.push(`local ${config.baseline} must equal upstream/main`);
	if (!ancestor(upstream, head)) failures.push("preview is missing the current upstream/main");
	const registered = new Set(config.features.map(({ branch }) => branch));
	const allFeatures = git("for-each-ref", "--format=%(refname)", "refs/heads/feat/", "refs/remotes/origin/feat/").split("\n").filter(Boolean);
	for (const ref of allFeatures) {
		const name = ref.replace(/^refs\/(heads|remotes\/origin)\//, "");
		if (!registered.has(name)) failures.push(`unregistered feature branch: ${name}`);
	}
	const features = [];
	for (const feature of config.features) {
		const remote = `refs/remotes/origin/${feature.branch}`;
		if (!exists(remote)) { failures.push(`publish ${feature.branch} to origin first`); continue; }
		const commit = sha(remote);
		if (exists(`refs/heads/${feature.branch}`) && sha(`refs/heads/${feature.branch}`) !== commit) failures.push(`local and remote ${feature.branch} differ`);
		if (!ancestor(upstream, commit)) failures.push(`${feature.branch} has not incorporated the current upstream/main`);
		if (!ancestor(commit, head)) failures.push(`preview is missing ${feature.branch} at ${commit.slice(0, 12)}`);
		for (const dependency of feature.dependsOn) {
			if (!registered.has(dependency)) failures.push(`${feature.branch} has an unregistered dependency: ${dependency}`);
			else if (!exists(`refs/remotes/origin/${dependency}`) || !ancestor(`refs/remotes/origin/${dependency}`, commit)) failures.push(`${feature.branch} must incorporate the latest ${dependency}`);
		}
		features.push({ ...feature, commit });
	}
	if (failures.length) throw new Error([...new Set(failures)].map(message => `- ${message}`).join("\n"));
	const manifest = { repository: config.repository, branch: config.preview, commit: head, upstream, features };
	const outputIndex = process.argv.indexOf("--write");
	if (outputIndex !== -1) {
		if (!process.argv[outputIndex + 1]) throw new Error("--write requires an output path");
		const output = resolve(root, process.argv[outputIndex + 1]);
		mkdirSync(dirname(output), { recursive: true });
		writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
	}
	console.log(`[fork-preview] complete: upstream ${upstream.slice(0, 12)}, ${features.length} current feature branches, preview ${head.slice(0, 12)}`);
}

try { verify(); } catch (error) {
	console.error(`[fork-preview] verification failed:\n${error.message}`);
	process.exitCode = 1;
}
