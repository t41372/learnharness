import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, afterEach, beforeEach, mock, test } from "node:test";

// Exercise the real environment orchestration with a process double. No
// Python packages or model weights are installed by these tests.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-asr-environment-"));
const previousDataDir = process.env.LH_DATA_DIR;
const previousUv = process.env.LH_UV_PATH;
process.env.LH_DATA_DIR = dataDir;
process.env.LH_UV_PATH = path.join(dataDir, "uv");
fs.writeFileSync(process.env.LH_UV_PATH, "");

const environment = await import("../src/server/standard-asr/environment.ts");
const { recommendedEngine } = await import("../src/server/standard-asr/pins.ts");
const pick = recommendedEngine();
const calls: Array<{ args: string[]; policy: string | undefined }> = [];
let acquired = false;
let failAcquisition = false;
let stopCount = 0;
let warmed: string[] = [];
const hooks = { stopRecognizer: () => { stopCount++; }, warm: (key: string) => { warmed.push(key); } };

beforeEach(() => {
	delete (globalThis as { __lhStandardAsr?: unknown }).__lhStandardAsr;
	fs.rmSync(path.join(dataDir, "speech"), { recursive: true, force: true });
	calls.length = 0;
	acquired = false;
	failAcquisition = false;
	stopCount = 0;
	warmed = [];
	mock.method(childProcess, "spawn", (_file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
		calls.push({ args, policy: options.env.STANDARD_ASR_ALLOW_DOWNLOAD });
		const child = Object.assign(new EventEmitter(), {
			stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
		});
		let input = "";
		child.stdin.on("data", (chunk) => { input += String(chunk); });
		child.stdin.on("finish", () => {
			if (args[0] === "venv") {
				fs.mkdirSync(path.dirname(environment.venvPython()), { recursive: true });
				fs.writeFileSync(environment.venvPython(), "");
			} else if (args.at(-1) === "inventory") {
				child.stdout.write(JSON.stringify({ kind: "result", value: {
					core: { name: "standard-asr" },
					plugins: [{ name: pick.package }],
					models: [{ key: pick.model }],
				} }) + "\n");
			} else if (args.at(-1) === "status") {
				const key = (JSON.parse(input) as { model: string }).model;
				child.stdout.write(JSON.stringify({ kind: "result", value: { key, error: null, report: {
					applicable: true, readiness: acquired ? "ready" : "unavailable", requirements: [{
						artifact_id: "weights", state: acquired ? "ready" : "missing", required_for_inference: true,
						can_acquire_now: !acquired && options.env.STANDARD_ASR_ALLOW_DOWNLOAD === "1", required_actions: [],
					}],
				} } }) + "\n");
			} else if (args.at(-1) === "acquire") {
				acquired = !failAcquisition;
				child.stdout.write(JSON.stringify(failAcquisition
					? { kind: "error", value: { message: "Transfer interrupted" } }
					: { kind: "result", value: {} }) + "\n");
			}
			child.emit("close", 0);
		});
		return child;
	});
	syncBuiltinESMExports();
});

afterEach(() => {
	mock.restoreAll();
	syncBuiltinESMExports();
});

after(() => {
	fs.rmSync(dataDir, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.LH_DATA_DIR;
	else process.env.LH_DATA_DIR = previousDataDir;
	if (previousUv === undefined) delete process.env.LH_UV_PATH;
	else process.env.LH_UV_PATH = previousUv;
});

test("recommended installation stops after packages: no model selection, acquisition or warm-up", async () => {
	await environment.installRecommended(hooks);
	assert.equal(stopCount, 1);
	assert(calls.some(({ args }) => args.includes(pick.requirement)));
	assert(!calls.some(({ args }) => args.at(-1) === "acquire"));
	assert.deepEqual(warmed, []);
	assert(!fs.existsSync(path.join(dataDir, "settings.json")));
	assert.equal((await environment.standardAsrStatus(null, "stopped")).installed, true);
});

test("a custom plugin can create the environment without installing the recommended plugin", async () => {
	await environment.installEngine("custom-speech-plugin", hooks);
	const install = calls.find(({ args }) => args[0] === "pip");
	assert(install?.args.includes("custom-speech-plugin"));
	assert(!install?.args.includes(pick.requirement));
	assert(!calls.some(({ args }) => args.at(-1) === "acquire"));
	assert.deepEqual(warmed, []);
});

test("status offers explicit downloads while the recognizer remains offline", async () => {
	const status = await environment.modelStatus(pick.model);
	assert.equal(status.report?.requirements[0]?.can_acquire_now, true);
	assert.equal(calls.at(-1)?.policy, "1");
	assert(!calls.some(({ args }) => args.at(-1) === "acquire"));
	assert.equal(environment.pythonEnv(false).STANDARD_ASR_ALLOW_DOWNLOAD, "0");
});

test("a second operation throws synchronously so the route can return 409", async () => {
	const installation = environment.installRecommended(hooks);
	assert.throws(() => environment.downloadModel(pick.model, hooks), environment.AsrBusyError);
	await installation;
});

test("an interrupted download refreshes status and can retry, warming only after success", async () => {
	await environment.installRecommended(hooks);
	await environment.modelStatus(pick.model);
	failAcquisition = true;
	await environment.downloadModel(pick.model, hooks);
	const failed = await environment.standardAsrStatus(pick.model, "stopped");
	assert.equal(failed.error, "Transfer interrupted");
	assert.equal(failed.selectedStatus?.report?.requirements[0]?.can_acquire_now, true);
	assert.equal(calls.filter(({ args }) => args.at(-1) === "status").length, 2);
	assert.deepEqual(warmed, []);
	failAcquisition = false;
	await environment.downloadModel(pick.model, hooks);
	const ready = await environment.standardAsrStatus(pick.model, "ready");
	assert.equal(ready.error, null);
	assert.equal(ready.selectedStatus?.report?.readiness, "ready");
	assert.deepEqual(warmed, [pick.model]);
});
