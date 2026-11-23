#!/usr/bin/env node
// Model-agnostic Daily Sleep-Time Consolidation & Portable Soul Ledger runner.
// Uses pure core packages/nuomu-core/episode-consolidation.mjs.
// Never opens data/memory.db directly (keeps auditMemoryWritePaths 100% green);
// verified facts are persisted to growth-diary.jsonl and synced into memory_triples
// by authorized runtime module dsh-onebot/lib/memory-ops.mjs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDailyConsolidationPrompt,
  buildDeterministicFallbackConsolidation,
  buildPortableSoulLedger,
  bundleDayEpisodes,
  formatLocalDateKey,
  parseConsolidationOutput,
  renderDiaryMarkdown,
  shouldRunDailyConsolidation,
  summarizeDailyActivity,
} from "../core/episode-consolidation.mjs";
import { callUnifiedLlm, resolveLlmConfig } from "./llm-client.mjs";

const DEFAULT_DATA_DIR = resolve(process.env.NUOMU_DATA_DIR || join(process.cwd(), "data"));
const DEFAULT_GATEWAY_URL = process.env.NUOMU_GATEWAY_URL || "http://127.0.0.1:3478/v1/chat/completions";
const DEFAULT_OLLAMA_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434") + "/api/chat";
const DEFAULT_MODEL = process.env.NUOMU_CONSOLIDATION_MODEL || "gemini-4-hydrogen";
const DEFAULT_EFFORT = process.env.NUOMU_CONSOLIDATION_EFFORT || "low";

const MODEL_CNY_PER_MILLION = {
  "gemini-4-hydrogen": { input: 10.8, output: 54 },
  "gemini-4-carbon": { input: 14.4, output: 72 },
  "gemini-4-argon": { input: 14.4, output: 72 },
  "gemini-4-neon": { input: 21.6, output: 108 },
  "ollama:qwen2.5:7b-instruct": { input: 0, output: 0 },
  deterministic: { input: 0, output: 0 },
};

function readJsonSafe(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8")) ?? fallback;
  } catch {
    return fallback;
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

function writeJsonlAtomic(filePath, rows) {
  mkdirSync(dirname(filePath), { recursive: true });
  const text = (Array.isArray(rows) ? rows : []).map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(filePath, text ? text + "\n" : "", "utf8");
}

function estimateCostCny(modelId, usage) {
  const rates = MODEL_CNY_PER_MILLION[modelId] || { input: 14.4, output: 72 };
  const prompt = Number(usage?.prompt_tokens ?? 0);
  const completion = Number(usage?.completion_tokens ?? 0);
  return Math.round(((prompt * rates.input + completion * rates.output) / 1_000_000) * 1000000) / 1000000;
}

async function callConsolidationLlm(messages, {
  model = "",
  effort = DEFAULT_EFFORT,
  baseUrl = "",
  apiKey = "",
  protocol = "auto",
  gatewayUrl = DEFAULT_GATEWAY_URL,
  ollamaUrl = DEFAULT_OLLAMA_URL,
  fetchFn = globalThis.fetch,
} = {}) {
  const eff = String(effort || "low").toLowerCase();
  const maxTokens = eff === "max" ? 16384 : eff === "high" ? 8192 : 4096;
  const timeoutMs = eff === "max" ? 180_000 : eff === "high" ? 120_000 : 90_000;

  // 1. Universal Relay / Domestic / Multi-Protocol Adapter (auto-loaded from `.env` or CLI `--url`)
  const resolved = resolveLlmConfig({ baseUrl, apiKey, model, protocol });
  const isOllama = String(model || "").startsWith("ollama:");
  if (!isOllama && (baseUrl || ["relay", "deepseek", "anthropic", "gemini", "openai"].includes(resolved.source))) {
    const unified = await callUnifiedLlm(messages, {
      baseUrl: baseUrl || resolved.baseUrl,
      apiKey: apiKey || resolved.apiKey,
      model: model || resolved.model,
      protocol: protocol !== "auto" ? protocol : resolved.protocol,
      temperature: 0.55,
      maxTokens,
      jsonMode: true,
      timeoutMs,
      extraHeaders: { "x-nuomu-caller": "daily-consolidate" },
      fetchFn,
    });
    if (unified.ok && unified.content) {
      return {
        ok: true,
        provider: `${unified.provider}:${unified.protocol}`,
        model: unified.model,
        effort,
        content: unified.content,
        usage: unified.usage,
      };
    }
  }

  const gatewayModel = model || DEFAULT_MODEL;
  if (!isOllama) {
    try {
      const res = await fetchFn(gatewayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-nuomu-caller": "daily-consolidate" },
        body: JSON.stringify({
          model: gatewayModel,
          reasoning_effort: effort,
          max_tokens: maxTokens,
          temperature: 0.55,
          response_format: { type: "json_object" },
          stream: false,
          messages,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const data = await res.json();
        const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
        if (content) {
          return {
            ok: true,
            provider: "nuomu-vertex-gateway",
            model: data?.model || gatewayModel,
            effort,
            content,
            usage: data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          };
        }
      }
    } catch {}
  }

  // Graceful local Ollama fallback (0 CNY cost)
  const ollamaModel = isOllama ? String(model).slice("ollama:".length) : "qwen2.5:7b-instruct";
  try {
    const res = await fetchFn(ollamaUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        format: "json",
        messages,
        options: { temperature: 0.45, num_predict: 1200 },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok) {
      const data = await res.json();
      const content = String(data?.message?.content ?? "").trim();
      if (content) {
        const prompt = Number(data?.prompt_eval_count ?? 0);
        const completion = Number(data?.eval_count ?? 0);
        return {
          ok: true,
          provider: "ollama-local",
          model: `ollama:${ollamaModel}`,
          effort: "local",
          content,
          usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
        };
      }
    }
  } catch {}

  return { ok: false, provider: "deterministic", model: "deterministic", effort: "none", content: "", usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

function pickTargetDate(rawRows, existingDates, { explicitDate = "", now = Date.now(), minMessages = 6 } = {}) {
  if (explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) return explicitDate;
  const activity = summarizeDailyActivity(rawRows);
  const existingSet = new Set(existingDates);
  const todayKey = formatLocalDateKey(now);
  const yesterdayKey = formatLocalDateKey(now - 86400_000);
  // Prefer yesterday if it has enough messages and isn't consolidated yet
  const yesterdayRow = activity.find((d) => d.dateKey === yesterdayKey && d.count >= minMessages);
  if (yesterdayRow && !existingSet.has(yesterdayKey)) return yesterdayKey;
  // Next prefer any unconsolidated past day with enough messages
  const unconsolidatedPast = activity.find((d) => d.dateKey !== todayKey && d.count >= minMessages && !existingSet.has(d.dateKey));
  if (unconsolidatedPast) return unconsolidatedPast.dateKey;
  // Otherwise fall back to the most recent active day >= minMessages
  const latestActive = activity.find((d) => d.count >= minMessages);
  return latestActive ? latestActive.dateKey : yesterdayKey;
}

export async function runDailyConsolidation(options = {}) {
  const dataDir = String(options.dataDir || process.env.NUOMU_DATA_DIR || DEFAULT_DATA_DIR);
  const now = Number(options.now || Date.now());
  const minMessages = Math.max(1, Number(options.minMessages ?? 6));
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const model = String(options.model || DEFAULT_MODEL);
  const effort = String(options.effort || DEFAULT_EFFORT);

  const rawPath = join(dataDir, "state", "raw-messages.jsonl");
  const petChatPath = join(dataDir, "pet-chat.jsonl");
  const diaryJsonlPath = join(dataDir, "state", "growth-diary.jsonl");
  const ledgerPath = join(dataDir, "state", "growth-ledger.json");
  const diaryDir = join(dataDir, "diary");
  const moodPath = join(dataDir, "state", "mood.json");
  const innerLifePath = join(dataDir, "state", "inner-life.json");

  const rawRows = readJsonlSafe(rawPath);
  const allRows = rawRows.length > 0 ? rawRows : readJsonlSafe(petChatPath);
  const existingEntries = readJsonlSafe(diaryJsonlPath);
  const existingDates = existingEntries.map((e) => String(e.dateKey || "")).filter(Boolean);

  const dateKey = pickTargetDate(allRows, existingDates, { explicitDate: options.dateKey || "", now, minMessages });
  const bundled = bundleDayEpisodes(allRows, { dateKey, now });
  const gate = shouldRunDailyConsolidation({
    dateKey,
    messageCount: bundled.messageCount,
    existingDates,
    minMessages,
    force,
  });

  if (!gate.shouldRun) {
    return {
      ok: true,
      skipped: true,
      reason: gate.reason,
      dateKey,
      messageCount: bundled.messageCount,
      episodeCount: bundled.episodes.length,
    };
  }

  const mood = readJsonSafe(moodPath, null);
  const innerLife = readJsonSafe(innerLifePath, null);
  const messages = buildDailyConsolidationPrompt({
    dateKey,
    episodes: bundled.episodes,
    mood,
    innerLife,
    recentDiaryEntries: existingEntries,
    maxTranscriptChars: 6000,
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      dateKey,
      messageCount: bundled.messageCount,
      episodeCount: bundled.episodes.length,
      promptChars: messages.reduce((s, m) => s + m.content.length, 0),
    };
  }

  const llm = await callConsolidationLlm(messages, {
    model: options.model || "",
    effort,
    baseUrl: options.baseUrl || "",
    apiKey: options.apiKey || "",
    protocol: options.protocol || "auto",
    gatewayUrl: options.gatewayUrl || DEFAULT_GATEWAY_URL,
    ollamaUrl: options.ollamaUrl || DEFAULT_OLLAMA_URL,
    fetchFn: options.fetchFn || globalThis.fetch,
  });

  let parsedResult;
  if (llm.ok && llm.content) {
    parsedResult = parseConsolidationOutput(llm.content, {
      dateKey,
      fallbackEpisodes: bundled.episodes,
      mood,
      now,
    });
  } else {
    parsedResult = {
      ok: false,
      error: "llm_unavailable",
      parsed: buildDeterministicFallbackConsolidation({ dateKey, episodes: bundled.episodes, mood, now }),
    };
  }

  const estimatedCostCny = estimateCostCny(llm.model, llm.usage);
  const record = {
    ...parsedResult.parsed,
    dateKey,
    consolidatedAt: now,
    messageCount: bundled.messageCount,
    userCount: bundled.userCount,
    assistantCount: bundled.assistantCount,
    provider: llm.provider,
    model: llm.model,
    effort: llm.effort,
    usage: llm.usage,
    estimatedCostCny,
    parseOk: parsedResult.ok,
  };

  // Upsert by dateKey in growth-diary.jsonl (sorted newest last)
  const merged = existingEntries
    .filter((e) => String(e.dateKey) !== dateKey)
    .concat([record])
    .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
  writeJsonlAtomic(diaryJsonlPath, merged);

  // Write human-readable Markdown diary
  mkdirSync(diaryDir, { recursive: true });
  const markdownPath = join(diaryDir, `${dateKey}.md`);
  writeFileSync(markdownPath, renderDiaryMarkdown(record), "utf8");

  // Update compact growth-ledger.json index
  const activeOpenLoops = merged
    .flatMap((d) => (Array.isArray(d.openLoops) ? d.openLoops.map((o) => ({ ...o, fromDate: d.dateKey })) : []))
    .filter((o) => !o.expiresAt || Number(o.expiresAt) > now)
    .slice(-10);
  const ledger = {
    schemaVersion: "nuomu-growth-ledger-v1",
    updatedAt: now,
    totalDays: merged.length,
    latestDateKey: merged[merged.length - 1]?.dateKey || dateKey,
    totalCostCny: Math.round(merged.reduce((s, d) => s + (Number(d.estimatedCostCny) || 0), 0) * 1000000) / 1000000,
    activeOpenLoops,
    recentGrowthObservations: merged
      .filter((d) => d.growthObservation)
      .slice(-10)
      .map((d) => ({ dateKey: d.dateKey, text: d.growthObservation })),
  };
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");

  return {
    ok: true,
    skipped: false,
    dateKey,
    markdownPath,
    diaryJsonlPath,
    record,
  };
}

export function exportPortableSoulLedger({ dataDir = DEFAULT_DATA_DIR, now = Date.now() } = {}) {
  const diaryEntries = readJsonlSafe(join(dataDir, "state", "growth-diary.jsonl"));
  const milestones = readJsonlSafe(join(dataDir, "state", "growth-milestones.jsonl"));
  const personSchema = readJsonSafe(join(dataDir, "state", "person-schema.json"), null);
  const dreamBlocks = readJsonSafe(join(dataDir, "state", "core-memory-blocks.json"), null);
  const ledger = buildPortableSoulLedger({
    diaryEntries,
    milestones,
    personSchema,
    dreamBlocks,
    triples: [],
    identityVersion: "nuomu-v1",
    now,
  });
  const exportPath = join(dataDir, "state", "soul-ledger-export.json");
  mkdirSync(dirname(exportPath), { recursive: true });
  writeFileSync(exportPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  return { ok: true, exportPath, stats: ledger.stats };
}

function parseCliArgs(argv) {
  const out = { dateKey: "", model: "", effort: DEFAULT_EFFORT, baseUrl: "", apiKey: "", protocol: "auto", force: false, dryRun: false, exportSoul: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--date" && argv[i + 1]) out.dateKey = argv[++i];
    else if (a === "--model" && argv[i + 1]) out.model = argv[++i];
    else if (a === "--effort" && argv[i + 1]) out.effort = argv[++i];
    else if ((a === "--url" || a === "--base-url") && argv[i + 1]) out.baseUrl = argv[++i];
    else if ((a === "--key" || a === "--api-key") && argv[i + 1]) out.apiKey = argv[++i];
    else if (a === "--protocol" && argv[i + 1]) out.protocol = argv[++i];
    else if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--export-soul") out.exportSoul = true;
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.exportSoul) {
    console.log(JSON.stringify(exportPortableSoulLedger(), null, 2));
  } else {
    const res = await runDailyConsolidation(args);
    console.log(JSON.stringify(res, null, 2));
  }
}
