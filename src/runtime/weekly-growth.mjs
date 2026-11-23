#!/usr/bin/env node
// Step 2 Runtime Orchestrator: Weekly Developmental Growth Reflection + Stale Habit Retirement.
// Uses pure core packages/nuomu-core/growth-evolution.mjs; never touches data/memory.db.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyHabitRetirementPlan,
  buildDeterministicWeeklyFallback,
  buildWeeklyEvolutionPrompt,
  computeIsoWeekKey,
  computePromptDeclutterStats,
  parseWeeklyEvolutionOutput,
  renderWeeklyMilestoneMarkdown,
  shouldRunWeeklyGrowth,
} from "../core/growth-evolution.mjs";

const DEFAULT_DATA_DIR = resolve(process.env.NUOMU_DATA_DIR || join(process.cwd(), "data"));
const DEFAULT_GATEWAY_URL = process.env.NUOMU_GATEWAY_URL || "http://127.0.0.1:3478/v1/chat/completions";
const DEFAULT_OLLAMA_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434") + "/api/chat";
const DEFAULT_MODEL = process.env.NUOMU_WEEKLY_MODEL || "gemini-4-hydrogen";
const DEFAULT_EFFORT = process.env.NUOMU_WEEKLY_EFFORT || "low";

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

async function callWeeklyLlm(messages, {
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  gatewayUrl = DEFAULT_GATEWAY_URL,
  ollamaUrl = DEFAULT_OLLAMA_URL,
  fetchFn = globalThis.fetch,
} = {}) {
  const isOllama = String(model).startsWith("ollama:");
  if (!isOllama) {
    const eff = String(effort || "low").toLowerCase();
    const maxTokens = eff === "max" ? 16384 : eff === "high" ? 8192 : 4096;
    const timeoutMs = eff === "max" ? 180_000 : eff === "high" ? 120_000 : 90_000;
    try {
      const res = await fetchFn(gatewayUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-nuomu-caller": "weekly-growth" },
        body: JSON.stringify({
          model,
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
            model: data?.model || model,
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
        options: { temperature: 0.4, num_predict: 1000 },
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

export async function runWeeklyGrowthReflection(options = {}) {
  const dataDir = String(options.dataDir || process.env.NUOMU_DATA_DIR || DEFAULT_DATA_DIR);
  const now = Number(options.now || Date.now());
  const weekKey = String(options.weekKey || computeIsoWeekKey(now));
  const minDiaries = Math.max(1, Number(options.minDiaries ?? 1));
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const applyRetire = options.applyRetire !== false;
  const model = String(options.model || DEFAULT_MODEL);
  const effort = String(options.effort || DEFAULT_EFFORT);

  const diaryPath = join(dataDir, "state", "growth-diary.jsonl");
  const milestonesPath = join(dataDir, "state", "growth-milestones.jsonl");
  const habitsPath = join(dataDir, "state", "learned-style-rules.json");
  const retiredPath = join(dataDir, "state", "retired-habits.jsonl");
  const selfAuthoredPath = join(dataDir, "state", "self-authored.jsonl");
  const diaryDir = join(dataDir, "diary");

  const diaryEntries = readJsonlSafe(diaryPath);
  const existingMilestones = readJsonlSafe(milestonesPath);
  const learnedHabits = readJsonSafe(habitsPath, []);
  const retiredHabits = readJsonlSafe(retiredPath);
  const selfAuthored = readJsonlSafe(selfAuthoredPath);

  const gate = shouldRunWeeklyGrowth({
    weekKey,
    diaryEntries,
    existingMilestones,
    minDiaries,
    force,
  });
  if (!gate.shouldRun) {
    return { ok: true, skipped: true, reason: gate.reason, weekKey, diaryCount: gate.diaryCount };
  }

  const messages = buildWeeklyEvolutionPrompt({
    weekKey,
    diaryEntries,
    activeHabits: learnedHabits,
    activeSelfAuthored: selfAuthored,
    existingMilestones,
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      weekKey,
      diaryCount: diaryEntries.length,
      activeHabitCount: Array.isArray(learnedHabits) ? learnedHabits.length : 0,
      promptChars: messages.reduce((s, m) => s + m.content.length, 0),
    };
  }

  const llm = await callWeeklyLlm(messages, {
    model,
    effort,
    gatewayUrl: options.gatewayUrl || DEFAULT_GATEWAY_URL,
    ollamaUrl: options.ollamaUrl || DEFAULT_OLLAMA_URL,
    fetchFn: options.fetchFn || globalThis.fetch,
  });

  const allowedHabitIds = (Array.isArray(learnedHabits) ? learnedHabits : []).map((h) => String(h?.id || "")).filter(Boolean);
  const parsedResult = llm.ok && llm.content
    ? parseWeeklyEvolutionOutput(llm.content, { weekKey, diaryEntries, allowedHabitIds, now })
    : { ok: false, error: "llm_unavailable", parsed: buildDeterministicWeeklyFallback({ weekKey, diaryEntries, now }) };

  const estimatedCostCny = estimateCostCny(llm.model, llm.usage);
  const record = {
    ...parsedResult.parsed,
    weekKey,
    provider: llm.provider,
    model: llm.model,
    effort: llm.effort,
    usage: llm.usage,
    estimatedCostCny,
    parseOk: parsedResult.ok,
  };

  // Upsert weekly milestone
  const mergedMilestones = existingMilestones
    .filter((m) => String(m.weekKey) !== weekKey)
    .concat([record])
    .sort((a, b) => String(a.weekKey).localeCompare(String(b.weekKey)));
  writeJsonlAtomic(milestonesPath, mergedMilestones);

  // Apply auditable habit retirement if recommended
  let retiredNow = [];
  let nextHabits = learnedHabits;
  if (applyRetire && Array.isArray(record.retireHabitIds) && record.retireHabitIds.length > 0) {
    const plan = applyHabitRetirementPlan({
      learnedHabits,
      retireIds: record.retireHabitIds,
      weekKey,
      reason: record.retireReason || "",
      now,
    });
    if (plan.retiredCount > 0) {
      nextHabits = plan.active;
      retiredNow = plan.newlyRetired;
      mkdirSync(dirname(habitsPath), { recursive: true });
      writeFileSync(habitsPath, JSON.stringify(nextHabits, null, 2) + "\n", "utf8");
      writeJsonlAtomic(retiredPath, [...retiredHabits, ...retiredNow]);
    }
  }

  // Write portable weekly markdown
  mkdirSync(diaryDir, { recursive: true });
  const markdownPath = join(diaryDir, `weekly-${weekKey}.md`);
  writeFileSync(markdownPath, renderWeeklyMilestoneMarkdown(record), "utf8");

  const declutterStats = computePromptDeclutterStats({
    learnedHabits: nextHabits,
    selfAuthored,
    diaryEntries,
    milestones: mergedMilestones,
    retiredHabits: [...retiredHabits, ...retiredNow],
  });

  return {
    ok: true,
    skipped: false,
    weekKey,
    markdownPath,
    record,
    retiredNow,
    declutterStats,
  };
}

function parseCliArgs(argv) {
  const out = { weekKey: "", model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, force: false, dryRun: false, minDiaries: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--week" && argv[i + 1]) out.weekKey = argv[++i];
    else if (a === "--model" && argv[i + 1]) out.model = argv[++i];
    else if (a === "--effort" && argv[i + 1]) out.effort = argv[++i];
    else if (a === "--min-diaries" && argv[i + 1]) out.minDiaries = Number(argv[++i]) || 1;
    else if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  const args = parseCliArgs(process.argv.slice(2));
  const res = await runWeeklyGrowthReflection(args);
  console.log(JSON.stringify(res, null, 2));
}
