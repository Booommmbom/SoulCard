// SoulCard — 100% Autonomous Standalone Companion Runtime Engine
// Zero external dependencies, zero opaque zstd session archives, zero vendor lock-in.
// Persists all cognitive state transparently as human-readable JSONL / JSON / Markdown
// under `SOULCARD_DATA_DIR`, directly compatible with daily/weekly/monthly/soul-ledger workflows.

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
import {
  DEFAULT_CURIOSITIES,
  DEFAULT_LEARNING_PLAYBOOK,
  DEFAULT_SOCIAL_INTUITION,
  applySocialReflectionPlan,
  buildExperienceStudyPrompt,
  buildSocialReflectionPrompt,
  parseExperienceStudyOutput,
} from "../core/growth-learning.mjs";
import { snapshotInnerLife } from "../core/inner-life.mjs";
import {
  CARD_CATEGORIES,
  buildMemoryCardPack,
  evaluateMemoryCardCandidate,
  isSensitiveCardText,
  mergeMemoryCards,
  normalizeMemoryCard,
  recallMemoryCards,
  renderMemoryCardBookMarkdown,
  validateMemoryCardPack,
} from "../core/memory-cards.mjs";
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
    this.dataDir = resolve(dataDir || process.env.SOULCARD_DATA_DIR || join(process.cwd(), "data"));
    this.envPath = resolve(envPath || process.env.SOULCARD_ENV_FILE || join(process.cwd(), ".env"));
    this.fetchFn = fetchFn;
    this.llmOverrides = llmOverrides || {};
    this._writeQueue = Promise.resolve();
    this._bgGrowthInFlight = false;
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
      memoryCards: join(this.stateDir, "memory-cards.json"),
      learningPlaybook: join(this.stateDir, "learning-playbook.json"),
      curiosities: join(this.stateDir, "curiosity-queue.json"),
      socialIntuition: join(this.stateDir, "social-intuition.json"),
      studyNotes: join(this.stateDir, "study-notes.jsonl"),
      diaries: join(this.stateDir, "growth-diary.jsonl"),
      milestones: join(this.stateDir, "growth-milestones.jsonl"),
      chapters: join(this.stateDir, "growth-chapters.jsonl"),
      learnedHabits: join(this.stateDir, "learned-style-rules.json"),
      retiredHabits: join(this.stateDir, "retired-habits.jsonl"),
      openLoopsState: join(this.stateDir, "open-loops-state.json"),
      ambientState: join(this.stateDir, "ambient-state.json"),
      sessionSummary: join(this.stateDir, "session-summary.json"),
      autoGrowthState: join(this.stateDir, "auto-growth-state.json"),
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

  _readMemoryCards() {
    const raw = readJsonSafe(this.paths.memoryCards, []);
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.cards) ? raw.cards : []);
    return list
      .filter((c) => c && c.content)
      .map((c) => normalizeMemoryCard(c))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  listMemoryCards({ category = "", query = "", pinnedOnly = false } = {}) {
    let cards = this._readMemoryCards();
    if (pinnedOnly) cards = cards.filter((c) => c.pinned);
    if (category && category !== "all") cards = cards.filter((c) => c.category === category);
    if (query && String(query).trim()) {
      cards = recallMemoryCards(cards, String(query), { topK: 50, alwaysIncludePinned: 0 });
    }
    return cards;
  }

  addMemoryCard(input = {}, now = Date.now()) {
    const content = String(input?.content ?? "").trim();
    if (!content) return { ok: false, error: "记忆卡内容不能为空" };
    if (isSensitiveCardText(content) || isSensitiveCardText(input?.title) || isSensitiveCardText(input?.quote)) {
      return { ok: false, error: "检测到疑似 API Key、密码或敏感凭据，为保护隐私已阻止写入记忆卡" };
    }
    const existing = this._readMemoryCards();
    const card = normalizeMemoryCard({ ...input, source: input?.source || "user" }, now);
    const merged = mergeMemoryCards(existing, [card], { mode: "merge", now });
    writeJsonAtomic(this.paths.memoryCards, merged.cards);
    return { ok: true, card, duplicate: merged.added === 0, total: merged.cards.length };
  }

  updateMemoryCard(id, patch = {}, now = Date.now()) {
    const targetId = String(id ?? "").trim();
    if (!targetId) return { ok: false, error: "missing card id" };
    if (isSensitiveCardText(patch?.content) || isSensitiveCardText(patch?.title)) {
      return { ok: false, error: "检测到疑似敏感凭据，已阻止修改" };
    }
    const cards = this._readMemoryCards();
    const idx = cards.findIndex((c) => c.id === targetId);
    if (idx < 0) return { ok: false, error: "找不到对应记忆卡" };
    const prev = cards[idx];
    const next = normalizeMemoryCard({
      ...prev,
      ...patch,
      id: prev.id,
      createdAt: prev.createdAt,
      updatedAt: now,
    }, now);
    cards[idx] = next;
    cards.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
    writeJsonAtomic(this.paths.memoryCards, cards);
    return { ok: true, card: next, total: cards.length };
  }

  deleteMemoryCard(id) {
    const targetId = String(id ?? "").trim();
    if (!targetId) return { ok: false, error: "missing card id" };
    const cards = this._readMemoryCards();
    const next = cards.filter((c) => c.id !== targetId);
    if (next.length === cards.length) return { ok: false, error: "找不到对应记忆卡" };
    writeJsonAtomic(this.paths.memoryCards, next);
    return { ok: true, deletedId: targetId, total: next.length };
  }

  /**
   * Use the user's configured Cloud LLM (Claude/GPT/Gemini/Grok/DeepSeek) to distill recent chat turns
   * into verified portable Memory Cards protected by the 4-Gate Verbatim Evidence Lock.
   */
  async mintMemoryCardsFromChat({ maxTurns = 12, now = Date.now() } = {}) {
    return await this._enqueue(async () => {
      const turns = readJsonlSafe(this.paths.turns).slice(-Math.max(2, maxTurns));
      if (turns.length === 0) {
        return { ok: false, skipped: true, reason: "no_turns", error: "还没有对话记录，先聊几句再提炼记忆卡吧" };
      }
      const combinedUser = turns.map((t) => String(t.userText || "")).join("\n");
      const combinedAsst = turns.map((t) => String(t.text || "")).join("\n");
      const transcript = turns.map((t) => `我: ${t.userText}\n伴侣: ${t.text}`).join("\n");
      const cfg = this.getLlmConfig();
      const llm = await callUnifiedLlm(
        [
          {
            role: "system",
            content:
              "你是未来伴侣记忆卡铸造器。请从最近对话里提炼 1~3 张最值得长期珍藏的「记忆卡」（偏好、共同约定、珍贵瞬间或好点子）。\n" +
              "严格规则：1. 严禁编造，每张卡必须附带对话原文中逐字出现的完整 quote；2. 严禁记录临时寒暄、反讽玩笑、密码或 API Key。\n" +
              "只输出 JSON：{\"cards\":[{\"title\":\"简短温暖的标题\",\"content\":\"一句完整清晰的长期记忆\",\"category\":\"preference|promise|moment|inspiration\",\"tags\":[\"标签\"],\"pinned\":false,\"quote\":\"对话原文逐字片段\"}]}。",
          },
          { role: "user", content: transcript },
        ],
        {
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: cfg.model,
          protocol: cfg.protocol,
          temperature: 0.25,
          maxTokens: 900,
          jsonMode: true,
          timeoutMs: 60_000,
          extraHeaders: { "x-soulcard-caller": "memory-card-mint" },
          fetchFn: this.fetchFn,
        }
      );
      if (!llm.ok || !llm.content) {
        return { ok: false, error: llm.error || "云端模型提炼记忆卡失败" };
      }
      let parsed = null;
      try { parsed = JSON.parse(llm.content); } catch {
        const s = llm.content.indexOf("{");
        const e = llm.content.lastIndexOf("}");
        if (s >= 0 && e > s) { try { parsed = JSON.parse(llm.content.slice(s, e + 1)); } catch {} }
      }
      const rawCards = Array.isArray(parsed?.cards) ? parsed.cards : [];
      const existing = this._readMemoryCards();
      const acceptedCards = [];
      const rejected = [];
      for (const raw of rawCards.slice(0, 5)) {
        const verdict = evaluateMemoryCardCandidate(raw, { userText: combinedUser, assistantText: combinedAsst });
        if (verdict.accepted) acceptedCards.push(verdict.card);
        else rejected.push({ title: raw?.title || "", reason: verdict.reason });
      }
      const merged = mergeMemoryCards(existing, acceptedCards, { mode: "merge", now });
      if (merged.added > 0) writeJsonAtomic(this.paths.memoryCards, merged.cards);
      return {
        ok: true,
        added: merged.added,
        skippedDuplicates: merged.skipped,
        rejected,
        cards: acceptedCards,
        total: merged.cards.length,
      };
    });
  }

  exportMemoryCardPack(now = Date.now()) {
    const persona = this.getPersona();
    const cards = this._readMemoryCards();
    const memoryEvents = readJsonlSafe(this.paths.memoryEvents);
    const graph = buildBiTemporalTriples(memoryEvents, { now });
    const diaries = readJsonlSafe(this.paths.diaries);
    const milestones = readJsonlSafe(this.paths.milestones);
    const chapters = readJsonlSafe(this.paths.chapters);
    const pack = buildMemoryCardPack({
      persona,
      cards,
      activeTriples: graph.active,
      diaries,
      milestones,
      chapters,
      now,
    });
    const markdown = renderMemoryCardBookMarkdown(pack);
    return { ok: true, pack, markdown };
  }

  importMemoryCardPack(rawPack, { mode = "merge", restorePersona = false, now = Date.now() } = {}) {
    // Unified smart import: transparently accepts legacy Soul Ledger JSON (`soulcard.ledger.v1`) too!
    if (rawPack && typeof rawPack === "object" && (rawPack.schemaVersion === "soulcard.ledger.v1" || (!Array.isArray(rawPack.cards) && Array.isArray(rawPack.diaries)))) {
      const tmpLedger = join(this.stateDir, `.ledger-imp-${Date.now()}.json`);
      try {
        writeFileSync(tmpLedger, JSON.stringify(rawPack, null, 2), "utf8");
        const lr = this.importSoul(tmpLedger, { mode: mode === "replace" ? "replace" : "merge", now });
        return {
          ok: Boolean(lr.ok),
          error: lr.error,
          importedFormat: "soul-ledger",
          addedCards: 0,
          skippedCards: 0,
          totalCards: this._readMemoryCards().length,
          factsImported: 0,
          ledgerTotals: lr.totals || null,
          personaRestored: false,
        };
      } finally {
        try { if (existsSync(tmpLedger)) rmSync(tmpLedger, { force: true }); } catch {}
      }
    }

    const check = validateMemoryCardPack(rawPack);
    if (!check.ok) return { ok: false, error: check.error };
    const existing = this._readMemoryCards();
    const merged = mergeMemoryCards(existing, rawPack.cards || [], { mode: mode === "replace" ? "replace" : "merge", now });
    writeJsonAtomic(this.paths.memoryCards, merged.cards);

    // Also import activeFacts as transparent memoryEvents if absent (never lose cross-model facts!)
    let factsImported = 0;
    if (Array.isArray(rawPack.activeFacts) && rawPack.activeFacts.length > 0) {
      const events = readJsonlSafe(this.paths.memoryEvents);
      const existingSet = new Set(events.map((e) => String(e.text || "").trim()));
      let nextId = events.length + 1;
      for (const f of rawPack.activeFacts) {
        const line = `${f.subject || "我"}${Number(f.polarity ?? 1) < 0 ? "不" : ""}${f.predicate || "喜欢"}${f.object || ""}`.trim();
        if (!line || existingSet.has(line) || isSensitiveCardText(line)) continue;
        appendJsonl(this.paths.memoryEvents, {
          id: nextId++,
          ts: Number(f.validAt || now),
          text: line,
          source_type: "memory_card_import",
          suppressed: 0,
          forgotten_at: 0,
        });
        existingSet.add(line);
        factsImported += 1;
      }
    }

    // Also restore highlights (diaries/milestones/chapters) when present so 1 card pack carries the whole soul!
    let ledgerTotals = null;
    const hl = rawPack.highlights;
    if (hl && (Array.isArray(hl.diaries) && hl.diaries.length > 0 || Array.isArray(hl.milestones) && hl.milestones.length > 0 || Array.isArray(hl.chapters) && hl.chapters.length > 0)) {
      const tmpHl = join(this.stateDir, `.hl-imp-${Date.now()}.json`);
      try {
        writeFileSync(tmpHl, JSON.stringify({
          schemaVersion: "soulcard.ledger.v1",
          diaries: Array.isArray(hl.diaries) ? hl.diaries : [],
          milestones: Array.isArray(hl.milestones) ? hl.milestones : [],
          monthlyChapters: Array.isArray(hl.chapters) ? hl.chapters : (Array.isArray(hl.monthlyChapters) ? hl.monthlyChapters : []),
          retiredHabits: [],
        }, null, 2), "utf8");
        const lr = this.importSoul(tmpHl, { mode: mode === "replace" ? "replace" : "merge", now });
        if (lr.ok) ledgerTotals = lr.totals || null;
      } catch {} finally {
        try { if (existsSync(tmpHl)) rmSync(tmpHl, { force: true }); } catch {}
      }
    }

    let personaRestored = false;
    if (restorePersona && rawPack.persona && typeof rawPack.persona === "object") {
      this.savePersona(rawPack.persona);
      personaRestored = true;
    }

    return {
      ok: true,
      importedFormat: "memory-card-pack",
      mode: mode === "replace" ? "replace" : "merge",
      addedCards: merged.added,
      skippedCards: merged.skipped,
      totalCards: merged.cards.length,
      factsImported,
      ledgerTotals,
      personaRestored,
    };
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
    const memoryCards = this._readMemoryCards();
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
      engine: "soulcard-autonomous-v2",
      standalone: true,
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
        memoryCardCount: memoryCards.length,
        pinnedCardCount: memoryCards.filter((c) => c.pinned).length,
        activeTripleCount: graph.active.length,
        historicalTripleCount: graph.historical.length,
        diaryCount: diaries.length,
        milestoneCount: milestones.length,
        chapterCount: chapters.length,
        activeOpenLoopCount: activeOpenLoops.length,
      },
      declutter,
      cardCategories: CARD_CATEGORIES,
      memoryCards,
      growthDesk: this.getGrowthDesk(),
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
   * Run one full autonomous companion conversation turn (serialized against concurrent races).
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
    const memoryCards = this._readMemoryCards();
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
    let autoCard = null;
    const lastMemText = memoryEvents.length > 0 ? String(memoryEvents[memoryEvents.length - 1]?.text || "") : "";
    if (shouldCaptureMemoryEvent(cleanUser) && cleanUser !== lastMemText) {
      const nextId = memoryEvents.length + 1;
      const ev = { id: nextId, ts: now, text: cleanUser, source_type: "user_said", suppressed: 0, forgotten_at: 0 };
      appendJsonl(this.paths.memoryEvents, ev);
      memoryEvents.push(ev);
      capturedMemory = true;

      // Zero-cost ($0 extra LLM call!) silent Memory Card capture when user explicitly asks to remember or states clear promise/allergy
      const explicitRemember = /(?:帮我记住|记住我|别忘了|记一下|记下来|以后记得|我不吃|我过敏|说好了|约定好)/.test(cleanUser);
      const isQuestionOnly = /(?:你记得|还记得|忘了).{0,20}吗[？?]?$/.test(cleanUser);
      if (persona.autoGrowth !== false && explicitRemember && !isQuestionOnly && !isSensitiveCardText(cleanUser)) {
        const cat = /(?:说好了|约定好|别忘了)/.test(cleanUser) ? "promise" : "preference";
        const added = this.addMemoryCard({
          title: cleanUser.replace(/^(?:帮我记住|记住我|别忘了|记一下|记下来|以后记得)[，,：:\s]*/u, "").slice(0, 18) || "对话记住的事",
          content: cleanUser,
          category: cat,
          pinned: /(?:帮我记住|记住我|我不吃|我过敏)/.test(cleanUser),
          quote: cleanUser,
          source: "auto_chat",
        }, now);
        if (added.ok && !added.duplicate) {
          autoCard = { id: added.card.id, title: added.card.title, pinned: added.card.pinned };
          memoryCards.unshift(added.card);
        }
      }
    }

    // 3. Assemble complete model-agnostic cognitive prompt (injecting pinned & relevant Memory Cards!)
    const assembled = assembleCompanionPrompt({
      userText: cleanUser,
      historyTurns: turns,
      persona,
      pad: prevPad,
      memoryEvents,
      memoryCards,
      growthDesk: this.getGrowthDesk(),
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
      extraHeaders: { "x-soulcard-caller": "autonomous-chat" },
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
      recalledCards: (assembled.recalledCards || []).map((c) => ({ id: c.id, title: c.title, pinned: c.pinned })),
      autoCard,
      resolvedOpenLoops: loopRes.resolved,
      capturedMemory,
    };
  }

  /**
   * Cost-guarded silent background growth check (NEVER burns extra cloud tokens per turn!).
   * Triggers at most once every 6 hours AND only when >= 8 real raw messages accumulated today
   * AND persona.autoGrowth !== false. Always fire-and-forget safe.
   */
  maybeScheduleBackgroundGrowth({ now = Date.now(), minMessages = 8, cooldownMs = 6 * 3600 * 1000 } = {}) {
    if (this._bgGrowthInFlight) return { scheduled: false, reason: "already_running" };
    const persona = this.getPersona();
    if (persona.autoGrowth === false) return { scheduled: false, reason: "disabled_by_user" };
    const cfg = this.getLlmConfig();
    if (!cfg.baseUrl || (!cfg.apiKey && cfg.protocol !== "ollama" && cfg.source !== "local-gateway")) {
      return { scheduled: false, reason: "llm_unconfigured" };
    }
    const ag = readJsonSafe(this.paths.autoGrowthState, { lastRunAt: 0, lastDateKey: "" });
    if (ag.lastRunAt && now - Number(ag.lastRunAt) < cooldownMs) {
      return { scheduled: false, reason: "cooldown_active" };
    }
    const d = new Date(now);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const rawMsgs = readJsonlSafe(this.paths.rawMessages);
    const todayMsgs = rawMsgs.filter((m) => {
      const md = new Date(Number(m.ts || 0));
      const mk = `${md.getFullYear()}-${String(md.getMonth() + 1).padStart(2, "0")}-${String(md.getDate()).padStart(2, "0")}`;
      return mk === dateKey;
    });
    if (todayMsgs.length < minMessages) {
      return { scheduled: false, reason: "below_message_threshold", todayMessages: todayMsgs.length };
    }
    writeJsonAtomic(this.paths.autoGrowthState, { lastRunAt: now, lastDateKey: dateKey });
    this._bgGrowthInFlight = true;
    const promise = this.consolidateDaily({ dateKey, force: false, minMessages })
      .catch(() => ({ ok: false }))
      .finally(() => { this._bgGrowthInFlight = false; });
    return { scheduled: true, dateKey, todayMessages: todayMsgs.length, promise };
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

  getGrowthDesk() {
    const playbook = readJsonSafe(this.paths.learningPlaybook, DEFAULT_LEARNING_PLAYBOOK);
    const curiosities = readJsonSafe(this.paths.curiosities, [...DEFAULT_CURIOSITIES]);
    const social = readJsonSafe(this.paths.socialIntuition, DEFAULT_SOCIAL_INTUITION);
    const studyNotes = readJsonlSafe(this.paths.studyNotes).slice(-20).reverse();
    return {
      playbook,
      curiosities: Array.isArray(curiosities) ? curiosities : [...DEFAULT_CURIOSITIES],
      social,
      socialIntuitions: Array.isArray(social?.active) ? social.active : [],
      studyNotes,
    };
  }

  /**
   * Cloud-first experiential learning: turns any article, note, or snippet shared by the user
   * into a first-person lived reaction & curiosity note (isolated from personal memory cards).
   */
  async learnFromContent({ title = "", content = "", now = Date.now() } = {}) {
    return await this._enqueue(async () => {
      const cleanContent = String(content ?? "").trim();
      if (cleanContent.length < 6) {
        return { ok: false, error: "分享学习的内容太短了，至少写几句话吧" };
      }
      if (isSensitiveCardText(title) || isSensitiveCardText(cleanContent)) {
        return { ok: false, error: "检测到疑似 API Key、密码或敏感凭据，已阻止发送与保存" };
      }
      const desk = this.getGrowthDesk();
      const persona = this.getPersona();
      const cfg = this.getLlmConfig();
      const messages = buildExperienceStudyPrompt({
        title,
        content: cleanContent,
        persona,
        playbook: desk.playbook,
      });
      const llm = await callUnifiedLlm(messages, {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        protocol: cfg.protocol,
        temperature: 0.55,
        maxTokens: 900,
        jsonMode: true,
        timeoutMs: 60_000,
        extraHeaders: { "x-soulcard-caller": "experience-study" },
        fetchFn: this.fetchFn,
      });
      if (!llm.ok || !llm.content) {
        return { ok: false, error: llm.error || "云端模型学习消化失败" };
      }
      const parsed = parseExperienceStudyOutput(llm.content, { fallbackTitle: title || "体验随笔", now });
      if (!parsed.ok) return parsed;

      appendJsonl(this.paths.studyNotes, parsed.note);
      if (parsed.note.newCuriosity && parsed.note.newCuriosity.length >= 4) {
        const list = desk.curiosities.filter((c) => c.topic !== parsed.note.newCuriosity);
        list.unshift({
          id: `cur-${now.toString(36)}`,
          topic: parsed.note.newCuriosity,
          status: "active",
          addedAt: now,
          note: `读《${parsed.note.title}》时冒出的新好奇`,
        });
        writeJsonAtomic(this.paths.curiosities, list.slice(0, 12));
      }
      return { ok: true, note: parsed.note, desk: this.getGrowthDesk() };
    });
  }

  /**
   * Cloud-first Social Intuition Reflection: distills authentic social warmth from recent turns
   * and automatically retires stiff or outdated habits.
   */
  async runSocialReflection({ now = Date.now() } = {}) {
    return await this._enqueue(async () => {
      const turns = readJsonlSafe(this.paths.turns).slice(-16);
      if (turns.length < 2) {
        return { ok: true, skipped: true, reason: "not_enough_turns", error: "先聊满 2 轮后再做社交体感复盘吧" };
      }
      const desk = this.getGrowthDesk();
      const persona = this.getPersona();
      const cfg = this.getLlmConfig();
      const messages = buildSocialReflectionPrompt({
        recentTurns: turns,
        activeIntuitions: desk.socialIntuitions,
        persona,
      });
      const llm = await callUnifiedLlm(messages, {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        protocol: cfg.protocol,
        temperature: 0.35,
        maxTokens: 900,
        jsonMode: true,
        timeoutMs: 60_000,
        extraHeaders: { "x-soulcard-caller": "social-reflection" },
        fetchFn: this.fetchFn,
      });
      if (!llm.ok || !llm.content) {
        return { ok: false, error: llm.error || "社交体感复盘调用失败" };
      }
      const applied = applySocialReflectionPlan({
        socialState: desk.social,
        playbookState: desk.playbook,
        rawOutput: llm.content,
        now,
      });
      if (!applied.ok) return applied;
      writeJsonAtomic(this.paths.socialIntuition, applied.nextSocial);
      if (applied.playbookUpdated) writeJsonAtomic(this.paths.learningPlaybook, applied.nextPlaybook);
      return {
        ok: true,
        addedInsight: applied.addedInsight,
        retiredCount: applied.retiredCount,
        playbookUpdated: applied.playbookUpdated,
        summary: applied.summary,
        desk: this.getGrowthDesk(),
      };
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
  resetMemory({ keepPersona = true, keepCards = false } = {}) {
    const savedPersona = keepPersona ? this.getPersona() : null;
    const filesToRemove = [
      this.paths.pad,
      this.paths.rawMessages,
      this.paths.turns,
      this.paths.memoryEvents,
      ...(keepCards ? [] : [this.paths.memoryCards]),
      this.paths.diaries,
      this.paths.milestones,
      this.paths.chapters,
      this.paths.retiredHabits,
      this.paths.openLoopsState,
      this.paths.ambientState,
      this.paths.autoGrowthState,
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
