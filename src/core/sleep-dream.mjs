// Sleep-time Compute ("Dreaming") Consolidation Engine
// Pure core module: ZERO fs / sqlite / channel / network imports.
// Inspired by Letta Sleep-time Compute: asynchronously distills Core Memory Blocks,
// shared jargon/inside-jokes, active threads, and bi-temporal contradiction alerts.

import { isScheduleLikelyPassed, preferReadableMemoryText } from "./memory-cognition.mjs";
import { buildBiTemporalTriples } from "./memory-graph-v2.mjs";

const JARGON_CANDIDATES = [
  "新家", "手账", "记忆星图", "星图", "全息", "小汐", "活人感", "视觉记忆", "创意插件", "小用户", "小习惯",
];

function uniqLimit(list, limit = 4) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const s = String(item ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Run a deterministic Sleep-time Compute ("Dreaming") consolidation cycle.
 * Produces compact self-editable Core Memory Blocks to keep active prompts thin & sharp.
 */
export function runDreamCycle({
  events = [],
  triples = null,
  rawRows = [],
  learnedHabits = [],
  existingBlocks = null,
  now = Date.now(),
} = {}) {
  const activeEvents = (Array.isArray(events) ? events : [])
    .filter((e) => e && Number(e.suppressed ?? 0) === 0 && Number(e.forgotten_at ?? 0) === 0);

  const built = Array.isArray(triples) && triples.length > 0
    ? {
      active: triples.filter((t) => Number(t.invalid_at ?? t.invalidAt ?? 0) === 0),
      historical: triples.filter((t) => Number(t.invalid_at ?? t.invalidAt ?? 0) > 0),
    }
    : buildBiTemporalTriples(activeEvents, { now });

  // 1. Core Memory Block: about_owner (compact verified portrait + dislikes)
  const likes = uniqLimit(
    built.active.filter((t) => t.subject === "用户" && t.predicate === "偏好" && Number(t.polarity ?? 1) > 0).map((t) => t.object),
    4
  );
  const dislikes = uniqLimit(
    built.active.filter((t) => t.subject === "用户" && t.predicate === "偏好" && Number(t.polarity ?? 1) < 0).map((t) => t.object),
    3
  );
  const projects = uniqLimit(
    built.active.filter((t) => t.subject === "用户" && t.predicate === "正在做").map((t) => t.object),
    2
  );
  const activities = uniqLimit(
    built.active.filter((t) => t.subject === "用户" && t.predicate === "日常活动").map((t) => t.object),
    4
  );

  const aboutOwnerParts = [];
  if (likes.length > 0) aboutOwnerParts.push(`喜欢${likes.join("、")}`);
  if (activities.length > 0) {
    const extraActs = activities.filter((a) => !likes.includes(a));
    if (extraActs.length > 0) aboutOwnerParts.push(`常做${extraActs.slice(0, 3).join("、")}`);
  }
  if (dislikes.length > 0) aboutOwnerParts.push(`明确不喜欢${dislikes.join("、")}`);
  if (projects.length > 0) aboutOwnerParts.push(`正在做${projects.join("、")}`);

  // 2. Core Memory Block: active_threads (recent 7-day ongoing topics, skipping pure farewells)
  const FAREWELL_ONLY_RE = /^(?:晚安|早安|明天见|拜拜|先睡了|睡了|晚安明天见)[，。！!？?~～\s]*$/;
  const sevenDaysAgo = Number(now) - 7 * 86400000;
  const recentHigh = activeEvents
    .filter((e) => Number(e.ts ?? 0) >= sevenDaysAgo || Number(e.pinned ?? 0) === 1)
    .filter((e) => !FAREWELL_ONLY_RE.test(String(e.text ?? "").trim()))
    .slice()
    .sort((a, b) => (Number(b.ts ?? 0) - Number(a.ts ?? 0)) || (Number(b.intensity ?? 0) - Number(a.intensity ?? 0)))
    .slice(0, 4)
    .map((e) => preferReadableMemoryText(e.text, e.gist).replace(/^(?:用户|你|小汐)[:：]\s*/, "").replace(/[，,、；;]+$/, "").slice(0, 36));
  const activeThreads = uniqLimit(recentHigh, 3);

  // 3. Core Memory Block: shared_vibe (top interaction preferences & habits)
  const sortedHabits = (Array.isArray(learnedHabits) ? learnedHabits : [])
    .filter((h) => h && String(h.rule ?? "").trim())
    .slice()
    .sort((a, b) => (Number(b.confidence ?? 0) - Number(a.confidence ?? 0)) || (Number(b.hits ?? 0) - Number(a.hits ?? 0)));
  const sharedVibe = uniqLimit(
    sortedHabits.map((h) => String(h.rule).trim().slice(0, 34)),
    3
  );

  // 4. Core Memory Block: jargon_glossary (recurring shared terms between Cai & SoulCard)
  const corpus = [
    ...activeEvents.map((e) => String(e.text ?? "")),
    ...(Array.isArray(rawRows) ? rawRows.slice(-160).map((r) => String(r?.text ?? "")) : []),
  ];
  const jargonHits = [];
  for (const term of JARGON_CANDIDATES) {
    let count = 0;
    for (const line of corpus) {
      if (line.includes(term)) count += 1;
    }
    if (count >= 2) jargonHits.push({ term, count });
  }
  jargonHits.sort((a, b) => b.count - a.count);
  const jargonGlossary = jargonHits.slice(0, 6);

  // 5. Contradiction & Staleness Audit (shifts in bi-temporal history + expired relative schedules)
  const contradictions = [];
  for (const hist of built.historical) {
    const newer = built.active.find(
      (a) => a.subject === hist.subject && a.predicate === hist.predicate && a.object === hist.object
    );
    if (newer && Number(newer.polarity) !== Number(hist.polarity)) {
      contradictions.push({
        type: "polarity_shift",
        object: hist.object,
        summary: `「${hist.object}」已从${Number(hist.polarity) > 0 ? "喜欢" : "不喜欢"}变更为${Number(newer.polarity) > 0 ? "喜欢" : "不喜欢"}`,
        at: Number(hist.invalid_at ?? hist.invalidAt ?? now),
      });
    }
  }
  for (const ev of activeEvents) {
    if (isScheduleLikelyPassed(ev.text, ev.ts, now)) {
      contradictions.push({
        type: "stale_schedule",
        eventId: Number(ev.id ?? 0),
        summary: `相对日程可能已过期：${preferReadableMemoryText(ev.text, ev.gist).slice(0, 32)}`,
        at: Number(ev.ts ?? 0),
      });
    }
  }

  const cycleCount = Number(existingBlocks?.cycleCount ?? 0) + 1;
  const dreamNote = `第 ${cycleCount} 次梦境整理完成：提炼 ${aboutOwnerParts.length} 项画像、${activeThreads.length} 条近期主线、${jargonGlossary.length} 个共同高频词，发现 ${contradictions.length} 条时态变化/过期日程。`;

  return {
    version: 1,
    cycleCount,
    updatedAt: Number(now),
    blocks: {
      about_owner: aboutOwnerParts.join("；") || String(existingBlocks?.blocks?.about_owner ?? ""),
      active_threads: activeThreads,
      shared_vibe: sharedVibe,
      jargon_glossary: jargonGlossary,
    },
    contradictions: contradictions.slice(0, 8),
    stats: {
      activeEvents: activeEvents.length,
      activeTriples: built.active.length,
      historicalTriples: built.historical.length,
    },
    dreamNote,
  };
}

/**
 * Compress dream Core Memory Blocks into a super-thin single-line capsule for Depth=2 prompt injection.
 */
export function formatCoreMemoryCapsule(dreamState, maxChars = 140) {
  const b = dreamState?.blocks;
  if (!b || typeof b !== "object") return "";
  const parts = [];
  if (b.about_owner) parts.push(String(b.about_owner));
  if (Array.isArray(b.shared_vibe) && b.shared_vibe.length > 0) {
    parts.push(`默契：${b.shared_vibe[0]}`);
  }
  const joined = parts.join("｜").trim();
  if (!joined) return "";
  return joined.length > maxChars ? joined.slice(0, maxChars - 1) + "…" : joined;
}
