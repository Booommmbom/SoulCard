// Bi-Temporal Knowledge Graph + Personalized PageRank (PPR) + Source Attribution
// Pure core module: ZERO fs / sqlite / channel / network imports (strictly passes test-core-purity).

import {
  COGNITIVE_BRIDGES,
  canonicalizeConcept,
  computeEmotionalGate,
  enrichMemoryRecord,
  extractConceptTokens,
  isScheduleLikelyPassed,
  preferReadableMemoryText,
} from "./memory-cognition.mjs";

const VISUAL_SOURCE_RE = /(视觉记忆|看图|这张图|画面里|图片里|\bvisual\b)/i;
const PROMISE_SOURCE_RE = /(约定|承诺|说好|答应|下次一定|回头一起|\bpromise\b)/i;
const WORKSPACE_SOURCE_RE = /(新家置顶手账|手账卡|workspace_note)/i;
const SELF_INFERRED_TAG_RE = /(nuomu_auto|auto_qwen|self_inferred|auto_promote)/i;

const NEGATIVE_PREF_RE = /(?:不是很喜欢|不太喜欢|不怎么喜欢|不喜欢|不爱|讨厌|最烦|不想聊|没兴趣|不感兴趣|不再喜欢|戒了|不喝|不吃)([^，。！？,.!?；;\n]{1,18})/g;
const POSITIVE_PREF_RE = /(?:很喜欢|最喜欢|超喜欢|挺喜欢|喜欢|爱玩|爱拍|爱吃|爱喝|热衷于|平时(?:喜欢|爱)?)([^，。！？,.!?；;\n]{1,18})/g;
const DOING_PROJECT_RE = /(?:正在做|在做|在给诺姆做|准备做|在写|在搭|打算做)([^，。！？,.!?；;\n]{2,22})/g;
const HABIT_ACTIVITY_RE = /(?:去健身|健身|爬山|爬了山|练肩|练背|跑步|散步|修图|打游戏|打打游戏|拍照|拍拍照)/g;
const INTERACTION_RULE_RE = /(不用老是|别老是|不要总是|别催|不要催|别问我下一句|不想听.*说教|别端着|自然相处|活人感|敷衍)/;

const GENERIC_OBJECTS = new Set([
  "这个", "那个", "什么", "这些", "那些", "这样", "那样", "一点", "一下", "东西", "事情",
  "自己", "我们", "你们", "他们", "诺姆", "对方", "别人", "地方", "感觉", "时候",
  "这种质感", "那种质感", "这种感觉", "那种感觉", "这种", "那种", "质感",
  "话", "句", "事", "人", "图", "它", "他", "她", "我", "你",
]);

const TRIPLE_OBJECT_ALIAS = Object.freeze({
  "打游戏": "游戏",
  "打打游戏": "游戏",
  "pc版游戏": "游戏",
  "PC版游戏": "游戏",
  "拍拍照": "拍照",
  "拍照片": "拍照",
  "照片": "拍照",
  "爬了山": "爬山",
});

/**
 * 1. Source Attribution: cleanly distinguish user quotes, visual observations,
 * promises, workspace pinned cards, and self-inferred notes.
 */
export function classifyMemorySource(row = {}) {
  const explicit = String(row.source_type ?? row.sourceType ?? "").trim().toLowerCase();
  const tags = String(row.tags ?? "").toLowerCase();
  const kind = String(row.kind ?? "").toLowerCase();
  const text = String(row.text ?? "");

  if (explicit === "visual_observed" || kind === "visual" || VISUAL_SOURCE_RE.test(tags) || text.includes("视觉记忆")) {
    return { sourceType: "visual_observed", sourceLabel: "一起看图聊到", trustWeight: 0.92 };
  }
  if (explicit === "workspace_note" || kind === "workspace_note" || WORKSPACE_SOURCE_RE.test(tags) || WORKSPACE_SOURCE_RE.test(text)) {
    return { sourceType: "workspace_note", sourceLabel: "手账置顶", trustWeight: 0.96 };
  }
  if (explicit === "promise" || kind === "promise" || tags.includes("promise") || tags.includes("约定")) {
    return { sourceType: "promise", sourceLabel: "我们的约定", trustWeight: 1.0 };
  }
  if (explicit === "self_inferred" || (SELF_INFERRED_TAG_RE.test(tags) && !String(row.evidence ?? "").trim())) {
    return { sourceType: "self_inferred", sourceLabel: "诺姆记下的印象", trustWeight: 0.78 };
  }
  if (explicit === "user_said") {
    return { sourceType: "user_said", sourceLabel: "用户亲口说过", trustWeight: 1.0 };
  }
  if (PROMISE_SOURCE_RE.test(text) && !/(晚安|明天见|早点睡)/.test(text)) {
    return { sourceType: "promise", sourceLabel: "我们的约定", trustWeight: 0.98 };
  }
  return { sourceType: "user_said", sourceLabel: "用户亲口说过", trustWeight: 1.0 };
}

function cleanTripleObject(raw) {
  let s = String(raw ?? "")
    .replace(/^(?:的是|是|去|做|玩|看|聊|拿|给|和|跟|对|把|点|一些|一个|一张|喝|吃|听|买|这种|那种)+/, "")
    .replace(/(?:这些|那些|之类的|什么之类|呀|啊|呢|吧|嘛|哦|了|的|哈|啦)+$/, "")
    .trim();
  if (s.length < 2 || s.length > 18) return "";
  if (GENERIC_OBJECTS.has(s) || /^(?:这种|那种|这个|那个)/.test(s)) return "";
  const canonical = TRIPLE_OBJECT_ALIAS[s] || TRIPLE_OBJECT_ALIAS[s.toLowerCase()] || canonicalizeConcept(s);
  if (canonical) return TRIPLE_OBJECT_ALIAS[canonical] || TRIPLE_OBJECT_ALIAS[canonical.toLowerCase()] || canonical;
  // Preserve multi-word meaningful phrases like "设计街道" / "独立桌面客户端"
  if (/^[\p{Script=Han}A-Za-z0-9_-]{2,18}$/u.test(s)) return s;
  return "";
}

function splitClauseObjects(clause) {
  const pieces = String(clause ?? "")
    .split(/[、,，和跟及与\/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = [];
  for (const p of pieces) {
    // Check if a compound phrase contains 2+ known concepts (e.g. "打打游戏拍拍照" -> ["游戏", "拍照"])
    const subToks = extractConceptTokens(p)
      .map((t) => TRIPLE_OBJECT_ALIAS[t] || t)
      .filter((t) => t && !GENERIC_OBJECTS.has(t));
    const uniqueSub = [...new Set(subToks)];
    if (uniqueSub.length >= 2 && p.length >= 4 && !p.includes("设计街道") && !p.includes("客户端")) {
      for (const t of uniqueSub) out.push(t);
      continue;
    }
    const cleaned = cleanTripleObject(p);
    if (cleaned) {
      out.push(cleaned);
    } else {
      for (const tok of uniqueSub) out.push(tok);
    }
  }
  return [...new Set(out)].slice(0, 4);
}

/**
 * 2. Extract structured bi-temporal relation triples from a single memory event.
 */
export function extractRelationTriples(row = {}) {
  const rawText = preferReadableMemoryText(row.text, row.gist);
  const text = String(rawText ?? "")
    .replace(/^(?:你|用户|owner|user|诺姆|assistant)\s*[:：]\s*/i, "")
    .trim();
  if (text.length < 3) return [];

  const ts = Number(row.ts ?? row.valid_at ?? 0) || Date.now();
  const eventId = Number(row.id ?? 0) || 0;
  const { sourceType, trustWeight } = classifyMemorySource(row);
  const baseConf = Math.min(0.98, Math.max(0.55, (0.65 + Number(row.intensity ?? 0.5) * 0.25) * trustWeight));
  const triples = [];
  const seen = new Set();

  const push = (subject, predicate, object, polarity = 1, confidence = baseConf) => {
    const sub = String(subject ?? "").trim();
    const pred = String(predicate ?? "").trim();
    const obj = String(object ?? "").trim();
    if (!sub || !pred || !obj || obj.length < 2 || GENERIC_OBJECTS.has(obj)) return;
    const key = `${sub}|${pred}|${obj}|${polarity}`;
    if (seen.has(key)) return;
    seen.add(key);
    triples.push({
      subject: sub,
      predicate: pred,
      object: obj,
      polarity: polarity >= 0 ? 1 : -1,
      sourceType,
      sourceEventId: eventId,
      validAt: ts,
      invalidAt: 0,
      confidence: Math.round(confidence * 100) / 100,
    });
  };

  // A. Negative preferences / dislikes (always extract first to avoid polarity contamination)
  const negMatchedSpans = [];
  NEGATIVE_PREF_RE.lastIndex = 0;
  let m;
  while ((m = NEGATIVE_PREF_RE.exec(text)) !== null) {
    negMatchedSpans.push(m[0]);
    const clause = m[1] || "";
    const objs = splitClauseObjects(clause);
    for (const obj of objs) {
      push("用户", "偏好", obj, -1, Math.min(0.98, baseConf + 0.08));
    }
  }

  // Strip negated spans before extracting positive preferences
  let positiveText = text;
  for (const span of negMatchedSpans) {
    positiveText = positiveText.replace(span, " ");
  }

  // B. Positive preferences / hobbies
  POSITIVE_PREF_RE.lastIndex = 0;
  while ((m = POSITIVE_PREF_RE.exec(positiveText)) !== null) {
    const clause = m[1] || "";
    const objs = splitClauseObjects(clause);
    for (const obj of objs) {
      push("用户", "偏好", obj, 1, Math.min(0.96, baseConf + 0.06));
    }
  }

  // C. Active projects / ongoing work
  DOING_PROJECT_RE.lastIndex = 0;
  while ((m = DOING_PROJECT_RE.exec(positiveText)) !== null) {
    const obj = cleanTripleObject(m[1]);
    if (obj) push("用户", "正在做", obj, 1, Math.min(0.95, baseConf + 0.05));
  }

  // D. Concrete lifestyle habits & recurring activities
  HABIT_ACTIVITY_RE.lastIndex = 0;
  while ((m = HABIT_ACTIVITY_RE.exec(positiveText)) !== null) {
    const mapped = canonicalizeConcept(m[0].replace(/^去/, "")) || m[0].replace(/^去/, "");
    if (mapped && !GENERIC_OBJECTS.has(mapped)) {
      push("用户", "日常活动", mapped, 1, baseConf);
    }
  }

  // E. Interaction preference / boundary rules for Nuomu
  if (INTERACTION_RULE_RE.test(text)) {
    const compactRule = text.replace(/\s+/g, " ").slice(0, 22);
    push("诺姆", "相处规则", compactRule, 1, Math.min(0.96, baseConf + 0.05));
  }

  // F. Promises / shared commitments
  if (sourceType === "promise" && !/(晚安|明天见)/.test(text)) {
    const compactPromise = text.replace(/\s+/g, " ").slice(0, 22);
    push("用户和诺姆", "约定", compactPromise, 1, Math.min(0.96, baseConf + 0.05));
  }

  // G. Visual shared observations
  if (sourceType === "visual_observed") {
    const visualConcepts = extractConceptTokens(positiveText, { stripNegation: true }).slice(0, 3);
    for (const vc of visualConcepts) {
      push("用户和诺姆", "一起看过", vc, 1, baseConf * 0.95);
    }
  }

  return triples;
}

/**
 * 3. Build Bi-Temporal Knowledge Graph from chronologically ordered events.
 * When a newer fact flips polarity on the same (subject, predicate, object),
 * the older triple is NOT erased — its `invalidAt` is set to the newer fact's `validAt`,
 * preserving full autobiographical history ("以前喜欢，后来不喜欢了").
 */
export function buildBiTemporalTriples(events = [], { now = Date.now() } = {}) {
  const ordered = (Array.isArray(events) ? events : [])
    .filter((e) => Number(e?.suppressed ?? 0) === 0 && Number(e?.forgotten_at ?? 0) === 0)
    .slice()
    .sort((a, b) => (Number(a.ts ?? 0) - Number(b.ts ?? 0)) || (Number(a.id ?? 0) - Number(b.id ?? 0)));

  const all = [];
  const activeByKey = new Map(); // "subject::predicate::object" -> triple reference in `all`
  let supersededCount = 0;

  for (const ev of ordered) {
    const extracted = extractRelationTriples(ev);
    for (const triple of extracted) {
      const key = `${triple.subject}::${triple.predicate}::${triple.object}`;
      const existing = activeByKey.get(key);

      // Mark already-expired relative schedules gently
      if (triple.predicate === "约定" && isScheduleLikelyPassed(ev.text, triple.validAt, now)) {
        triple.invalidAt = triple.validAt + 3 * 86400000;
        all.push(triple);
        continue;
      }

      if (!existing) {
        all.push(triple);
        activeByKey.set(key, triple);
      } else if (existing.polarity !== triple.polarity) {
        // Bi-Temporal Supersession: close old validity window cleanly
        existing.invalidAt = Math.max(existing.validAt + 1, triple.validAt);
        supersededCount += 1;
        all.push(triple);
        activeByKey.set(key, triple);
      } else {
        // Corroboration: strengthen existing active triple while keeping earliest validAt
        existing.confidence = Math.min(0.99, Math.round((existing.confidence + 0.06) * 100) / 100);
        existing.sourceEventId = triple.sourceEventId || existing.sourceEventId;
        if (triple.sourceType === "user_said") existing.sourceType = "user_said";
      }
    }
  }

  const active = all.filter((t) => Number(t.invalidAt ?? 0) === 0);
  const historical = all.filter((t) => Number(t.invalidAt ?? 0) > 0);
  return { active, historical, all, supersededCount };
}

/**
 * 4. HippoRAG-style Personalized PageRank (PPR) over the unified
 * bi-temporal triple graph + concept edges + curated semantic bridges.
 */
export function runPersonalizedPageRank({
  seeds = [],
  triples = [],
  edges = [],
  damping = 0.82,
  iterations = 12,
  topK = 10,
  includeCuratedBridges = true,
} = {}) {
  const cleanSeeds = [...new Set((Array.isArray(seeds) ? seeds : []).map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (cleanSeeds.length === 0) return [];

  // Adjacency map: node -> Map<neighbor, { weight, relation }>
  const adj = new Map();
  const addLink = (u, v, weight, relation = "") => {
    const a = String(u ?? "").trim();
    const b = String(v ?? "").trim();
    if (!a || !b || a === b || weight <= 0) return;
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    const prevA = adj.get(a).get(b);
    if (!prevA || prevA.weight < weight) adj.get(a).set(b, { weight: (prevA?.weight ?? 0) + weight, relation: relation || prevA?.relation || "" });
    const prevB = adj.get(b).get(a);
    if (!prevB || prevB.weight < weight) adj.get(b).set(a, { weight: (prevB?.weight ?? 0) + weight, relation: relation || prevB?.relation || "" });
  };

  // A. Only ACTIVE bi-temporal triples participate in current associative traversal
  const activeTriples = (Array.isArray(triples) ? triples : []).filter((t) => Number(t.invalid_at ?? t.invalidAt ?? 0) === 0);
  for (const t of activeTriples) {
    const conf = Math.max(0.3, Number(t.confidence ?? 0.8));
    const polLabel = Number(t.polarity ?? 1) < 0 ? `不${t.predicate}` : t.predicate;
    addLink(t.subject, t.object, conf * 1.4, polLabel);
    // Also connect concepts inside object to object node if multi-word
    const subConcepts = extractConceptTokens(t.object);
    for (const sc of subConcepts) {
      if (sc !== t.object) addLink(t.object, sc, conf * 0.9, polLabel);
    }
  }

  // B. SQLite concept co-occurrence edges
  for (const e of Array.isArray(edges) ? edges : []) {
    const a = canonicalizeConcept(e.concept_a);
    const b = canonicalizeConcept(e.concept_b);
    if (!a || !b) continue;
    const w = Math.min(2.0, Math.max(0.3, Number(e.weight ?? 1) / 3));
    addLink(a, b, w, "共现联想");
  }

  // C. Curated human everyday cognitive bridges (light weight so learned facts dominate)
  if (includeCuratedBridges) {
    for (const [k, targets] of Object.entries(COGNITIVE_BRIDGES)) {
      for (const target of targets) {
        addLink(k, target, 0.55, "日常联想");
      }
    }
  }

  // Ensure all seeds exist in graph
  const presentSeeds = cleanSeeds.filter((s) => adj.has(s));
  if (presentSeeds.length === 0) return [];

  const nodes = [...adj.keys()];
  const seedSet = new Set(cleanSeeds);
  const p = new Map();
  const seedWeight = 1 / presentSeeds.length;
  for (const s of presentSeeds) p.set(s, seedWeight);

  // Precompute outgoing total weights
  const outSum = new Map();
  for (const [u, nbrs] of adj.entries()) {
    let sum = 0;
    for (const info of nbrs.values()) sum += info.weight;
    outSum.set(u, sum);
  }

  let rank = new Map(p);
  const bestOrigin = new Map(); // node -> { via, relation, contrib }

  const iters = Math.max(3, Math.min(30, Number(iterations) || 12));
  const d = Math.max(0.5, Math.min(0.95, Number(damping) || 0.82));

  for (let step = 0; step < iters; step += 1) {
    const next = new Map();
    for (const s of presentSeeds) next.set(s, (1 - d) * (p.get(s) ?? 0));

    for (const u of nodes) {
      const ru = rank.get(u) ?? 0;
      if (ru < 1e-7) continue;
      const denom = outSum.get(u) ?? 0;
      if (denom <= 0) continue;
      const nbrs = adj.get(u);
      for (const [v, info] of nbrs.entries()) {
        const flow = d * ru * (info.weight / denom);
        next.set(v, (next.get(v) ?? 0) + flow);
        if (step === iters - 1 && !seedSet.has(v)) {
          const prev = bestOrigin.get(v);
          if (!prev || flow > prev.contrib) {
            bestOrigin.set(v, { via: u, relation: info.relation || "联想", contrib: flow });
          }
        }
      }
    }
    rank = next;
  }

  const results = [];
  for (const [node, score] of rank.entries()) {
    if (seedSet.has(node)) continue;
    // Skip hub-only person names unless specifically relevant
    if (node === "用户" || node === "诺姆" || node === "用户和诺姆") continue;
    if (score < 0.008) continue;
    const orig = bestOrigin.get(node);
    results.push({
      node,
      score: Math.round(score * 10000) / 10000,
      via: orig?.via || presentSeeds[0],
      relation: orig?.relation || "多跳联想",
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, Math.max(1, Number(topK) || 10));
}

/**
 * 5. Multi-Hop PPR Associative Memory Recall.
 * Finds 1-2 memories reachable via 2~3 hops in the bi-temporal knowledge graph,
 * annotates source attribution, and attaches historical-shift notes when a fact changed over time.
 */
export function pprAssociativeRecall({
  query = "",
  seeds = [],
  allRows = [],
  triples = [],
  edges = [],
  limit = 2,
  now = Date.now(),
  moodEmotion = 68,
} = {}) {
  if (!Array.isArray(allRows) || allRows.length === 0 || limit <= 0) return [];
  const seedIds = new Set((Array.isArray(seeds) ? seeds : []).map((s) => Number(s.id)));

  const seedConcepts = new Set(extractConceptTokens(query));
  for (const s of Array.isArray(seeds) ? seeds : []) {
    for (const c of extractConceptTokens(`${s.text ?? ""} ${s.tags ?? ""}`)) {
      seedConcepts.add(c);
    }
  }
  if (seedConcepts.size === 0) return [];

  const rankedNodes = runPersonalizedPageRank({
    seeds: [...seedConcepts],
    triples,
    edges,
    topK: 14,
  });
  if (rankedNodes.length === 0) return [];

  // Index historical shifts for quick awareness (e.g., object used to be +1, now -1)
  const historicalShiftByObj = new Map();
  const activeByObj = new Map();
  for (const t of Array.isArray(triples) ? triples : []) {
    const obj = String(t.object ?? "");
    if (!obj) continue;
    if (Number(t.invalid_at ?? t.invalidAt ?? 0) > 0) {
      historicalShiftByObj.set(obj, t);
    } else {
      activeByObj.set(obj, t);
    }
  }

  const pprMap = new Map(rankedNodes.map((n) => [n.node, n]));
  const candidates = [];

  for (const row of allRows) {
    if (Number(row.suppressed ?? 0) === 1 || Number(row.forgotten_at ?? 0) > 0) continue;
    if (seedIds.has(Number(row.id))) continue;
    const gate = computeEmotionalGate({ query, row, moodEmotion });
    if (gate.suppressedGrudge) continue;

    const rowConcepts = extractConceptTokens(`${row.text ?? ""} ${row.tags ?? ""}`);
    let bestHit = null;
    let totalPpr = 0;
    for (const rc of rowConcepts) {
      const hit = pprMap.get(rc);
      if (hit) {
        totalPpr += hit.score;
        if (!bestHit || hit.score > bestHit.score) bestHit = hit;
      }
    }
    if (!bestHit) continue;

    const { sourceType, sourceLabel, trustWeight } = classifyMemorySource(row);
    const strength = Number(row.pinned ?? 0) === 1 ? 1 : Number(row.strength ?? 0.6);
    const score = totalPpr * (0.5 + 0.5 * strength) * trustWeight * gate.multiplier;

    let biTemporalNote = "";
    const shiftedOld = historicalShiftByObj.get(bestHit.node);
    const shiftedNow = activeByObj.get(bestHit.node);
    if (shiftedOld && shiftedNow && Number(shiftedOld.polarity) !== Number(shiftedNow.polarity)) {
      biTemporalNote = Number(shiftedNow.polarity) < 0
        ? `注意变化：关于「${bestHit.node}」以前喜欢过，后来改口不喜欢了`
        : `注意变化：关于「${bestHit.node}」现在已经改观喜欢了`;
    }

    candidates.push({
      row,
      score,
      bestHit,
      sourceType,
      sourceLabel,
      biTemporalNote,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit).map((c) => enrichMemoryRecord({
    ...c.row,
    memoryText: preferReadableMemoryText(c.row.text, c.row.gist),
    score: Math.round(c.score * 1000) / 1000,
    pprScore: c.bestHit.score,
    associative: true,
    associatedVia: `${c.bestHit.via}→${c.bestHit.node}`,
    sourceType: c.sourceType,
    sourceLabel: c.sourceLabel,
    ...(c.biTemporalNote ? { biTemporalNote: c.biTemporalNote } : {}),
  }, { now }));
}

/**
 * Helper to enrich any recalled memory row with source attribution fields.
 */
export function attachMemorySource(row = {}) {
  const { sourceType, sourceLabel } = classifyMemorySource(row);
  return {
    ...row,
    sourceType: row.sourceType || sourceType,
    sourceLabel: row.sourceLabel || sourceLabel,
  };
}
