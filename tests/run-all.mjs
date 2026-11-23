#!/usr/bin/env node
// Complete zero-dependency test suite for Nuomu Soul (Core + Runtime + Gateway).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import * as sdk from "../src/index.mjs";
import { runDailyConsolidation } from "../src/runtime/daily-consolidate.mjs";
import { runWeeklyGrowthReflection } from "../src/runtime/weekly-growth.mjs";
import { exportSoulLedger, importSoulLedger, runMonthlyAutobiography } from "../src/runtime/soul-ledger.mjs";
import { runEvalBenchmark } from "../src/runtime/eval-runner.mjs";
import { callUnifiedLlm, resolveLlmConfig } from "../src/runtime/llm-client.mjs";
import { applySetupConfig, upsertDotEnvFile } from "../src/runtime/setup-wizard.mjs";

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

  const auth = createVertexAuthProvider({ env: { NUOMU_VERTEX_ENDPOINT_MODE: "aistudio", GEMINI_API_KEY: "test-placeholder-only" } });
  const req = await auth.buildVertexRequest({ model: "gemini-4-hydrogen" });
  assert.equal(req.headers["x-goog-api-key"], "test-placeholder-only");
  assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
});

await test("6. End-to-end Daily -> Weekly -> Monthly -> Soul Ledger Round-Trip & 16-Case Eval", async () => {
  const srcDir = mkdtempSync(join(tmpdir(), "nuomu-oss-src-"));
  const dstDir = mkdtempSync(join(tmpdir(), "nuomu-oss-dst-"));
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
  const tmpDir = mkdtempSync(join(tmpdir(), "nuomu-setup-"));
  try {
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "# keep comment\nNUOMU_DATA_DIR=./custom-data\n", "utf8");
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

console.log(`\nALL ${passed}/7 TEST SUITES PASSED`);
