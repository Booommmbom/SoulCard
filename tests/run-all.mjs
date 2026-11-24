#!/usr/bin/env node
// Complete zero-dependency test suite for SoulCard (Core + Runtime + Gateway).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import * as sdk from "../src/index.mjs";
import { runDailyConsolidation } from "../src/runtime/daily-consolidate.mjs";
import { runWeeklyGrowthReflection } from "../src/runtime/weekly-growth.mjs";
import { exportSoulLedger, importSoulLedger, runMonthlyAutobiography } from "../src/runtime/soul-ledger.mjs";
import { runEvalBenchmark } from "../src/runtime/eval-runner.mjs";
import http from "node:http";
import { callUnifiedLlm, resolveLlmConfig } from "../src/runtime/llm-client.mjs";
import { applySetupConfig, upsertDotEnvFile } from "../src/runtime/setup-wizard.mjs";
import { CompanionEngine } from "../src/runtime/companion-engine.mjs";
import { createWebStudioServer } from "../src/runtime/web-server.mjs";
import { createOneBotBridgeServer, extractOneBotText } from "../src/runtime/onebot-bridge.mjs";

const require = createRequire(import.meta.url);
const { createVertexAuthProvider } = require("../src/gateway/gemini-auth.cjs");
const { GEMINI4_MODELS, resolveModel, resolveThinkingLevel, computeGatewayCost, toGemini } = require("../src/gateway/gemini-gateway.cjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const now = new Date(2026, 10, 23, 15, 0, 0).getTime();

await test("1. Unified SDK barrel exports all key pure functions cleanly", () => {
  for (const fn of [
    "bundleDayEpisodes",
    "parseConsolidationOutput",
    "collectActiveOpenLoops",
    "detectResolvedOpenLoops",
    "applyHabitRetirementPlan",
    "validateSoulLedgerPayload",
    "mergeSoulLedgerImport",
    "buildBiTemporalTriples",
    "stepPadEmotion",
    "partitionWorkingHistory",
    "computeHumanPacingPlan",
    "evaluateAmbientCheckIn",
    "scoreEvalReply",
    "normalizeBaseUrl",
    "normalizeApiKey",
    "resolveChatEndpoint",
    "buildUnifiedChatRequest",
    "parseUnifiedChatResponse",
    "assembleCompanionPrompt",
    "postprocessCompanionReply",
    "cleanCompanionReply",
  ]) {
    assert.equal(typeof sdk[fn], "function", `missing export: ${fn}`);
  }
});

await test("2. L1 Episode bundling, cost guardrail & open-loop auto-resolution", () => {
  const m = new Date(2026, 10, 22, 10, 0, 0).getTime();
  const n = new Date(2026, 10, 22, 20, 0, 0).getTime();
  const rows = [
    { ts: m, role: "user", text: "早上泡了杯冰美式" },
    { ts: m + 60_000, role: "assistant", text: "大清早喝冰的呀" },
    { ts: n, role: "user", text: "晚上练完腿好酸" },
    { ts: n + 60_000, role: "assistant", text: "今晚快歇着吧" },
    { ts: n + 90_000, role: "user", text: "嗯嗯先瘫着" },
    { ts: n + 120_000, role: "assistant", text: "陪你发会呆" },
  ];
  const day = sdk.bundleDayEpisodes(rows, { dateKey: "2026-11-22" });
  assert.equal(day.episodes.length, 2);
  assert.equal(sdk.shouldRunDailyConsolidation({ dateKey: "2026-11-23", messageCount: 3, existingDates: [] }).reason, "below_min_messages");
  assert.equal(sdk.shouldRunDailyConsolidation({ dateKey: "2026-11-22", messageCount: 6, existingDates: ["2026-11-22"] }).reason, "already_consolidated");

  const loops = sdk.collectActiveOpenLoops([{
    dateKey: "2026-11-22",
    consolidatedAt: now - 12 * 3600_000,
    openLoops: [{ text: "问问对方练完腿第二天腿酸不酸", createdAt: now - 12 * 3600_000, expiresAt: now + 36 * 3600_000 }],
  }], { now });
  assert.equal(loops.length, 1);
  const dec = sdk.evaluateAmbientCheckIn({ now, lastUserAt: now - 90 * 60_000, lastAssistantAt: now - 95 * 60_000, activeOpenLoops: loops });
  assert.equal(dec.kind, "diary_open_loop");
  const res = sdk.detectResolvedOpenLoops(loops, [{ ts: now, text: "昨天练完腿今天腿酸死了" }]);
  assert.equal(res.resolved.length, 1);
  assert.equal(res.remaining.length, 0);
});

await test("3. Physical timeline cutoff (>=60m), PAD emotion dynamics & natural pacing", () => {
  const cut = sdk.partitionWorkingHistory([
    { ts: now - 3 * 3600_000, userText: "去洗澡", text: "水放了没" },
    { ts: now - 60_000, userText: "刚回来", text: "在呢" },
  ], { now, sessionGapMinutes: 60 });
  assert.equal(cut.activeRows.length, 1);
  assert.equal(cut.archivedRows.length, 1);

  const pad = sdk.stepPadEmotion({ pleasure: 0.5, arousal: 0.5, dominance: 0.5 }, { text: "太开心啦哈哈哈", now });
  assert.ok(pad.pleasure > 0.5);

  const shortPacing = sdk.computeHumanPacingPlan({
    userText: "累了",
    replyText: "今天辛苦啦，先靠着歇会儿",
    pad,
    mode: "natural",
  });
  assert.equal(shortPacing.bubbles.length, 1);

  const longPacing = sdk.computeHumanPacingPlan({
    userText: "累了",
    replyText: "今天忙了一整天你也真是够能扛的，今晚啥也别多想了，就靠着彻底歇口气吧",
    pad,
    mode: "natural",
  });
  assert.ok(longPacing.bubbles.length >= 2);
});

await test("4. Bi-temporal knowledge graph polarity supersession & CoreSession 120-turn guard", () => {
  const built = sdk.buildBiTemporalTriples([
    { id: 1, ts: now - 10 * 86400_000, text: "我很喜欢喝冰美式", source_type: "user_said" },
    { id: 2, ts: now - 1 * 86400_000, text: "最近不再喜欢冰美式了", source_type: "user_said" },
  ]);
  assert.ok(built.historical.length >= 1);
  assert.ok(built.active.some((t) => t.polarity === -1));

  // CoreSession 120-turn non-infinite compaction verification
  const turns = [];
  let savedSession = null;
  const memStore = {
    getRecentAssistant: (_id, limit) => turns.slice(-limit),
    recordTurn: (t) => { turns.push({ turnId: t.turnId, userText: t.userText, text: t.replyText, ts: now + turns.length * 1000 }); return true; },
    getSession: () => savedSession,
    setSession: (_id, val) => { savedSession = { summary: val.summary, checkpoint: JSON.stringify(val.checkpoint) }; },
  };
  const session = new sdk.CoreSession({ store: memStore, maxHistory: 6 });
  for (let i = 1; i <= 120; i += 1) session.record({ conversationId: "c1", turnId: `t${i}`, userText: "u", replyText: `r${i}` });
  assert.equal(session.needsCompaction("c1", 12), true);
  session.setCheckpoint("c1", "summary");
  assert.equal(session.needsCompaction("c1", 12), false);
  for (let i = 121; i <= 125; i += 1) session.record({ conversationId: "c1", turnId: `t${i}`, userText: "u", replyText: `r${i}` });
  assert.equal(session.needsCompaction("c1", 12), false);
  session.record({ conversationId: "c1", turnId: "t126", userText: "u", replyText: "r126" });
  assert.equal(session.needsCompaction("c1", 12), true);
});

await test("5. Gateway multi-model routing, 4-tier/3-tier clamping, AI Studio header auth & USD pricing", async () => {
  assert.deepEqual(Object.keys(GEMINI4_MODELS), ["gemini-4-neon", "gemini-4-hydrogen", "gemini-4-carbon", "gemini-4-argon"]);
  assert.equal(resolveModel("models/gemini-4-neon"), "gemini-4-neon");
  assert.equal(resolveThinkingLevel("max", "gemini-4-neon"), "MAX");
  assert.equal(resolveThinkingLevel("max", "gemini-4-argon"), "HIGH");
  const reqPayload = toGemini({ model: "gemini-4-hydrogen", reasoning_effort: "max", response_format: { type: "json_object" }, messages: [{ role: "user", content: "hi" }] });
  assert.equal(reqPayload.request.generationConfig.thinkingConfig.thinkingLevel, "MAX");
  assert.equal(reqPayload.request.generationConfig.responseMimeType, "application/json");

  const cost = computeGatewayCost("gemini-4-hydrogen", { prompt_tokens: 1_000_000, cached_tokens: 0, completion_tokens: 1_000_000 });
  assert.equal(cost.estimatedUsd, 9);

  const auth = createVertexAuthProvider({ env: { SOULCARD_VERTEX_ENDPOINT_MODE: "aistudio", GEMINI_API_KEY: "test-placeholder-only" } });
  const req = await auth.buildVertexRequest({ model: "gemini-4-hydrogen" });
  assert.equal(req.headers["x-goog-api-key"], "test-placeholder-only");
  assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
});

await test("6. End-to-end Daily -> Weekly -> Monthly -> Soul Ledger Round-Trip & 16-Case Eval", async () => {
  const srcDir = mkdtempSync(join(tmpdir(), "soulcard-oss-src-"));
  const dstDir = mkdtempSync(join(tmpdir(), "soulcard-oss-dst-"));
  try {
    mkdirSync(join(srcDir, "state"), { recursive: true });
    const base = new Date(2026, 10, 22, 19, 0, 0).getTime();
    const rawRows = Array.from({ length: 8 }, (_, i) => ({
      ts: base + i * 30_000,
      role: i % 2 === 0 ? "user" : "assistant",
      text: i % 2 === 0 ? `第${i}句聊天内容，今天拍了灰调照片` : `自然回应第${i}句，灰调确实耐看`,
    }));
    writeFileSync(join(srcDir, "state", "raw-messages.jsonl"), rawRows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    writeFileSync(join(srcDir, "state", "learned-style-rules.json"), JSON.stringify([{ id: "old-habit-1", rule: "别老反问" }]), "utf8");

    const daily = await runDailyConsolidation({
      dataDir: srcDir,
      dateKey: "2026-11-22",
      now,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          model: "gemini-4-hydrogen",
          choices: [{ message: { content: JSON.stringify({
            dayMood: "松弛自然",
            episodes: [{ timeRange: "19:00–19:04", title: "聊灰调照片", summary: "聊了灰调照片质感。", emotionalTone: "轻快", salience: 4 }],
            facts: [{ subject: "用户", predicate: "likes", object: "灰调照片", polarity: 1, confidence: 0.9, evidence: "今天拍了灰调照片" }],
            openLoops: [{ text: "回头看看修好的灰调照片", ttlDays: 3 }],
            diaryEntry: "晚上一起聊了灰调照片的质感，说话比之前松弛很多，不用端着找话题挺舒服的。",
            growthObservation: null,
          }) } }],
          usage: { prompt_tokens: 900, completion_tokens: 200, total_tokens: 1100 },
        }),
      }),
    });
    assert.equal(daily.ok, true);
    assert.equal(daily.record.parseOk, true);

    const weekly = await runWeeklyGrowthReflection({
      dataDir: srcDir,
      weekKey: "2026-W48",
      now,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          model: "gemini-4-hydrogen",
          choices: [{ message: { content: JSON.stringify({
            theme: "自然松弛的相处",
            milestone: "这周发现不用总端着找话题，顺着聊反而自在很多。",
            emergingInterests: ["灰调摄影"],
            retireHabitIds: ["old-habit-1", "fake-id-must-be-filtered"],
            retireReason: "已内化",
          }) } }],
          usage: { prompt_tokens: 700, completion_tokens: 180, total_tokens: 880 },
        }),
      }),
    });
    assert.equal(weekly.ok, true);
    assert.equal(weekly.retiredNow.length, 1);

    const monthly = await runMonthlyAutobiography({
      dataDir: srcDir,
      monthKey: "2026-11",
      now,
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          model: "gemini-4-hydrogen",
          choices: [{ message: { content: JSON.stringify({
            chapterTitle: "松弛生长的十一月",
            narrative: "这个月慢慢卸下了生硬的规矩，开始用更真实自然的方式相处。",
            coreShifts: ["更松弛"],
            lastingMemories: ["一起聊灰调摄影"],
          }) } }],
          usage: { prompt_tokens: 600, completion_tokens: 150, total_tokens: 750 },
        }),
      }),
    });
    assert.equal(monthly.ok, true);

    const exported = exportSoulLedger({ dataDir: srcDir, now });
    assert.equal(exported.stats.diaryDays, 1);
    assert.equal(exported.stats.milestoneCount, 1);
    assert.equal(exported.stats.monthlyChapterCount, 1);

    const imported = importSoulLedger({ dataDir: dstDir, filePath: exported.exportPath, mode: "merge", now });
    assert.equal(imported.ok, true);
    assert.equal(imported.totals.diaries, 1);
    assert.equal(imported.totals.milestones, 1);
    assert.equal(imported.totals.monthlyChapters, 1);
    assert.ok(existsSync(join(dstDir, "diary", "2026-11-22.md")));
    assert.ok(existsSync(join(dstDir, "diary", "weekly-2026-W48.md")));
    assert.ok(existsSync(join(dstDir, "diary", "monthly-2026-11.md")));

    const ev = await runEvalBenchmark({
      models: ["gemini-4-hydrogen:low"],
      limit: 4,
      outDir: join(dstDir, "eval-reports"),
      fetchFn: async () => ({
        ok: true,
        json: async () => ({
          model: "gemini-4-hydrogen",
          choices: [{ message: { content: "在呢，刚忙完回来就先靠着歇会儿，哈哈这猫一模一样，太阳出来光线挺好看的。" } }],
          usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 },
        }),
      }),
    });
    assert.equal(ev.ok, true);
    assert.equal(sdk.GOLDEN_EVAL_SCENARIOS.length, 16);
  } finally {
    try { rmSync(srcDir, { recursive: true, force: true }); } catch {}
    try { rmSync(dstDir, { recursive: true, force: true }); } catch {}
  }
});

await test("7. Universal Relay & Multi-Protocol Adapter (all URL shapes, key cleanup, 4 protocols, JSON fallback & setup wizard)", async () => {
  // A. Messy pasted URL normalization across all domestic & global relay shapes
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "api.relay.example.com" }).url, "https://api.relay.example.com/v1/chat/completions");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "https://api.relay.example.com/" }).url, "https://api.relay.example.com/v1/chat/completions");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "https://api.relay.example.com/v1/" }).url, "https://api.relay.example.com/v1/chat/completions");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "https://api.relay.example.com/v1/chat/completions" }).url, "https://api.relay.example.com/v1/chat/completions");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "https://ark.cn-beijing.volces.com/api/v3" }).url, "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" }).url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "https://open.bigmodel.cn/api/paas/v4" }).url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "127.0.0.1:11434" }).url, "http://127.0.0.1:11434/api/chat");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "http://127.0.0.1:1234/v1" }).url, "http://127.0.0.1:1234/v1/chat/completions");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "https://relay.example.com/v1/messages" }).protocol, "anthropic");
  assert.equal(sdk.resolveChatEndpoint({ baseUrl: "https://relay.example.com", protocol: "anthropic" }).url, "https://relay.example.com/v1/messages");
  assert.equal(
    sdk.resolveChatEndpoint({ baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" }).url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
  );

  // B. Pasted API key sanitization
  assert.equal(sdk.normalizeApiKey('  "Bearer test-key-12345" \n'), "test-key-12345");
  assert.equal(sdk.normalizeApiKey("Authorization: Bearer test-key-999"), "test-key-999");

  // C. Request & response translation across Anthropic, Gemini, Ollama & OpenAI
  const antReq = sdk.buildUnifiedChatRequest({
    baseUrl: "https://relay.example.com/v1/messages",
    apiKey: "Bearer demo-ant-key",
    model: "claude-sonnet-4-5",
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
  });
  assert.equal(antReq.headers["x-api-key"], "demo-ant-key");
  assert.equal(antReq.body.system, "sys");
  const antParsed = sdk.parseUnifiedChatResponse({ type: "message", model: "claude-sonnet-4-5", content: [{ type: "text", text: "hello from claude" }], usage: { input_tokens: 10, output_tokens: 5 } }, "anthropic");
  assert.equal(antParsed.text, "hello from claude");
  assert.equal(antParsed.usage.total_tokens, 15);

  const gemReq = sdk.buildUnifiedChatRequest({
    baseUrl: "https://relay.example.com",
    protocol: "gemini",
    apiKey: "demo-gem-key",
    model: "gemini-2.5-flash",
    jsonMode: true,
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
  });
  assert.equal(gemReq.headers["x-goog-api-key"], "demo-gem-key");
  assert.equal(gemReq.body.generationConfig.responseMimeType, "application/json");
  const gemParsed = sdk.parseUnifiedChatResponse({
    candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text: '{"ok":true}' }] } }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, totalTokenCount: 28 },
  }, "gemini");
  assert.equal(gemParsed.text, '{"ok":true}');

  // D. Automatic JSON-mode 400 fallback retry on strict third-party relays
  let callCount = 0;
  const fallbackRes = await callUnifiedLlm([{ role: "user", content: "hi" }], {
    baseUrl: "https://relay.example.com",
    apiKey: "demo-relay-key",
    model: "custom-model",
    jsonMode: true,
    fetchFn: async (_url, init) => {
      callCount += 1;
      const body = JSON.parse(init.body);
      if (body.response_format) {
        return { ok: false, status: 400, text: async () => "response_format unsupported" };
      }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }) };
    },
  });
  assert.equal(callCount, 2);
  assert.equal(fallbackRes.ok, true);
  assert.equal(fallbackRes.content, '{"ok":true}');

  // E. Setup wizard `.env` upsert + resolveLlmConfig + custom relay eval run
  const tmpDir = mkdtempSync(join(tmpdir(), "soulcard-setup-"));
  try {
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "# keep comment\nSOULCARD_DATA_DIR=./custom-data\n", "utf8");
    const setupRes = await applySetupConfig({
      baseUrl: "relay.example.com/v1/",
      apiKey: "Bearer demo-relay-token",
      model: "deepseek-chat",
      envPath,
      runTest: true,
      fetchFn: async (url, init) => {
        assert.equal(url, "https://relay.example.com/v1/chat/completions");
        assert.equal(init.headers.authorization, "Bearer demo-relay-token");
        return { ok: true, json: async () => ({ choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }) };
      },
    });
    assert.equal(setupRes.ok, true);
    assert.equal(setupRes.testResult.ok, true);
    upsertDotEnvFile(envPath, { LLM_MODEL: "qwen-plus" });
    const cfg = resolveLlmConfig({ env: { LLM_BASE_URL: "https://relay.example.com/v1", LLM_API_KEY: "demo-relay-token", LLM_MODEL: "qwen-plus" } });
    assert.equal(cfg.source, "relay");
    assert.equal(cfg.model, "qwen-plus");

    const relayEval = await runEvalBenchmark({
      baseUrl: "relay.example.com",
      apiKey: "demo-relay-token",
      models: ["relay:qwen-plus"],
      limit: 2,
      outDir: join(tmpDir, "eval"),
      fetchFn: async (url, init) => {
        assert.equal(url, "https://relay.example.com/v1/chat/completions");
        assert.equal(init.headers.authorization, "Bearer demo-relay-token");
        return { ok: true, json: async () => ({ choices: [{ message: { content: "在呢，刚忙完回来就先靠着歇会儿，哈哈这猫一模一样。" } }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } }) };
      },
    });
    assert.equal(relayEval.ok, true);
    assert.equal(relayEval.summaries[0].modelLabel, "relay:qwen-plus");
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

await test("8. Autonomous Standalone CompanionEngine lifecycle (PAD, Bi-Temporal Graph, RP cleanup, Diary Open-Loop auto-resolve & zero-ghost reset)", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "soulcard-engine-"));
  try {
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "LLM_BASE_URL=https://relay.example.com/v1\nLLM_API_KEY=demo-engine-key\nLLM_MODEL=deepseek-chat\n", "utf8");
    const mockFetch = async (_url, init) => {
      const body = JSON.parse(init.body || "{}");
      const allText = (body.messages || []).map((m) => String(m.content || "")).join("\n");
      if (allText.includes("diaryEntry")) {
        return {
          ok: true,
          json: async () => ({
            model: "deepseek-chat",
            choices: [{ message: { content: JSON.stringify({
              dayMood: "轻松自然",
              episodes: [{ timeRange: "15:00–15:05", title: "聊咖啡口味变化", summary: "发现用户不再喝冰美式了。", emotionalTone: "自然", salience: 4 }],
              facts: [{ subject: "用户", predicate: "likes", object: "冰美式", polarity: -1, confidence: 0.9, evidence: "不再喜欢冰美式" }],
              openLoops: [{ text: "问问对方换了热拿铁后胃舒服点没", ttlDays: 3 }],
              diaryEntry: "今天聊到对方戒了冰美式改喝热拿铁，记下来改天关心一下胃还舒不舒服。",
              growthObservation: null,
            }) } }],
            usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          model: "deepseek-chat",
          choices: [{ message: { content: "（笑）哈哈收到啦，今天忙了一整天你也真是够能扛的，今晚先别想别的，靠着歇口气吧。" } }],
          usage: { prompt_tokens: 90, completion_tokens: 35, total_tokens: 125 },
        }),
      };
    };

    const engine = new CompanionEngine({ dataDir: join(tmpDir, "data"), envPath, fetchFn: mockFetch });
    const t1 = await engine.chat("我很喜欢喝冰美式", { now: now - 120_000, jitter: 1 });
    assert.equal(t1.ok, true);
    assert.equal(t1.reply.includes("（笑）"), false);
    assert.ok(t1.pacing.bubbles.length >= 2);
    assert.equal(t1.capturedMemory, true);

    const t2 = await engine.chat("最近胃不舒服，不再喜欢冰美式了", { now: now - 60_000, jitter: 1 });
    assert.equal(t2.ok, true);
    const t3 = await engine.chat("改喝热拿铁感觉暖和多了", { now: now - 30_000, jitter: 1 });
    assert.equal(t3.ok, true);

    const snap = engine.getSnapshot(now);
    assert.equal(snap.standalone, true);
    assert.equal(snap.stats.turnCount, 3);
    assert.ok(snap.stats.activeTripleCount >= 1);
    assert.ok(snap.stats.historicalTripleCount >= 1);

    // Run sleep diary consolidation (6 messages = 3 turns)
    const daily = await engine.consolidateDaily({ now, force: true });
    assert.equal(daily.ok, true);
    assert.equal(daily.record.parseOk, true);

    // Ambient check-in should naturally pick up the un-nudged diary open loop!
    const amb = engine.checkAmbient({ now: now + 90 * 60_000, force: true });
    assert.equal(amb.shouldCheckIn, true);
    assert.equal(amb.kind, "diary_open_loop");

    // Mentioning warm latte / stomach comfort should auto-resolve the diary open loop!
    const t4 = await engine.chat("换了热拿铁之后胃舒服多了", { now: now + 95 * 60_000, jitter: 1 });
    assert.equal(t4.resolvedOpenLoops.length, 1);

    // Zero-ghost reset wipes ALL memories while preserving persona cleanly
    engine.savePersona({ name: "小诺" });
    engine.resetMemory({ keepPersona: true });
    const afterReset = engine.getSnapshot(now + 100 * 60_000);
    assert.equal(afterReset.persona.name, "小诺");
    assert.equal(afterReset.stats.turnCount, 0);
    assert.equal(afterReset.stats.activeTripleCount, 0);
    assert.equal(afterReset.stats.diaryCount, 0);
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

await test("9. Local Web Studio HTTP API & Native Standalone OneBot v11 Bridge end-to-end", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "soulcard-web-"));
  const sentOneBot = [];
  const mockFetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/send_private_msg")) {
      sentOneBot.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ status: "ok" }) };
    }
    if (u.endsWith("/v1/models")) {
      return { ok: true, json: async () => ({ data: [{ id: "deepseek-chat" }, { id: "qwen-plus" }] }) };
    }
    return {
      ok: true,
      json: async () => ({
        model: "deepseek-chat",
        choices: [{ message: { content: "在呢，刚看到消息，今晚别熬太晚啦" } }],
        usage: { prompt_tokens: 40, completion_tokens: 15, total_tokens: 55 },
      }),
    };
  };

  const engine = new CompanionEngine({ dataDir: join(tmpDir, "data"), envPath: join(tmpDir, ".env"), fetchFn: mockFetch });
  const webServer = createWebStudioServer({ engine, fetchFn: mockFetch });
  const obServer = createOneBotBridgeServer({ engine, onebotApiUrl: "http://127.0.0.1:9999", ownerId: "88888", fetchFn: mockFetch, deliverDelay: false });

  await new Promise((r) => webServer.listen(0, "127.0.0.1", r));
  await new Promise((r) => obServer.listen(0, "127.0.0.1", r));
  const webPort = webServer.address().port;
  const obPort = obServer.address().port;

  try {
    // Web UI serves offline HTML cleanly
    const home = await fetch(`http://127.0.0.1:${webPort}/`);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.ok(html.includes("SoulCard Studio"));

    // Configure relay directly via Web API -> auto-discovers models -> tests & saves `.env`
    const modelsRes = await (await fetch(`http://127.0.0.1:${webPort}/api/config/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "relay.example.com", apiKey: "Bearer demo-web-key" }),
    })).json();
    assert.equal(modelsRes.ok, true);
    assert.deepEqual(modelsRes.models, ["deepseek-chat", "qwen-plus"]);

    const saveRes = await (await fetch(`http://127.0.0.1:${webPort}/api/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "relay.example.com", apiKey: "Bearer demo-web-key", model: "deepseek-chat" }),
    })).json();
    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.saved, true);
    assert.equal(saveRes.testResult.ok, true);

    // Chat via Web API
    const chatRes = await (await fetch(`http://127.0.0.1:${webPort}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "我超喜欢拍胶片照片" }),
    })).json();
    assert.equal(chatRes.ok, true);
    assert.ok(chatRes.reply.length > 0);

    // Export Soul Ledger via Web API
    const expRes = await (await fetch(`http://127.0.0.1:${webPort}/api/soul/export`)).json();
    assert.equal(expRes.ok, true);
    assert.equal(expRes.payload.schemaVersion, "soulcard.ledger.v1");

    // Native Standalone OneBot Bridge: blocks stranger, accepts owner, delivers reply!
    assert.equal(extractOneBotText({ raw_message: "[CQ:face,id=1]你好呀" }), "你好呀");
    const blocked = await (await fetch(`http://127.0.0.1:${obPort}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_type: "message", message_type: "private", user_id: 11111, raw_message: "hi" }),
    })).json();
    assert.equal(blocked.ignored, true);
    assert.equal(blocked.reason, "not_in_owner_allowlist");

    const accepted = await (await fetch(`http://127.0.0.1:${obPort}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_type: "message", message_type: "private", user_id: 88888, raw_message: "今晚在干嘛" }),
    })).json();
    assert.equal(accepted.ok, true);
    assert.ok(sentOneBot.length >= 1);
  } finally {
    webServer.close();
    obServer.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

await test("10. Security hardening & concurrency regression (CSRF, DNS-rebinding, CSP/XSS, .env injection, URL schemes, 400/413, OneBot HMAC & chat serialization)", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "soulcard-sec-"));
  const seenPrompts = [];
  const slowMockFetch = async (_url, init) => {
    await new Promise((r) => setTimeout(r, 20));
    const body = JSON.parse(init?.body || "{}");
    seenPrompts.push((body.messages || []).length);
    const last = String(body.messages?.[body.messages.length - 1]?.content || "");
    return {
      ok: true,
      json: async () => ({
        model: "deepseek-chat",
        choices: [{ message: { content: `收到：${last}` } }],
        usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 },
      }),
    };
  };

  const engine = new CompanionEngine({
    dataDir: join(tmpDir, "data"),
    envPath: join(tmpDir, ".env"),
    fetchFn: slowMockFetch,
    llmOverrides: { baseUrl: "https://relay.example.com", apiKey: "demo-key", model: "deepseek-chat", protocol: "openai" },
  });
  const web = createWebStudioServer({ engine, fetchFn: slowMockFetch });
  const secret = "unit-test-hmac-secret";
  const ob = createOneBotBridgeServer({
    engine,
    onebotApiUrl: "http://127.0.0.1:9999",
    ownerId: "12345",
    webhookSecret: secret,
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    deliverDelay: false,
  });

  await new Promise((r) => web.listen(0, "127.0.0.1", r));
  await new Promise((r) => ob.listen(0, "127.0.0.1", r));
  const wp = web.address().port;
  const op = ob.address().port;

  try {
    // 1. Dangerous / malformed URL schemes rejected
    assert.equal(sdk.normalizeBaseUrl("javascript:alert(1)"), "");
    assert.equal(sdk.normalizeBaseUrl("file:///etc/passwd"), "");
    assert.equal(sdk.normalizeBaseUrl("https://"), "");

    // 2. `.env` newline injection prevented
    const injEnv = join(tmpDir, "inj.env");
    upsertDotEnvFile(injEnv, { LLM_MODEL: "deepseek-chat\nEVIL_INJECT=1\r\nNODE_OPTIONS=--inspect" });
    const envRaw = readFileSync(injEnv, "utf8");
    assert.equal(envRaw.includes("\nEVIL_INJECT="), false);

    // 3. Cross-origin CSRF & DNS-rebinding rejected with HTTP 403
    const csrf = await fetch(`http://127.0.0.1:${wp}/api/memory/reset`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://evil.example" },
      body: "{}",
    });
    assert.equal(csrf.status, 403);

    const rebindStatus = await new Promise((resolveCode) => {
      const req = http.request({
        host: "127.0.0.1",
        port: wp,
        path: "/api/state",
        method: "GET",
        headers: { host: "evil.rebind.example:3460" },
      }, (res) => { res.resume(); resolveCode(res.statusCode); });
      req.end();
    });
    assert.equal(rebindStatus, 403);

    // 4. Security headers present on HTML & zero untrusted innerHTML template interpolation
    const home = await fetch(`http://127.0.0.1:${wp}/`);
    assert.ok(home.headers.get("content-security-policy"));
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    const html = await home.text();
    assert.equal(/innerHTML\s*=\s*`[^`]*\$\{/.test(html), false);

    // 5. Malformed JSON -> 400 (not 500)
    const badJson = await fetch(`http://127.0.0.1:${wp}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    assert.equal(badJson.status, 400);

    // 6. OneBot HMAC-SHA1 verification rejects forged signature and accepts valid signature
    const payloadStr = JSON.stringify({ post_type: "message", message_type: "private", user_id: 12345, raw_message: "验签消息" });
    const badSig = await fetch(`http://127.0.0.1:${op}/`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": "sha1=0000" },
      body: payloadStr,
    });
    assert.equal(badSig.status, 403);

    const validSig = "sha1=" + crypto.createHmac("sha1", secret).update(Buffer.from(payloadStr, "utf8")).digest("hex");
    const goodSig = await fetch(`http://127.0.0.1:${op}/`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": validSig },
      body: payloadStr,
    });
    assert.equal(goodSig.status, 200);

    // 7. Concurrent chat calls serialize strictly in order (each turn sees previous turn in prompt!)
    const [r1, r2, r3] = await Promise.all([
      engine.chat("并发一", { jitter: 1 }),
      engine.chat("并发二", { jitter: 1 }),
      engine.chat("并发三", { jitter: 1 }),
    ]);
    assert.equal(r1.ok && r2.ok && r3.ok, true);
    assert.equal(engine.getSnapshot().stats.turnCount, 4); // 1 from goodSig + 3 concurrent
    // Verify strictly increasing message history length across the 3 serialized concurrent turns
    const lastThree = seenPrompts.slice(-3);
    assert.ok(lastThree[0] < lastThree[1] && lastThree[1] < lastThree[2], `expected strictly serialized history growth, got ${JSON.stringify(lastThree)}`);
  } finally {
    web.close();
    ob.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

// ---------------------------------------------------------------------------
// 11. Portable Future-Companion Memory Cards & Cloud-First All-Provider Regression
// ---------------------------------------------------------------------------
await test("11. Portable Future-Companion Memory Cards, Cloud-First Presets, AI Minting & Anti-Leak Guard", async () => {
  // 1. Verify all major cloud providers are first-class presets (zero-GPU friendly)
  const presetIds = new Set(sdk.PROVIDER_PRESETS.map((p) => p.id));
  for (const required of ["relay", "anthropic", "openai", "gemini", "grok", "deepseek", "openrouter", "siliconflow", "dashscope"]) {
    assert.ok(presetIds.has(required), `missing cloud-first preset: ${required}`);
  }

  // 2. Pure memory-cards core guards (hallucination, sarcasm, third-party, secret leak)
  const fakeKey = "sk-" + "fake0123456789abcdef0123";
  assert.equal(sdk.isSensitiveCardText(`我的 key 是 ${fakeKey}`), true);
  assert.equal(sdk.isSensitiveCardText("周末去青城山看日落"), false);

  const hallucinated = sdk.evaluateMemoryCardCandidate(
    { title: "爱吃榴莲", content: "超爱吃榴莲", quote: "我最爱吃榴莲", category: "preference" },
    { userText: "今天下雨有点凉", assistantText: "记得添衣服" }
  );
  assert.equal(hallucinated.accepted, false);
  assert.equal(hallucinated.reason, "hallucinated_evidence");

  const joke = sdk.evaluateMemoryCardCandidate(
    { title: "去火星", content: "打算明天去火星", quote: "打算明天去火星" },
    { userText: "哈哈骗你的，才怪，我打算明天去火星", assistantText: "切" }
  );
  assert.equal(joke.accepted, false);
  assert.equal(joke.reason, "sarcasm_or_joke");

  // 3. Full CompanionEngine + Web Studio HTTP API round-trip
  const tmpDir = mkdtempSync(join(tmpdir(), "soulcard-cards-test-"));
  let lastSystemPrompt = "";
  const mockFetch = async (_url, opts) => {
    const reqBody = JSON.parse(String(opts?.body || "{}"));
    const sys = reqBody.messages?.find((m) => m.role === "system")?.content || "";
    lastSystemPrompt = sys;
    const isMint = opts?.headers?.["x-soulcard-caller"] === "memory-card-mint";
    const content = isMint
      ? JSON.stringify({
        cards: [
          { title: "一起看海的约定", content: "约定今年秋天一起去青岛看海喝冰美式", category: "promise", pinned: true, quote: "今年秋天一起去青岛看海喝冰美式", tags: ["旅行", "约定"] },
          { title: "编造的假记忆", content: "其实每天跑十公里", category: "preference", pinned: false, quote: "我每天跑十公里" },
        ],
      })
      : "记得呀，秋天去青岛看海，还要记得你不吃香菜~";
    const payload = {
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 90, completion_tokens: 28, total_tokens: 118 },
    };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };

  const engine = new CompanionEngine({
    dataDir: join(tmpDir, "data"),
    envPath: join(tmpDir, ".env"),
    fetchFn: mockFetch,
    llmOverrides: { baseUrl: "https://api.openai.com/v1", apiKey: "test-placeholder", model: "gpt-4o", protocol: "openai" },
  });
  const web = createWebStudioServer({ engine, fetchFn: mockFetch });
  await new Promise((r) => web.listen(0, "127.0.0.1", r));
  const wp = web.address().port;
  const base = `http://127.0.0.1:${wp}`;

  try {
    // 3a. Manual card creation + secret rejection (HTTP 400)
    const badCard = await fetch(`${base}/api/cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "密钥", content: `备份 ${fakeKey}`, category: "moment" }),
    });
    assert.equal(badCard.status, 400);

    const add1 = await (await fetch(`${base}/api/cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "饮食忌口", content: "完全不吃香菜，喜欢拿铁少冰", category: "preference", pinned: true, tags: ["饮食"] }),
    })).json();
    assert.equal(add1.ok, true);
    assert.equal(add1.card.pinned, true);

    // 3b. Chat turn MUST receive the pinned Memory Card in its prompt!
    const chatRes = await (await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "咱们今年秋天一起去青岛看海喝冰美式怎么样" }),
    })).json();
    assert.equal(chatRes.ok, true);
    assert.ok(lastSystemPrompt.includes("饮食忌口") && lastSystemPrompt.includes("完全不吃香菜"), "Pinned Memory Card must be injected into cloud LLM prompt!");
    assert.ok(chatRes.recalledCards.some((c) => c.title === "饮食忌口"));

    // 3c. AI One-Click Mint from recent chat: accepts verbatim-quoted card & rejects hallucinated card!
    const mintRes = await (await fetch(`${base}/api/cards/mint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxTurns: 6 }),
    })).json();
    assert.equal(mintRes.ok, true);
    assert.equal(mintRes.added, 1, "Only verbatim-verified card should be minted");
    assert.equal(mintRes.rejected.length, 1, "Hallucinated card from LLM must be rejected");
    assert.equal(mintRes.rejected[0].reason, "hallucinated_evidence");

    // 3d. Export Portable Future-Companion Memory Card Pack (.json + readable Markdown Book)
    const exp = await (await fetch(`${base}/api/cards/export`)).json();
    assert.equal(exp.ok, true);
    assert.equal(exp.pack.schema, sdk.MEMORY_CARD_SCHEMA);
    assert.equal(exp.pack.stats.cardCount, 2);
    assert.ok(exp.markdown.includes("未来伴侣记忆卡册") && exp.markdown.includes("一起看海的约定"));

    // 3e. Wipe everything (keepCards=false), then plug card pack back in via /api/cards/import -> 100% restored!
    await fetch(`${base}/api/memory/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keepPersona: true, keepCards: false }),
    });
    assert.equal(engine.listMemoryCards().length, 0);

    const imp = await (await fetch(`${base}/api/cards/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pack: exp.pack, mode: "merge", restorePersona: true }),
    })).json();
    assert.equal(imp.ok, true);
    assert.equal(imp.addedCards, 2);
    assert.equal(engine.listMemoryCards().length, 2);

    // 3f. Toggle pin & delete card
    const cardId = engine.listMemoryCards()[0].id;
    const upd = await (await fetch(`${base}/api/cards/update`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: cardId, patch: { pinned: false } }),
    })).json();
    assert.equal(upd.ok, true);
    assert.equal(upd.card.pinned, false);

    const del = await (await fetch(`${base}/api/cards/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: cardId }),
    })).json();
    assert.equal(del.ok, true);
    assert.equal(engine.listMemoryCards().length, 1);

    // 3g. Verify Web Studio inline HTML has zero unsafe innerHTML template interpolation
    const html = await (await fetch(`${base}/`)).text();
    assert.equal(/innerHTML\s*=\s*`[^`]*\$\{/.test(html), false);
    assert.ok(html.includes('id="tab-cards"') && html.includes("/api/cards/mint"));
  } finally {
    web.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

console.log(`\nALL ${passed}/11 TEST SUITES PASSED`);
