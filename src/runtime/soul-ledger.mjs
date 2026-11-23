#!/usr/bin/env node
// Portable Soul Ledger (Export + Lossless Import/Restore) & L3 Monthly Autobiography Runner.
// 100% Model-Agnostic; never touches data/memory.db directly (keeps auditMemoryWritePaths 100% green).

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPortableSoulLedger,
  renderDiaryMarkdown,
} from "../core/episode-consolidation.mjs";
import {
  buildDeterministicMonthlyFallback,
  buildMonthlyAutobiographyPrompt,
  computeMonthKey,
  mergeSoulLedgerImport,
  parseMonthlyAutobiographyOutput,
  renderMonthlyChapterMarkdown,
  renderWeeklyMilestoneMarkdown,
  shouldRunMonthlyAutobiography,
  validateSoulLedgerPayload,
} from "../core/growth-evolution.mjs";
import { callUnifiedLlm, loadDotEnv, resolveLlmConfig } from "./llm-client.mjs";

loadDotEnv();
const DEFAULT_DATA_DIR = resolve(process.env.NUOMU_DATA_DIR || join(process.cwd(), "data"));
const DEFAULT_GATEWAY_URL = process.env.NUOMU_GATEWAY_URL || "http://127.0.0.1:3478/v1/chat/completions";
const DEFAULT_OLLAMA_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434") + "/api/chat";
const DEFAULT_MODEL = process.env.NUOMU_MONTHLY_MODEL || "gemini-4-hydrogen";
const DEFAULT_EFFORT = process.env.NUOMU_MONTHLY_EFFORT || "low";

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

/**
 * Export complete model-agnostic Soul Ledger v1 (diaries + milestones + monthly chapters + retired habits + schemas).
 */
export function exportSoulLedger({ dataDir = DEFAULT_DATA_DIR, outPath = "", now = Date.now() } = {}) {
  const stateDir = join(dataDir, "state");
  const diaries = readJsonlSafe(join(stateDir, "growth-diary.jsonl"));
  const milestones = readJsonlSafe(join(stateDir, "growth-milestones.jsonl"));
  const monthlyChapters = readJsonlSafe(join(stateDir, "growth-chapters.jsonl"));
  const retiredHabits = readJsonlSafe(join(stateDir, "retired-habits.jsonl"));
  const personSchema = readJsonSafe(join(stateDir, "person-schema.json"), null);
  const dreamBlocks = readJsonSafe(join(stateDir, "core-memory-blocks.json"), null);
  const openLoopsState = readJsonSafe(join(stateDir, "open-loops-state.json"), { resolved: [], nudged: {} });

  const base = buildPortableSoulLedger({
    diaryEntries: diaries,
    milestones,
    personSchema,
    dreamBlocks,
    triples: [],
    identityVersion: "nuomu-v1",
    now,
  });

  const payload = {
    ...base,
    stats: {
      ...base.stats,
      monthlyChapterCount: monthlyChapters.length,
      retiredHabitCount: retiredHabits.length,
    },
    monthlyChapters,
    retiredHabits,
    openLoopsState,
  };

  const target = outPath || join(stateDir, "soul-ledger-export.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return { ok: true, exportPath: target, stats: payload.stats };
}

/**
 * Validate, back up existing state, and losslessly import/restore a Portable Soul Ledger v1 snapshot.
 */
export function importSoulLedger({ dataDir = DEFAULT_DATA_DIR, filePath, mode = "merge", now = Date.now() } = {}) {
  if (!filePath || !existsSync(filePath)) {
    return { ok: false, error: "soul ledger file not found" };
  }
  let incoming;
  try {
    incoming = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err?.message || err}` };
  }
  const valid = validateSoulLedgerPayload(incoming);
  if (!valid.ok) return { ok: false, error: valid.error };

  const stateDir = join(dataDir, "state");
  const diaryDir = join(dataDir, "diary");
  const diaryPath = join(stateDir, "growth-diary.jsonl");
  const msPath = join(stateDir, "growth-milestones.jsonl");
  const chPath = join(stateDir, "growth-chapters.jsonl");
  const retPath = join(stateDir, "retired-habits.jsonl");
  const psPath = join(stateDir, "person-schema.json");
  const dmPath = join(stateDir, "core-memory-blocks.json");

  // Auto-backup current growth files before modifying
  const bakDir = join(stateDir, "soul-import-backups", `pre-import-${now}`);
  mkdirSync(bakDir, { recursive: true });
  for (const [src, name] of [
    [diaryPath, "growth-diary.jsonl"],
    [msPath, "growth-milestones.jsonl"],
    [chPath, "growth-chapters.jsonl"],
    [retPath, "retired-habits.jsonl"],
  ]) {
    if (existsSync(src)) {
      try { copyFileSync(src, join(bakDir, name)); } catch {}
    }
  }

  const merged = mergeSoulLedgerImport({
    incoming,
    currentDiaries: readJsonlSafe(diaryPath),
    currentMilestones: readJsonlSafe(msPath),
    currentChapters: readJsonlSafe(chPath),
    currentRetiredHabits: readJsonlSafe(retPath),
    mode,
  });

  writeJsonlAtomic(diaryPath, merged.diaries);
  writeJsonlAtomic(msPath, merged.milestones);
  writeJsonlAtomic(chPath, merged.monthlyChapters);
  writeJsonlAtomic(retPath, merged.retiredHabits);

  // Restore portable human-readable Markdown diaries/milestones/chapters
  mkdirSync(diaryDir, { recursive: true });
  for (const d of merged.diaries) {
    if (d?.dateKey) writeFileSync(join(diaryDir, `${d.dateKey}.md`), renderDiaryMarkdown(d), "utf8");
  }
  for (const m of merged.milestones) {
    if (m?.weekKey) writeFileSync(join(diaryDir, `weekly-${m.weekKey}.md`), renderWeeklyMilestoneMarkdown(m), "utf8");
  }
  for (const c of merged.monthlyChapters) {
    if (c?.monthKey) writeFileSync(join(diaryDir, `monthly-${c.monthKey}.md`), renderMonthlyChapterMarkdown(c), "utf8");
  }

  // Restore personSchema / coreMemoryBlocks only if currently absent or replace mode
  if (incoming.personSchema && (mode === "replace" || !existsSync(psPath))) {
    writeFileSync(psPath, JSON.stringify(incoming.personSchema, null, 2) + "\n", "utf8");
  }
  if (incoming.coreMemoryBlocks && (mode === "replace" || !existsSync(dmPath))) {
    writeFileSync(dmPath, JSON.stringify(incoming.coreMemoryBlocks, null, 2) + "\n", "utf8");
  }

  return {
    ok: true,
    mode,
    backupDir: bakDir,
    diff: merged.diff,
    totals: {
      diaries: merged.diaries.length,
      milestones: merged.milestones.length,
      monthlyChapters: merged.monthlyChapters.length,
      retiredHabits: merged.retiredHabits.length,
    },
  };
}

async function callMonthlyLlm(messages, {
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
  const timeoutMs = eff === "max" ? 180_000 : 120_000;

  const resolved = resolveLlmConfig({ baseUrl, apiKey, model, protocol });
  const isOllama = String(model || "").startsWith("ollama:");
  if (!isOllama && (baseUrl || ["relay", "deepseek", "anthropic", "gemini", "openai"].includes(resolved.source))) {
    const unified = await callUnifiedLlm(messages, {
      baseUrl: baseUrl || resolved.baseUrl,
      apiKey: apiKey || resolved.apiKey,
      model: model || resolved.model,
      protocol: protocol !== "auto" ? protocol : resolved.protocol,
      temperature: 0.5,
      maxTokens,
      jsonMode: true,
      timeoutMs,
      extraHeaders: { "x-nuomu-caller": "monthly-growth" },
      fetchFn,
    });
    if (unified.ok && unified.content) {
      return {
        ok: true,
        provider: `${resolved.source}:${unified.protocol}`,
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
        headers: { "content-type": "application/json", "x-nuomu-caller": "monthly-growth" },
        body: JSON.stringify({
          model: gatewayModel,
          reasoning_effort: effort,
          max_tokens: maxTokens,
          temperature: 0.5,
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
        options: { temperature: 0.4, num_predict: 1200 },
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

/**
 * L3 Monthly Developmental Autobiography runner.
 */
export async function runMonthlyAutobiography(options = {}) {
  const dataDir = String(options.dataDir || process.env.NUOMU_DATA_DIR || DEFAULT_DATA_DIR);
  const now = Number(options.now || Date.now());
  const monthKey = String(options.monthKey || computeMonthKey(now));
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const model = String(options.model || DEFAULT_MODEL);
  const effort = String(options.effort || DEFAULT_EFFORT);

  const stateDir = join(dataDir, "state");
  const diaryDir = join(dataDir, "diary");
  const diaries = readJsonlSafe(join(stateDir, "growth-diary.jsonl"));
  const milestones = readJsonlSafe(join(stateDir, "growth-milestones.jsonl"));
  const chaptersPath = join(stateDir, "growth-chapters.jsonl");
  const existingChapters = readJsonlSafe(chaptersPath);

  const gate = shouldRunMonthlyAutobiography({
    monthKey,
    milestones,
    diaryEntries: diaries,
    existingChapters,
    minMilestones: options.minMilestones ?? 1,
    minDiaries: options.minDiaries ?? 2,
    force,
  });
  if (!gate.shouldRun) return { ok: true, skipped: true, reason: gate.reason, monthKey };

  const messages = buildMonthlyAutobiographyPrompt({ monthKey, milestones, diaryEntries: diaries, existingChapters });
  if (dryRun) {
    return { ok: true, dryRun: true, monthKey, promptChars: messages.reduce((s, m) => s + m.content.length, 0) };
  }

  const llm = await callMonthlyLlm(messages, {
    model: options.model || "",
    effort,
    baseUrl: options.baseUrl || "",
    apiKey: options.apiKey || "",
    protocol: options.protocol || "auto",
    gatewayUrl: options.gatewayUrl || DEFAULT_GATEWAY_URL,
    ollamaUrl: options.ollamaUrl || DEFAULT_OLLAMA_URL,
    fetchFn: options.fetchFn || globalThis.fetch,
  });

  const parsed = llm.ok && llm.content
    ? parseMonthlyAutobiographyOutput(llm.content, { monthKey, milestones, diaryEntries: diaries, now })
    : { ok: false, error: "llm_unavailable", parsed: buildDeterministicMonthlyFallback({ monthKey, milestones, diaryEntries: diaries, now }) };

  const record = {
    ...parsed.parsed,
    monthKey,
    provider: llm.provider,
    model: llm.model,
    effort: llm.effort,
    usage: llm.usage,
    estimatedCostCny: estimateCostCny(llm.model, llm.usage),
    parseOk: parsed.ok,
  };

  const merged = existingChapters
    .filter((c) => String(c.monthKey) !== monthKey)
    .concat([record])
    .sort((a, b) => String(a.monthKey).localeCompare(String(b.monthKey)));
  writeJsonlAtomic(chaptersPath, merged);

  mkdirSync(diaryDir, { recursive: true });
  const markdownPath = join(diaryDir, `monthly-${monthKey}.md`);
  writeFileSync(markdownPath, renderMonthlyChapterMarkdown(record), "utf8");

  return { ok: true, skipped: false, monthKey, markdownPath, record };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || "export";
  if (cmd === "export") {
    const outIdx = argv.indexOf("--out");
    console.log(JSON.stringify(exportSoulLedger({ outPath: outIdx !== -1 ? argv[outIdx + 1] : "" }), null, 2));
  } else if (cmd === "import") {
    const inIdx = argv.indexOf("--file");
    const modeIdx = argv.indexOf("--mode");
    console.log(JSON.stringify(importSoulLedger({
      filePath: inIdx !== -1 ? argv[inIdx + 1] : "",
      mode: modeIdx !== -1 ? argv[modeIdx + 1] : "merge",
    }), null, 2));
  } else if (cmd === "monthly") {
    const force = argv.includes("--force");
    const dryRun = argv.includes("--dry-run");
    const mIdx = argv.indexOf("--model");
    const eIdx = argv.indexOf("--effort");
    const uIdx = argv.indexOf("--url");
    const kIdx = argv.indexOf("--key");
    const pIdx = argv.indexOf("--protocol");
    console.log(JSON.stringify(await runMonthlyAutobiography({
      force,
      dryRun,
      model: mIdx !== -1 ? argv[mIdx + 1] : "",
      effort: eIdx !== -1 ? argv[eIdx + 1] : DEFAULT_EFFORT,
      baseUrl: uIdx !== -1 ? argv[uIdx + 1] : "",
      apiKey: kIdx !== -1 ? argv[kIdx + 1] : "",
      protocol: pIdx !== -1 ? argv[pIdx + 1] : "auto",
    }), null, 2));
  } else {
    console.log(JSON.stringify({ ok: false, error: `unknown subcommand: ${cmd} (use export | import | monthly)` }));
  }
}
