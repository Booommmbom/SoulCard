// Nuomu Soul — 100% Autonomous Zero-DSH Companion Runtime Engine
// Zero external dependencies, zero opaque zstd session archives, zero vendor lock-in.
// Persists all cognitive state transparently as human-readable JSONL / JSON / Markdown
// under `NUOMU_DATA_DIR`, directly compatible with daily/weekly/monthly/soul-ledger workflows.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { composeAmbientCheckInMessage, evaluateAmbientCheckIn } from "../core/ambient-presence.mjs";
import {
  DEFAULT_PERSONA,
  assembleCompanionPrompt,
  postprocessCompanionReply,
  shouldCaptureMemoryEvent,
} from "../core/companion-brain.mjs";
import { driftPadEmotion } from "../core/emotion-pad.mjs";
import { collectActiveOpenLoops, detectResolvedOpenLoops } from "../core/episode-consolidation.mjs";
import { computePromptDeclutterStats } from "../core/growth-evolution.mjs";
import { snapshotInnerLife } from "../core/inner-life.mjs";
import { buildBiTemporalTriples } from "../core/memory-graph-v2.mjs";
import { maskApiKey } from "../core/provider-compat.mjs";
import { runDailyConsolidation } from "./daily-consolidate.mjs";
import { callUnifiedLlm, loadDotEnv, resolveLlmConfig } from "./llm-client.mjs";
import { exportSoulLedger, importSoulLedger, runMonthlyAutobiography } from "./soul-ledger.mjs";
import { runWeeklyGrowthReflection } from "./weekly-growth.mjs";

loadDotEnv();

function readJsonSafe(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  const content = JSON.stringify(data, null, 2) + "\n";
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, filePath);
  } catch {
    try { if (existsSync(tmpPath)) rmSync(tmpPath, { force: true }); } catch {}
    writeFileSync(filePath, content, "utf8");
  }
}

function readJsonlSafe(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function appendJsonl(filePath, obj) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf8");
}

export class CompanionEngine {
  constructor({
    dataDir = "",
    envPath = "",
    fetchFn = globalThis.fetch,
    llmOverrides = null,
  } = {}) {
    loadDotEnv(envPath || undefined);
    this.dataDir = resolve(dataDir || process.env.NUOMU_DATA_DIR || join(process.cwd(), "data"));
    this.envPath = resolve(envPath || process.env.NUOMU_ENV_FILE || join(process.cwd(), ".env"));
    this.fetchFn = fetchFn;
    this.llmOverrides = llmOverrides || {};
    this._writeQueue = Promise.resolve();
    this.stateDir = join(this.dataDir, "state");
    this.diaryDir = join(this.dataDir, "diary");
    mkdirSync(this.stateDir, { recursive: true });
    mkdirSync(this.diaryDir, { recursive: true });
  }

  /**
   * Serialize state-mutating async operations so concurrent turns never race on disk or history.
   */
  _enqueue(taskFn) {
    const run = this._writeQueue.then(taskFn, taskFn);
    this._writeQueue = run.then(() => {}, () => {});
    return run;
  }

  get paths() {
    return {
      persona: join(this.stateDir, "persona.json"),
      pad: join(this.stateDir, "pad-state.json"),
      rawMessages: join(this.stateDir, "raw-messages.jsonl"),
      turns: join(this.stateDir, "chat-turns.jsonl"),
      memoryEvents: join(this.stateDir, "memory-events.jsonl"),
      diaries: join(this.stateDir, "growth-diary.jsonl"),
      milestones: join(this.stateDir, "growth-milestones.jsonl"),
      chapters: join(this.stateDir, "growth-chapters.jsonl"),
      learnedHabits: join(this.stateDir, "learned-style-rules.json"),
      retiredHabits: join(this.stateDir, "retired-habits.jsonl"),
      openLoopsState: join(this.stateDir, "open-loops-state.json"),
      ambientState: join(this.stateDir, "ambient-state.json"),
      sessionSummary: join(this.stateDir, "session-summary.json"),
    };
  }

  getPersona() {
    const saved = readJsonSafe(this.paths.persona, null);
    return { ...DEFAULT_PERSONA, ...(saved || {}) };
  }

  savePersona(patch = {}) {
    const next = { ...this.getPersona(), ...(patch || {}), updatedAt: Date.now() };
    writeJsonAtomic(this.paths.persona, next);
    return next;
  }

  getLlmConfig() {
    loadDotEnv(this.envPath, { override: false });
    return resolveLlmConfig({
      ...(this.llmOverrides || {}),
      envFile: this.envPath,
    });
  }

  getOpenLoopsState() {
    const st = readJsonSafe(this.paths.openLoopsState, { resolved: [], nudged: {} });
    return {
      resolved: Array.isArray(st?.resolved) ? st.resolved : [],
      nudged: st?.nudged && typeof st.nudged === "object" ? st.nudged : {},
    };
  }

  resolveOpenLoopKey(key, now = Date.now()) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) return { ok: false, error: "missing key" };
    const st = this.getOpenLoopsState();
    if (!st.resolved.some((r) => String(r?.key || r) === cleanKey)) {
      st.resolved.push({ key: cleanKey, resolvedAt: now, source: "manual" });
      writeJsonAtomic(this.paths.openLoopsState, st);
    }
    return { ok: true, key: cleanKey };
  }

  /**
   * Read full observable cognitive state snapshot (safe for Web Studio UI / diagnostics; API key is masked).
   */
  getSnapshot(now = Date.now()) {
    const persona = this.getPersona();
    const rawPad = readJsonSafe(this.paths.pad, null);
    const pad = driftPadEmotion(rawPad, { now });
    const innerLife = snapshotInnerLife(now);
    const turns = readJsonlSafe(this.paths.turns);
    const memoryEvents = readJsonlSafe(this.paths.memoryEvents);
    const diaries = readJsonlSafe(this.paths.diaries);
    const milestones = readJsonlSafe(this.paths.milestones);
    const chapters = readJsonlSafe(this.paths.chapters);
    const learnedHabits = readJsonSafe(this.paths.learnedHabits, []);
    const retiredHabits = readJsonlSafe(this.paths.retiredHabits);
    const openLoopsState = this.getOpenLoopsState();
    const resolvedKeys = openLoopsState.resolved.map((r) => String(r?.key || r));

    const graph = buildBiTemporalTriples(memoryEvents, { now });
    const activeOpenLoops = collectActiveOpenLoops(diaries, {
      now,
      resolvedKeys,
      nudgedMap: openLoopsState.nudged,
    });
    const declutter = computePromptDeclutterStats({
      learnedHabits,
      selfAuthored: [],
      diaryEntries: diaries,
      milestones,
      retiredHabits,
    });

    const cfg = this.getLlmConfig();
    return {
      ok: true,
      engine: "nuomu-autonomous-v2",
      zeroDsh: true,
      now,
      dataDir: this.dataDir,
      persona,
      pad,
      innerLife,
      llm: {
        source: cfg.source,
        protocol: cfg.protocol,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        configured: Boolean(cfg.baseUrl && (cfg.apiKey || cfg.protocol === "ollama" || cfg.source === "local-gateway")),
        maskedKey: maskApiKey(cfg.apiKey),
      },
      stats: {
        turnCount: turns.length,
        memoryEventCount: memoryEvents.length,
        activeTripleCount: graph.active.length,
        historicalTripleCount: graph.historical.length,
        diaryCount: diaries.length,
        milestoneCount: milestones.length,
        chapterCount: chapters.length,
        activeOpenLoopCount: activeOpenLoops.length,
      },
      declutter,
      recentTurns: turns.slice(-40),
      activeTriples: graph.active.slice(-24),
      historicalTriples: graph.historical.slice(-12),
      activeOpenLoops,
      diaries: diaries.slice(-14).reverse(),
      milestones: milestones.slice(-8).reverse(),
      chapters: chapters.slice(-6).reverse(),
    };
  }

  /**
   * Run one full autonomous companion conversation turn (zero DSH!, serialized against concurrent races).
   */
  async chat(userText, opts = {}) {
    return await this._enqueue(() => this._chatUnlocked(userText, opts));
  }

  async _chatUnlocked(userText, { now = Date.now(), pacingMode = "", jitter = null } = {}) {
    const cleanUser = String(userText ?? "").trim();
    if (!cleanUser) return { ok: false, error: "empty message" };

    const t0 = Date.now();
    const persona = this.getPersona();
    const prevPad = readJsonSafe(this.paths.pad, null);
    const turns = readJsonlSafe(this.paths.turns);
    const memoryEvents = readJsonlSafe(this.paths.memoryEvents);
    const diaries = readJsonlSafe(this.paths.diaries);
    const milestones = readJsonlSafe(this.paths.milestones);
    const chapters = readJsonlSafe(this.paths.chapters);
    const summaryObj = readJsonSafe(this.paths.sessionSummary, { summary: "" });

    // 1. Check semantic auto-resolution of diary openLoops against current user utterance
    const openLoopsState = this.getOpenLoopsState();
    const resolvedKeys = openLoopsState.resolved.map((r) => String(r?.key || r));
    const activeLoopsBefore = collectActiveOpenLoops(diaries, {
      now,
      resolvedKeys,
      nudgedMap: openLoopsState.nudged,
    });
    const loopRes = detectResolvedOpenLoops(activeLoopsBefore, [{ ts: now, text: cleanUser }]);
    if (loopRes.resolved.length > 0) {
      for (const item of loopRes.resolved) {
        if (!openLoopsState.resolved.some((r) => String(r?.key || r) === item.key)) {
          openLoopsState.resolved.push({ key: item.key, text: item.text, resolvedAt: now, source: "auto_semantic" });
        }
      }
      writeJsonAtomic(this.paths.openLoopsState, openLoopsState);
    }
    const updatedResolvedKeys = openLoopsState.resolved.map((r) => String(r?.key || r));

    // 2. Capture durable user fact/preference into transparent L2 memory-events log (deduplicating identical recent repeats)
    let capturedMemory = false;
    const lastMemText = memoryEvents.length > 0 ? String(memoryEvents[memoryEvents.length - 1]?.text || "") : "";
    if (shouldCaptureMemoryEvent(cleanUser) && cleanUser !== lastMemText) {
      const nextId = memoryEvents.length + 1;
      const ev = { id: nextId, ts: now, text: cleanUser, source_type: "user_said", suppressed: 0, forgotten_at: 0 };
      appendJsonl(this.paths.memoryEvents, ev);
      memoryEvents.push(ev);
      capturedMemory = true;
    }

    // 3. Assemble complete model-agnostic cognitive prompt
    const assembled = assembleCompanionPrompt({
      userText: cleanUser,
      historyTurns: turns,
      persona,
      pad: prevPad,
      memoryEvents,
      diaryEntries: diaries,
      milestones,
      monthlyChapters: chapters,
      resolvedOpenLoopKeys: updatedResolvedKeys,
      sessionSummary: summaryObj?.summary || "",
      now,
    });

    // 4. Invoke ANY configured LLM via universal relay / domestic / local adapter
    const cfg = this.getLlmConfig();
    const llm = await callUnifiedLlm(assembled.messages, {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      protocol: cfg.protocol,
      temperature: 0.72,
      maxTokens: 1024,
      jsonMode: false,
      timeoutMs: 75_000,
      extraHeaders: { "x-nuomu-caller": "autonomous-chat" },
      fetchFn: this.fetchFn,
    });

    if (!llm.ok || !llm.content) {
      return {
        ok: false,
        error: llm.error || "LLM request failed",
        provider: `${cfg.source}:${llm.protocol || cfg.protocol}`,
        model: cfg.model,
        pad: assembled.nextPad,
      };
    }

    const elapsedMs = Date.now() - t0;
    const effectivePacingMode = pacingMode || persona.pacingMode || "natural";
    const { reply, pacing } = postprocessCompanionReply({
      userText: cleanUser,
      rawReply: llm.content,
      pad: assembled.nextPad,
      pacingMode: effectivePacingMode,
      elapsedMs,
      jitter,
    });

    // 5. Atomically persist transparent L0 logs + PAD state (zero opaque zstd!)
    const turnId = `t-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const assistantTs = now + Math.max(1000, elapsedMs);
    appendJsonl(this.paths.rawMessages, { ts: now, role: "user", text: cleanUser });
    appendJsonl(this.paths.rawMessages, { ts: assistantTs, role: "assistant", text: reply });
    appendJsonl(this.paths.turns, {
      turnId,
      ts: assistantTs,
      userTs: now,
      userText: cleanUser,
      text: reply,
      model: llm.model,
      provider: `${cfg.source}:${llm.protocol}`,
    });
    writeJsonAtomic(this.paths.pad, assembled.nextPad);

    return {
      ok: true,
      turnId,
      reply,
      pacing,
      pad: assembled.nextPad,
      innerLife: assembled.innerLife,
      provider: `${cfg.source}:${llm.protocol}`,
      model: llm.model,
      usage: llm.usage,
      latencyMs: elapsedMs,
      promptChars: assembled.promptChars,
      timelineCutoff: {
        crossedBoundary: assembled.timeline.crossedBoundary,
        activeCount: assembled.timeline.activeRows.length,
        archivedCount: assembled.timeline.archivedRows.length,
      },
      recalledFacts: assembled.graph.recalled.slice(0, 5),
      resolvedOpenLoops: loopRes.resolved,
      capturedMemory,
    };
  }

  /**
   * Polite 6-layer anti-intrusion ambient check-in (prefers un-nudged diary openLoops).
   */
  checkAmbient({ now = Date.now(), isTyping = false, isSending = false, force = false } = {}) {
    const turns = readJsonlSafe(this.paths.turns);
    const diaries = readJsonlSafe(this.paths.diaries);
    const pad = driftPadEmotion(readJsonSafe(this.paths.pad, null), { now });
    const innerLife = snapshotInnerLife(now);
    const openLoopsState = this.getOpenLoopsState();
    const resolvedKeys = openLoopsState.resolved.map((r) => String(r?.key || r));
    const activeLoops = collectActiveOpenLoops(diaries, {
      now,
      resolvedKeys,
      nudgedMap: openLoopsState.nudged,
    });
    const ambientState = readJsonSafe(this.paths.ambientState, { lastAmbientAt: 0 });
    const lastTurn = turns[turns.length - 1] || null;

    const decision = force
      ? {
        shouldCheckIn: true,
        kind: activeLoops[0] ? "diary_open_loop" : "gentle_checkin",
        reason: "manual-preview",
        openLoop: activeLoops[0] || null,
      }
      : evaluateAmbientCheckIn({
        now,
        lastUserAt: Number(lastTurn?.userTs || 0),
        lastAssistantAt: Number(lastTurn?.ts || 0),
        lastAmbientAt: Number(ambientState.lastAmbientAt || 0),
        isTyping,
        isSending,
        activeOpenLoops: activeLoops,
      });

    if (!decision.shouldCheckIn) {
      return { ok: true, shouldCheckIn: false, reason: decision.reason };
    }

    const message = composeAmbientCheckInMessage({
      now,
      innerLife,
      pad,
      openLoop: decision.openLoop || null,
    });

    if (!force) {
      writeJsonAtomic(this.paths.ambientState, { lastAmbientAt: now, lastKind: decision.kind });
      if (decision.openLoop?.key) {
        openLoopsState.nudged[decision.openLoop.key] = now;
        writeJsonAtomic(this.paths.openLoopsState, openLoopsState);
      }
    }

    return {
      ok: true,
      shouldCheckIn: true,
      kind: decision.kind,
      reason: decision.reason,
      openLoop: decision.openLoop || null,
      message,
    };
  }

  async consolidateDaily(opts = {}) {
    const cfg = this.getLlmConfig();
    return await runDailyConsolidation({
      dataDir: this.dataDir,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: opts.model || cfg.model,
      protocol: cfg.protocol,
      fetchFn: this.fetchFn,
      ...opts,
    });
  }

  async consolidateWeekly(opts = {}) {
    const cfg = this.getLlmConfig();
    return await runWeeklyGrowthReflection({
      dataDir: this.dataDir,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: opts.model || cfg.model,
      protocol: cfg.protocol,
      fetchFn: this.fetchFn,
      ...opts,
    });
  }

  async consolidateMonthly(opts = {}) {
    const cfg = this.getLlmConfig();
    return await runMonthlyAutobiography({
      dataDir: this.dataDir,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: opts.model || cfg.model,
      protocol: cfg.protocol,
      fetchFn: this.fetchFn,
      ...opts,
    });
  }

  exportSoul(opts = {}) {
    return exportSoulLedger({ dataDir: this.dataDir, ...opts });
  }

  importSoul(filePath, { mode = "merge", now = Date.now() } = {}) {
    return importSoulLedger({ dataDir: this.dataDir, filePath, mode, now });
  }

  /**
   * 100% transparent, guaranteed zero-ghost memory reset (preserves persona & `.env` config).
   * Because there are NO hidden zstd session blobs, cleared memories stay truly cleared.
   */
  resetMemory({ keepPersona = true } = {}) {
    const savedPersona = keepPersona ? this.getPersona() : null;
    const filesToRemove = [
      this.paths.pad,
      this.paths.rawMessages,
      this.paths.turns,
      this.paths.memoryEvents,
      this.paths.diaries,
      this.paths.milestones,
      this.paths.chapters,
      this.paths.retiredHabits,
      this.paths.openLoopsState,
      this.paths.ambientState,
      this.paths.sessionSummary,
    ];
    for (const f of filesToRemove) {
      try { if (existsSync(f)) rmSync(f, { force: true }); } catch {}
    }
    try {
      if (existsSync(this.diaryDir)) rmSync(this.diaryDir, { recursive: true, force: true });
      mkdirSync(this.diaryDir, { recursive: true });
    } catch {}
    if (savedPersona) writeJsonAtomic(this.paths.persona, savedPersona);
    return { ok: true, resetAt: Date.now(), keptPersona: Boolean(savedPersona) };
  }
}
