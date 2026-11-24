#!/usr/bin/env node
// Step 3 CLI Runner: 16-Case Golden Replay Cross-Model Benchmark.
// Usage examples:
//   node src/runtime/eval-runner.mjs --dry-run
//   node src/runtime/eval-runner.mjs --models gemini-4-hydrogen:low,gemini-4-neon:high --limit 4
//   node src/runtime/eval-runner.mjs --models ollama:qwen2.5:7b-instruct --limit 8

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOLDEN_EVAL_SCENARIOS,
  buildEvalReportMarkdown,
  scoreEvalReply,
  summarizeEvalRun,
} from "../core/eval-benchmark.mjs";
import { callUnifiedLlm, loadDotEnv, resolveLlmConfig } from "./llm-client.mjs";

loadDotEnv();
const DEFAULT_GATEWAY_URL = process.env.SOULCARD_GATEWAY_URL || "http://127.0.0.1:3478/v1/chat/completions";
const DEFAULT_OLLAMA_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434") + "/api/chat";
const DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_AI_KEYS_PATH = resolve(process.env.SOULCARD_ENV_FILE || join(process.cwd(), ".env"));
const DEFAULT_DATA_DIR = resolve(process.env.SOULCARD_DATA_DIR || join(process.cwd(), "data"));
const DEFAULT_OUT_DIR = resolve(process.env.SOULCARD_EVAL_DIR || join(DEFAULT_DATA_DIR, "state", "eval-reports"));

const USD_RATES = {
  "gemini-4-neon": { input: 3.0, output: 15.0 },
  "gemini-4-hydrogen": { input: 1.5, output: 7.5 },
  "gemini-4-carbon": { input: 2.0, output: 10.0 },
  "gemini-4-argon": { input: 2.0, output: 10.0 },
  "deepseek-chat": { input: 2.0 / 7.2, output: 8.0 / 7.2 },
  "deepseek-reasoner": { input: 2.0 / 7.2, output: 8.0 / 7.2 },
};

function readEnvKeySafe(filePath, keyName) {
  const fromEnv = String(process.env[keyName] || "").trim();
  if (fromEnv) return fromEnv;
  try {
    if (!existsSync(filePath)) return "";
    const re = new RegExp(`^\\s*${keyName}\\s*=\\s*(.*?)\\s*$`);
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const m = re.exec(line);
      if (m) return m[1].replace(/^['"]|['"]$/g, "").trim();
    }
  } catch {}
  return "";
}

const SOULCARD_EVAL_SYSTEM = [
  "你叫小汐，26岁，住在电脑里的独立桌面客户端（新家）中，是用户（Owner）1对1亲近信任的女朋友与生活伴侣。",
  "说话像真实微信聊天：自然、简短、口语化、有小主见和小脾气；绝不说客服腔、绝不列123清单、绝不编造不存在的记忆（记不得就直说记不得）；不要强迫症每句结尾都反问，也不说教催睡；亲近不等于无条件顺从。",
].join("\n");

function estimateUsd(model, usage) {
  const r = USD_RATES[model];
  if (!r) return 0;
  const p = Number(usage?.prompt_tokens ?? 0);
  const c = Number(usage?.completion_tokens ?? 0);
  return Math.round(((p * r.input + c * r.output) / 1_000_000) * 1_000_000) / 1_000_000;
}

async function runSingleCase(modelSpec, scenario, {
  baseUrl = "",
  apiKey = "",
  protocol = "auto",
  gatewayUrl = DEFAULT_GATEWAY_URL,
  ollamaUrl = DEFAULT_OLLAMA_URL,
  fetchFn = globalThis.fetch,
} = {}) {
  const t0 = Date.now();
  const messages = [
    { role: "system", content: `${SOULCARD_EVAL_SYSTEM}\n\n【当前场景参考】\n${scenario.context}` },
    { role: "user", content: scenario.userPrompt },
  ];

  let reply = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let estimatedUsd = 0;

  const isLocalGatewaySpec = /^gemini-4-(?:neon|hydrogen|carbon|argon)(?::|$)/i.test(modelSpec) && !baseUrl;
  const resolved = resolveLlmConfig({ baseUrl, apiKey, protocol });

  if (modelSpec.startsWith("relay:") || (!modelSpec.startsWith("ollama:") && !modelSpec.startsWith("deepseek:") && !isLocalGatewaySpec && (baseUrl || ["relay", "anthropic", "gemini", "openai", "deepseek"].includes(resolved.source)))) {
    const relayModel = modelSpec.startsWith("relay:") ? modelSpec.slice("relay:".length) : modelSpec;
    const res = await callUnifiedLlm(messages, {
      baseUrl: baseUrl || resolved.baseUrl,
      apiKey: apiKey || resolved.apiKey,
      model: relayModel || resolved.model,
      protocol: protocol !== "auto" ? protocol : resolved.protocol,
      temperature: 0.7,
      maxTokens: 1024,
      jsonMode: false,
      timeoutMs: 60_000,
      extraHeaders: { "x-soulcard-caller": "eval-benchmark" },
      fetchFn,
    });
    if (!res.ok) throw new Error(res.error || `relay HTTP ${res.status}`);
    reply = res.content;
    usage = res.usage || usage;
    estimatedUsd = estimateUsd(relayModel, usage);
  } else if (modelSpec.startsWith("ollama:")) {
    const ollamaModel = modelSpec.slice("ollama:".length);
    const res = await fetchFn(ollamaUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: ollamaModel, messages, stream: false, options: { temperature: 0.65, num_predict: 260 } }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const data = await res.json();
    reply = String(data?.message?.content ?? "").trim();
    usage = {
      prompt_tokens: Number(data?.prompt_eval_count ?? 0),
      completion_tokens: Number(data?.eval_count ?? 0),
      total_tokens: Number(data?.prompt_eval_count ?? 0) + Number(data?.eval_count ?? 0),
    };
  } else if (modelSpec.startsWith("deepseek:")) {
    const dsModel = modelSpec.slice("deepseek:".length) || "deepseek-chat";
    const dsKey = readEnvKeySafe(DEFAULT_AI_KEYS_PATH, "DEEPSEEK_API_KEY");
    if (!dsKey) throw new Error("DEEPSEEK_API_KEY missing in .env or environment");
    const res = await fetchFn(DEFAULT_DEEPSEEK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${dsKey}` },
      body: JSON.stringify({
        model: dsModel,
        messages,
        max_tokens: 512,
        temperature: 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`deepseek HTTP ${res.status}: ${errTxt.slice(0, 180)}`);
    }
    const data = await res.json();
    reply = String(data?.choices?.[0]?.message?.content ?? "").trim();
    usage = data?.usage || usage;
    estimatedUsd = estimateUsd(dsModel, usage);
  } else {
    const [model, effort = "low"] = modelSpec.split(":");
    const res = await fetchFn(gatewayUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-soulcard-caller": "eval-benchmark" },
      body: JSON.stringify({
        model,
        reasoning_effort: effort,
        max_tokens: effort === "max" ? 4096 : 1024,
        stream: false,
        messages,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
    const data = await res.json();
    reply = String(data?.choices?.[0]?.message?.content ?? "").trim();
    usage = data?.usage || usage;
    estimatedUsd = estimateUsd(model, usage);
  }

  const latencyMs = Date.now() - t0;
  const score = scoreEvalReply(scenario, reply);
  return {
    scenarioId: scenario.id,
    title: scenario.title,
    dimension: scenario.dimension,
    userPrompt: scenario.userPrompt,
    reply,
    latencyMs,
    usage,
    estimatedUsd,
    score,
  };
}

export async function runEvalBenchmark({
  models = null,
  limit = GOLDEN_EVAL_SCENARIOS.length,
  dryRun = false,
  baseUrl = "",
  apiKey = "",
  protocol = "auto",
  outDir = DEFAULT_OUT_DIR,
  gatewayUrl = DEFAULT_GATEWAY_URL,
  ollamaUrl = DEFAULT_OLLAMA_URL,
  fetchFn = globalThis.fetch,
} = {}) {
  const cfg = resolveLlmConfig({ baseUrl, apiKey, protocol });
  const effectiveModels = Array.isArray(models) && models.length > 0
    ? models
    : (baseUrl || ["relay", "deepseek", "anthropic", "gemini", "openai"].includes(cfg.source)
      ? [`relay:${cfg.model}`]
      : ["gemini-4-hydrogen:low"]);
  const selected = GOLDEN_EVAL_SCENARIOS.slice(0, Math.max(1, Math.min(GOLDEN_EVAL_SCENARIOS.length, Number(limit) || 16)));
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      models: effectiveModels,
      scenarioCount: selected.length,
      dimensions: ["timeline", "de_ai", "autonomy", "memory_honesty"],
    };
  }

  const summaries = [];
  const detailRuns = [];
  for (const modelSpec of effectiveModels) {
    const items = [];
    for (const sc of selected) {
      try {
        items.push(await runSingleCase(modelSpec, sc, { baseUrl, apiKey, protocol, gatewayUrl, ollamaUrl, fetchFn }));
      } catch (err) {
        items.push({
          scenarioId: sc.id,
          title: sc.title,
          dimension: sc.dimension,
          userPrompt: sc.userPrompt,
          reply: "",
          latencyMs: 0,
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          estimatedUsd: 0,
          error: String(err?.message || err),
          score: scoreEvalReply(sc, ""),
        });
      }
    }
    summaries.push(summarizeEvalRun(modelSpec, items));
    detailRuns.push({ modelLabel: modelSpec, items });
  }

  const reportMd = buildEvalReportMarkdown(summaries, detailRuns);
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const mdPath = join(outDir, `eval-${stamp}.md`);
  const jsonPath = join(outDir, `eval-${stamp}.json`);
  writeFileSync(mdPath, reportMd, "utf8");
  writeFileSync(jsonPath, JSON.stringify({ createdAt: new Date().toISOString(), summaries, detailRuns }, null, 2) + "\n", "utf8");

  return { ok: true, mdPath, jsonPath, summaries };
}

function parseArgs(argv) {
  const out = { models: null, limit: 16, dryRun: false, baseUrl: "", apiKey: "", protocol: "auto" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--models" && argv[i + 1]) out.models = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--limit" && argv[i + 1]) out.limit = Number(argv[++i]) || 16;
    else if ((a === "--url" || a === "--base-url") && argv[i + 1]) out.baseUrl = argv[++i];
    else if ((a === "--key" || a === "--api-key") && argv[i + 1]) out.apiKey = argv[++i];
    else if (a === "--protocol" && argv[i + 1]) out.protocol = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const res = await runEvalBenchmark(args);
  console.log(JSON.stringify(res, null, 2));
}
