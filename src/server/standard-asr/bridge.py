"""LearnHarness's bridge to Standard ASR (local dictation, 2026-10-25).

Runs inside the app's own speech environment (a uv venv holding the
standard-asr core and the engine plugins the learner installed). Two shapes:

  python bridge.py inventory|status|acquire
      One management request: a JSON line on stdin, NDJSON {"kind", "value"}
      lines on stdout ending in "result" or "error". Each call is a fresh
      interpreter, so engines installed a moment ago are discovered.

  python bridge.py serve
      The resident recognizer. Listens on 127.0.0.1 (a free port) and prints
      {"kind": "listening", "value": {"port": N}}. A renderer connects over
      WebSocket and must send the per-launch token (LH_ASR_TOKEN) in its first
      frame. Engines are created once and warmed (prepare()), so a dictation
      never pays a model load. The parent controls it over stdin
      ({"cmd": "warm", "model": ...} / {"cmd": "evict"}); stdin closing means
      the parent is gone, and the bridge exits.

The session protocol (one dictation per connection):
  client → {"type": "start", "token", "model", "options": {"language"?},
            "terms": [...]}  then binary pcm_s16le mono frames, then
            {"type": "end"}
  server → {"type": "ready", "sampleRate", "mode", "partials"}, then
            {"type": "event", "event": <TranscriptionEvent>} per event, then
            {"type": "transcript", "text"} and a normal close. A failure is
            {"type": "error", "code", "message"} and a close.
"""

import asyncio
import contextlib
import hmac
import importlib.metadata as metadata
import json
import os
import platform
import sys
import threading
import unicodedata

OUTPUT = sys.stdout
OUTPUT_LOCK = threading.Lock()

# The context budget for prompt guidance, in Standard ASR's gating units
# (words, plus one per character of a script written without spaces).
PROMPT_BUDGET = 400


def emit(kind, value):
    with OUTPUT_LOCK:
        OUTPUT.write(json.dumps({"kind": kind, "value": value}, default=str) + "\n")
        OUTPUT.flush()


def error_message(error):
    from standard_asr.runtime.redaction import safe_exception_summary

    return safe_exception_summary(error)


# ─── Discovery ──────────────────────────────────────────────────────────────


def package(dist):
    direct = json.loads(dist.read_text("direct_url.json") or "{}")
    vcs = direct.get("vcs_info", {})
    return {
        "name": dist.metadata["Name"],
        "version": dist.version,
        "source": direct.get("url"),
        "commit": vcs.get("commit_id"),
        "editable": direct.get("dir_info", {}).get("editable", False),
        "engines": sorted({ep.name.split("/")[0] for ep in dist.entry_points if ep.group == "standard_asr.models"}),
    }


def dictation_mode(supports, props):
    """How LearnHarness records for a model: stream PCM when the engine takes
    it incrementally, otherwise send the whole recording at the end."""
    incremental = supports("streaming_input") and (props.wire_encodings is None or "pcm_s16le" in props.wire_encodings)
    if incremental:
        mode = "streaming"
    elif supports("batch"):
        mode = "batch"
    else:
        mode = None
    rate = (props.required_input_sample_rate or props.native_sample_rate) if incremental else 16000
    return {
        "mode": mode,
        "sampleRate": rate,
        "partials": bool(incremental and supports("streaming.emits_partials")),
    }


def node(tree, *path):
    for key in path:
        if not isinstance(tree, dict):
            return None
        tree = tree.get(key)
    return tree


def declarations(registry, key):
    from standard_asr.runtime.interface import require_engine_protocol

    spec = registry.spec(key)
    result = {
        "key": key,
        "engine": spec.engine_id,
        "name": spec.model_name,
        "package": spec.entry_point.dist.metadata["Name"] if spec.entry_point.dist else None,
        "description": None,
        "languages": [],
        "sampleRate": None,
        "mode": None,
        "partials": False,
        "prompt": False,
        "phraseHints": False,
        "error": None,
    }
    try:
        cls = registry.engine_class(key)
        props = require_engine_protocol(cls)
        caps = cls.declared_capabilities
        chosen = dictation_mode(caps.supports, props)
        mode = chosen["mode"]
        result.update(
            description=props.description,
            languages=list(props.selectable_languages),
            sampleRate=chosen["sampleRate"],
            mode=mode,
            partials=chosen["partials"],
            prompt=bool(mode and caps.supports(mode + ".guidance.prompt")),
            phraseHints=bool(mode and caps.supports(mode + ".guidance.phrase_hints")),
        )
    except Exception as error:
        result["error"] = error_message(error)
    return result


def inventory(registry):
    packages = [package(dist) for dist in metadata.distributions()]
    core = next((p for p in packages if p["name"].lower().replace("_", "-") == "standard-asr"), None)
    return {
        "core": core,
        "plugins": [p for p in packages if p["engines"]],
        "models": [declarations(registry, key) for key in registry.names()],
        "python": platform.python_version(),
        "diagnostics": ["Conflicting engine identity: " + name for name in sorted(registry.shadowed_engine_ids)],
    }


def artifact_report(engine, mode):
    from standard_asr.contract.artifacts import ArtifactContext

    return engine.artifact_status(ArtifactContext(mode=mode))


def status(registry, key):
    """The files the dictation mode needs, without downloading anything."""
    try:
        engine = registry.create(key)
    except Exception as error:
        return {"key": key, "report": None, "error": error_message(error)}
    mode = dictation_mode(engine.supports, engine.properties)["mode"]
    if mode is None:
        return {"key": key, "report": None, "error": "This model has neither PCM streaming nor batch transcription."}
    try:
        return {"key": key, "report": artifact_report(engine, mode).model_dump(mode="json"), "error": None}
    except Exception as error:
        return {"key": key, "report": None, "error": error_message(error)}


def acquire(registry, key):
    from standard_asr.contract.artifacts import ArtifactContext

    engine = registry.create(key)
    mode = dictation_mode(engine.supports, engine.properties)["mode"]
    report = engine.acquire_artifacts(
        ArtifactContext(mode=mode),
        progress=lambda value: emit("progress", value.model_dump(mode="json")),
    )
    return report.model_dump(mode="json")


# ─── Guidance ───────────────────────────────────────────────────────────────


def spaceless(char):
    """A character of a script written without spaces (Han, kana, Hangul…)."""
    if char.isspace():
        return False
    name = unicodedata.name(char, "")
    return any(script in name for script in ("CJK", "HIRAGANA", "KATAKANA", "HANGUL", "THAI", "LAO", "KHMER", "MYANMAR"))


def units(text):
    """Standard ASR's gating count: whitespace words, plus one per character
    of a spaceless script."""
    words = 0
    for token in text.split():
        cjk = sum(1 for c in token if spaceless(c))
        rest = "".join(" " if spaceless(c) else c for c in token).split()
        words += cjk + len(rest)
    return words


def guidance(engine, mode, terms):
    """Turn the session's vocabulary into the guidance the engine accepts:
    phrase hints when it has them, otherwise a short prompt listing the
    terms. Every limit the engine declares is respected."""
    terms = [t.strip() for t in terms if isinstance(t, str) and t.strip()]
    if not terms or mode is None:
        return {}
    caps = getattr(engine, "effective_capabilities", None) or type(engine).declared_capabilities
    tree = caps.canonical_json()
    if engine.supports(mode + ".guidance.phrase_hints"):
        constraints = node(tree, mode, "guidance", "phrase_hints", "constraints") or {}
        max_terms = constraints.get("max_terms")
        max_chars = constraints.get("max_chars_per_term")
        max_words = constraints.get("max_words_per_term")
        hints = [
            t for t in terms
            if (max_chars is None or len(t) <= max_chars) and (max_words is None or units(t) <= max_words)
        ]
        return {"phrase_hints": hints[:max_terms] if max_terms else hints}
    if engine.supports(mode + ".guidance.prompt"):
        limit = node(tree, mode, "guidance", "prompt", "constraints", "max_tokens")
        budget = min(PROMPT_BUDGET, limit) if limit else PROMPT_BUDGET
        cjk = sum(1 for t in terms for c in t if spaceless(c)) > sum(len(t) for t in terms) / 2
        separator = "、" if cjk else ", "
        chosen = []
        for term in terms:
            candidate = separator.join(chosen + [term])
            if units(candidate) > budget:
                break
            chosen.append(term)
        return {"prompt": separator.join(chosen)} if chosen else {}
    return {}


# ─── Resampling ─────────────────────────────────────────────────────────────

# The renderer always captures 16 kHz mono pcm_s16le (one app-lifetime
# AudioContext); an engine that streams at another rate gets it resampled.
CAPTURE_RATE = 16000


class Resampler:
    """Stateful linear resampling of pcm_s16le across chunk boundaries —
    plenty for speech going into a recognizer."""

    def __init__(self, source, target):
        self.ratio = source / target
        self.position = 0.0  # in source samples, relative to the carried sample
        self.carry = None

    def __call__(self, chunk):
        import numpy as np

        if self.ratio == 1:
            return chunk
        samples = np.frombuffer(chunk, dtype="<i2").astype(np.float32)
        if self.carry is not None:
            samples = np.concatenate(([self.carry], samples))
        if len(samples) < 2:
            self.carry = samples[-1] if len(samples) else self.carry
            return b""
        positions = np.arange(self.position, len(samples) - 1, self.ratio)
        out = np.interp(positions, np.arange(len(samples)), samples)
        self.position = (positions[-1] + self.ratio) - (len(samples) - 1) if len(positions) else self.position - (len(samples) - 1)
        self.carry = samples[-1]
        return np.clip(np.round(out), -32768, 32767).astype("<i2").tobytes()


# ─── The resident recognizer ────────────────────────────────────────────────


class Recognizer:
    def __init__(self, token):
        from standard_asr import discover_models

        self.token = token
        self.registry = discover_models()
        self.engines = {}
        self.active = None  # the live connection's cancel event

    def engine(self, key):
        """The warmed engine for a model — created and prepared on first use,
        on the event-loop thread (MLX keeps per-thread streams)."""
        if key not in self.engines:
            engine = self.registry.create(key)
            prepare = getattr(engine, "prepare", None)
            if callable(prepare):
                prepare()
            self.engines[key] = engine
        return self.engines[key]

    def warm(self, key):
        try:
            self.engine(key)
            emit("warm", {"model": key, "ok": True, "error": None})
        except Exception as error:
            emit("warm", {"model": key, "ok": False, "error": error_message(error)})

    def evict(self):
        # Drop every loaded engine (the parent switches models one at a
        # time); the memory goes back once the collector runs.
        self.engines.clear()
        import gc

        gc.collect()

    async def handle(self, ws):
        cancelled = asyncio.Event()
        if self.active is not None:
            self.active.set()  # a newer dictation replaces the older one
        self.active = cancelled
        try:
            await self.session(ws, cancelled)
        finally:
            if self.active is cancelled:
                self.active = None

    async def fail(self, ws, code, message):
        with contextlib.suppress(Exception):
            await ws.send(json.dumps({"type": "error", "code": code, "message": message}))
            await ws.close(1000)

    async def session(self, ws, cancelled):
        import numpy as np
        from standard_asr import AudioArray, AudioFormat, RuntimeParams

        try:
            first = await asyncio.wait_for(ws.recv(), timeout=10)
            start = json.loads(first) if isinstance(first, str) else None
        except Exception:
            start = None
        if not isinstance(start, dict) or start.get("type") != "start":
            return await self.fail(ws, "bad_request", "The first frame must be a start message.")
        if not hmac.compare_digest(str(start.get("token", "")), self.token):
            return await self.fail(ws, "unauthorized", "Unknown session token.")
        key = start.get("model")
        if not isinstance(key, str) or key not in self.registry.names():
            return await self.fail(ws, "unknown_model", "This model is not installed.")
        try:
            engine = self.engine(key)
        except Exception as error:
            return await self.fail(ws, "service_unavailable", error_message(error))

        chosen = dictation_mode(engine.supports, engine.properties)
        mode, rate = chosen["mode"], chosen["sampleRate"]
        if mode is None:
            return await self.fail(ws, "unsupported", "This model has neither PCM streaming nor batch transcription.")
        options = {}
        language = (start.get("options") or {}).get("language")
        if isinstance(language, str) and language in engine.properties.selectable_languages:
            options["language"] = language
        options.update(guidance(engine, mode, start.get("terms") or []))
        try:
            params = RuntimeParams(**options)
        except Exception as error:
            return await self.fail(ws, "bad_request", error_message(error))

        await ws.send(json.dumps({"type": "ready", "sampleRate": CAPTURE_RATE, "mode": mode, "partials": chosen["partials"]}))

        if mode == "batch":
            chunks = []
            async for message in ws:
                if isinstance(message, bytes):
                    chunks.append(message)
                elif json.loads(message).get("type") == "end":
                    break
            if cancelled.is_set():
                return await self.fail(ws, "replaced", "A newer dictation took over.")
            samples = np.frombuffer(b"".join(chunks), dtype="<i2").astype(np.float32) / 32768
            try:
                # The standard layer resamples a whole recording itself.
                result = engine.transcribe(AudioArray(samples=samples, sample_rate=CAPTURE_RATE), params)
            except Exception as error:
                return await self.fail(ws, "engine_error", error_message(error))
            await ws.send(json.dumps({"type": "transcript", "text": result.text}))
            await ws.close(1000)
            return

        import standard_asr

        fmt = AudioFormat(encoding="pcm_s16le", sample_rate=rate, channels=1)
        try:
            context = engine.start_transcription(audio_format=fmt, params=params)
        except Exception as error:
            return await self.fail(ws, "service_unavailable", error_message(error))
        try:
            async with context as stream:
                bind = getattr(standard_asr, "bind_session_capabilities", None)
                if bind is not None:
                    with contextlib.suppress(Exception):
                        bind(stream, engine)

                resample = Resampler(CAPTURE_RATE, rate)

                async def pump():
                    # Audio in until the client's end message (or it leaves,
                    # or a newer dictation replaces this one).
                    try:
                        async for message in ws:
                            if cancelled.is_set():
                                break
                            if isinstance(message, bytes):
                                chunk = resample(message)
                                if chunk:
                                    await stream.send_audio(chunk)
                            elif json.loads(message).get("type") == "end":
                                break
                    except Exception:
                        pass
                    with contextlib.suppress(Exception):
                        await stream.end_audio()

                feeding = asyncio.create_task(pump())
                failed = False
                async for event in stream:
                    payload = event.model_dump(mode="json", exclude={"extra"} if event.type == "error" else None)
                    if event.type == "error" and not event.recoverable:
                        failed = True
                    if event.type in ("partial", "final", "supersede", "error"):
                        with contextlib.suppress(Exception):
                            await ws.send(json.dumps({"type": "event", "event": payload}))
                feeding.cancel()
                with contextlib.suppress(BaseException):
                    await feeding
                if cancelled.is_set():
                    return await self.fail(ws, "replaced", "A newer dictation took over.")
                if failed:
                    return await self.fail(ws, "engine_error", "Recognition stopped with an engine error.")
                text = stream.result().text
        except Exception as error:
            return await self.fail(ws, "engine_error", error_message(error))
        with contextlib.suppress(Exception):
            await ws.send(json.dumps({"type": "transcript", "text": text}))
            await ws.close(1000)


async def serve():
    from websockets.asyncio.server import serve as ws_serve

    token = os.environ.get("LH_ASR_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("LH_ASR_TOKEN must be set")
    recognizer = Recognizer(token)
    loop = asyncio.get_running_loop()
    stopped = loop.create_future()

    def control():
        # The parent's commands; EOF = the parent is gone.
        for line in sys.stdin:
            with contextlib.suppress(Exception):
                command = json.loads(line)
                if command.get("cmd") == "warm":
                    loop.call_soon_threadsafe(recognizer.warm, command.get("model"))
                elif command.get("cmd") == "evict":
                    loop.call_soon_threadsafe(recognizer.evict)
        loop.call_soon_threadsafe(lambda: stopped.done() or stopped.set_result(None))

    threading.Thread(target=control, daemon=True).start()
    # No keepalive pings: a decode can hold the loop for a moment, and the
    # peer is on the same machine. Frames up to 4 MiB (a few seconds of PCM
    # queued while a connection was opening).
    async with ws_serve(recognizer.handle, "127.0.0.1", 0, ping_interval=None, max_size=4 * 1024 * 1024, compression=None) as server:
        port = next(iter(server.sockets)).getsockname()[1]
        emit("listening", {"port": port})
        await stopped


def main(command):
    if command == "serve":
        # Plugins sometimes print at import time: keep stdout for the
        # parent's NDJSON channel (emit writes to the original stdout).
        with contextlib.redirect_stdout(sys.stderr):
            asyncio.run(serve())
        return
    from standard_asr import discover_models

    request = json.loads(sys.stdin.readline() or "{}")
    with contextlib.redirect_stdout(sys.stderr):
        try:
            registry = discover_models()
            if command == "inventory":
                value = inventory(registry)
            elif command == "status":
                value = status(registry, request["model"])
            elif command == "acquire":
                value = acquire(registry, request["model"])
            else:
                raise ValueError("Unknown command: " + command)
            emit("result", value)
        except Exception as error:
            report = getattr(error, "report", None)
            emit("error", {
                "message": error_message(error),
                "reason": getattr(error, "reason", None),
                "report": report.model_dump(mode="json") if report is not None else None,
            })
            sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
