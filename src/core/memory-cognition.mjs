// Human-like Cognitive Memory Engine (Pure Core, zero IO/SQLite/channel imports).
// Implements:
// 1. Chronesthesia (Autobiographical Relative Time + Schedule Expiry Detection)
// 2. Meta-Memory Clarity Grading (vivid / hazy / faint)
// 3. Emotional Valence Gating (Anti-Grudge Suppression + Fatigue Comfort Boost)
// 4. Spaced Repetition Half-Life (Testing Effect / Ebbinghaus Stability)
// 5. 2-Hop Associative Spreading Activation (Concept Co-occurrence + Semantic Bridges)
// 6. Memory Reconsolidation (Evolutionary Topic Merge vs Fragmentation)
// 7. Event-Based Prospective Memory Wakeup (Keyword-Triggered Commitments)
// 8. Sleep Consolidation (Hippocampus Episodic -> Cortex Person Intuition Schema)

const STOP_CONCEPTS = new Set([
  "今天", "明天", "昨天", "现在", "最近", "这个", "那个", "什么", "怎么", "为什么",
  "可以", "没有", "不是", "就是", "一下", "一点", "觉得", "应该", "真的", "还是",
  "因为", "所以", "但是", "不过", "如果", "虽然", "然后", "或者", "已经", "一直",
  "其实", "可能", "肯定", "大概", "确实", "时候", "东西", "事情", "自己", "我们",
  "你们", "他们", "她们", "对方", "别人", "私聊", "重要", "记忆", "正在", "不早",
  "再聊", "晚安", "早安", "你好", "好的", "一起", "这样", "那样", "这里", "那里",
  "刚才", "待会", "喜欢", "很喜欢", "不喜欢", "讨厌", "不是很", "不太", "我不是",
  "我还是", "小汐", "这些", "那些", "一些", "一个", "一张", "一张图", "一种", "有点",
  "感觉", "想要", "以后", "往后", "之前", "之后", "地方", "细说", "打打", "拍拍",
  "留个", "不拿", "给用户", "给我", "给我看", "看图", "聊到", "当时", "半句", "后半句",
  "一句", "下一句", "下一句话", "不用", "老是", "准备", "天天", "家里", "客户", "独立",
  "明天见", "行你", "话说", "太好听", "好听", "不信", "意思", "什么意思", "问号", "表情", "我看", "刚去", "视觉",
  "fact", "preference", "promise", "soulcard_auto", "auto_qwen", "visual", "reconsolidated"
]);

const CONCEPT_ALIASES = Object.freeze({
  "拍拍照": "拍照",
  "拍照片": "拍照",
  "打打游戏": "打游戏",
  "爬了山": "爬山",
  "pc版": "游戏",
  "pc": "游戏",
});

export function canonicalizeConcept(token) {
  const raw = String(token ?? "").trim();
  if (!raw) return "";
  const low = raw.toLowerCase();
  const mapped = CONCEPT_ALIASES[low] || CONCEPT_ALIASES[raw] || raw;
  const checkLow = mapped.toLowerCase();
  if (STOP_CONCEPTS.has(mapped) || STOP_CONCEPTS.has(checkLow)) return "";
  return mapped;
}

export function preferReadableMemoryText(text, gist) {
  const t = String(text ?? "").trim();
  const g = String(gist ?? "").trim();
  if (!g) return t;
  if (!t) return g;
  const gistHasHan = /[\p{Script=Han}]/u.test(g);
  const textHasHan = /[\p{Script=Han}]/u.test(t);
  // Old auto-summarizers wrote broken English gists (e.g. "Complain about colleagues...")
  // for Chinese memories. Always prefer the faithful Chinese original text in that case.
  if (!gistHasHan && textHasHan) return t;
  return g;
}

const ZH_SEGMENTER = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("zh-CN", { granularity: "word" })
  : null;

// Curated human everyday causal/associative bridges (supplemented dynamically by SQLite memory_edges)
export const COGNITIVE_BRIDGES = Object.freeze({
  "降温": ["冷", "胃", "冰美式", "热饮", "外套", "感冒"],
  "变冷": ["冷", "胃", "冰美式", "外套", "感冒"],
  "冷": ["降温", "胃", "热饮", "外套", "冰美式"],
  "胃": ["冰美式", "降温", "冷", "吃饭", "外卖", "熬夜"],
  "冰美式": ["咖啡", "胃", "降温", "熬夜", "困"],
  "咖啡": ["冰美式", "熬夜", "困", "失眠"],
  "熬夜": ["困", "睡觉", "星图", "修图", "晚安", "咖啡"],
  "修图": ["拍照", "照片", "颜色", "色调", "配色", "画面", "画画"],
  "色调": ["修图", "配色", "照片", "拍照", "画面"],
  "拍照": ["照片", "修图", "配色", "镜头", "相机", "视觉记忆", "新家"],
  "照片": ["拍照", "修图", "配色", "色调", "画面", "视觉记忆", "新家"],
  "出差": ["飞机", "坐飞机", "行李", "酒店", "天气"],
  "飞机": ["出差", "怕坐飞机", "机场", "航班"],
  "新家": ["客户端", "桌面", "画布", "手账", "全息", "照片"],
  "客户端": ["新家", "桌面", "语音", "全息", "手账"],
  "手账": ["新家", "灵感", "画布", "插件", "照片"],
  "星图": ["夜里", "观星", "熬夜", "月亮", "星星"],
  "散步": ["步行地图", "街巷", "路灯", "拍照", "晚风"],
  "步行地图": ["街巷", "散步", "路灯", "坡道", "无障碍"],
  "累": ["歇会儿", "休息", "熬夜", "忙", "陪着"],
  "忙": ["累", "休息", "没时间", "加班", "熬夜"],
  "生日": ["礼物", "纪念", "蛋糕", "庆祝"],
  "吃": ["饿", "晚饭", "外卖", "胃", "忌口"],
  "图片": ["视觉记忆", "修图", "拍照", "照片", "画面", "配色"],
  "视觉记忆": ["图片", "修图", "拍照", "照片", "画面", "配色"],
  "配色": ["修图", "拍照", "照片", "色调", "画面", "画画"],
  "画面": ["图片", "修图", "拍照", "照片", "配色", "视觉记忆"],
  "游戏": ["打游戏", "联机", "通关", "截图", "创意插件", "拍照"],
  "打游戏": ["游戏", "联机", "创意插件", "拍照"],
  "健身": ["爬山", "肩膀", "后背", "运动", "锻炼"],
  "爬山": ["健身", "运动", "拍照"],
  "肩膀": ["健身", "后背", "运动"],
  "后背": ["健身", "肩膀", "运动"],
  "插件": ["创意插件", "灵感", "画布", "手账", "新家"],
  "创意插件": ["插件", "灵感", "画布", "手账", "新家"]
});

const RELATIVE_SCHEDULE_RE = /(明天|后天|今晚|明晚|下周|下礼拜|本周|这周|周[一二三四五六日天]|星期[一二三四五六日天])/;
const SHORT_SCHEDULE_RE = /(今晚|明晚|明天|后天)/;
const CONFLICT_ASK_RE = /(吵架|生气|翻旧账|不开心|闹别扭|委屈|上次气|之前.*气|为什么.*烦)/;
const FATIGUE_STRESS_RE = /(好累|累死|太累|烦死|好烦|撑不住|压力|难受|崩了|想哭|不想干了|忙死|加班|头疼|头晕)/;

/**
 * 1. Chronesthesia: turn a timestamp into human autobiographical relative time.
 */
export function formatRelativeMemoryTime(ts, now = Date.now()) {
  const t = Number(ts ?? 0);
  if (!Number.isFinite(t) || t <= 0) return "";
  const diffMs = Math.max(0, Number(now) - t);
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (mins < 10) return "刚刚";
  if (mins < 55) return "刚才";

  const dNow = new Date(now);
  const dMem = new Date(t);
  const sameDay = dNow.getFullYear() === dMem.getFullYear()
    && dNow.getMonth() === dMem.getMonth()
    && dNow.getDate() === dMem.getDate();

  const hour = dMem.getHours();
  const period = hour < 6 ? "凌晨" : hour < 12 ? "早上" : hour < 18 ? "下午" : hour < 23 ? "晚上" : "深夜";

  if (sameDay) return hours <= 2 ? "刚才" : `今天${period}`;
  if (days <= 1 || (dNow.getDate() - dMem.getDate() === 1 && days < 2)) {
    return hour >= 19 || hour < 5 ? "昨晚" : "昨天";
  }
  if (days === 2) return "前天";
  if (days <= 6) return `${days}天前`;
  if (days <= 13) return "上周";
  if (days <= 28) return "前阵子";
  if (days <= 60) return "上个月";
  const months = Math.max(2, Math.round(days / 30));
  return `${months}个月前`;
}

/**
 * Detect whether a relative schedule mentioned in a memory has likely already passed.
 */
export function isScheduleLikelyPassed(text, ts, now = Date.now()) {
  const s = String(text ?? "");
  const t = Number(ts ?? 0);
  if (!t || !RELATIVE_SCHEDULE_RE.test(s)) return false;
  const ageDays = (Number(now) - t) / 86400000;
  if (SHORT_SCHEDULE_RE.test(s)) return ageDays >= 2.5;
  return ageDays >= 8.5;
}

/**
 * 2. Meta-Memory Clarity Grading (vivid / hazy / faint).
 */
export function classifyMetaMemory(row = {}) {
  const pinned = Number(row.pinned ?? 0) === 1;
  const strength = Number(row.strength ?? 0.7);
  const recalls = Number(row.recall_count ?? 0);
  const intensity = Number(row.intensity ?? 0.5);

  if (pinned || strength >= 0.75 || recalls >= 3 || intensity >= 0.85) {
    return { level: "vivid", hint: "清晰记得" };
  }
  if (strength >= 0.35) {
    return { level: "hazy", hint: "印象大概" };
  }
  return { level: "faint", hint: "模糊残影" };
}

/**
 * 3. Emotional Valence Gating (Anti-Grudge physical suppression + Fatigue comfort boost).
 */
export function computeEmotionalGate({ query = "", row = {}, moodEmotion = 68 } = {}) {
  const q = String(query ?? "");
  const valence = Number(row.valence ?? 0);
  const askingConflict = CONFLICT_ASK_RE.test(q);
  const userFatigued = FATIGUE_STRESS_RE.test(q);

  // Physical-level Anti-Grudge: suppress painful/negative old memories unless user explicitly brings up conflict
  if (valence < -0.3 && !askingConflict) {
    return { multiplier: 0.08, suppressedGrudge: true, comfortBoost: false };
  }
  // When user is exhausted/stressed, gently elevate warm, affectionate memories
  if (userFatigued && valence >= 0.4) {
    return { multiplier: 1.28, suppressedGrudge: false, comfortBoost: true };
  }
  // Warm mood resonance
  if (Number(moodEmotion) >= 65 && valence >= 0.5) {
    return { multiplier: 1.12, suppressedGrudge: false, comfortBoost: false };
  }
  return { multiplier: 1, suppressedGrudge: false, comfortBoost: false };
}

/**
 * 4. Spaced Repetition Half-Life (Testing Effect).
 * When recall_count === 0, multiplier is strictly 1.0 (preserves existing decay tests).
 */
export function effectiveHalfLifeDays(row = {}, baseHalfLifeDays = 14) {
  const base = Math.max(1, Number(baseHalfLifeDays) || 14);
  const intensity = Math.max(0, Math.min(1, Number(row.intensity ?? 0.5)));
  const recallCount = Math.max(0, Math.floor(Number(row.recall_count ?? 0)));
  const flashbulbBoost = intensity >= 0.85 && Number(row.valence ?? 0) >= 0.45 ? 1.5 : 1;
  const spacedBoost = recallCount === 0 ? 1 : Math.min(12, Math.pow(1.65, Math.min(6, recallCount)));
  return Math.max(1, base * (0.6 + intensity) * flashbulbBoost * spacedBoost);
}

/**
 * Extract meaningful Chinese/English concept tokens using native ICU Intl.Segmenter
 * so we never produce broken cross-word Chinese slices.
 */
export function extractConceptTokens(text, { stripNegation = false } = {}) {
  let raw = String(text ?? "")
    .replace(/^(?:你|用户|owner|user|小汐|assistant)\s*[:：]\s*/i, "")
    .trim();
  if (!raw) return [];
  if (stripNegation) {
    raw = raw.replace(NEGATION_CLAUSE_RE, " ").trim();
    if (!raw) return [];
  }
  const concepts = new Set();
  const addClean = (tok) => {
    const c = canonicalizeConcept(tok);
    if (c) concepts.add(c);
  };

  // 1. Check curated domain concepts & aliases first (high precision)
  for (const [alias, canonical] of Object.entries(CONCEPT_ALIASES)) {
    if (alias.length >= 2 && raw.includes(alias)) addClean(canonical);
  }
  for (const key of Object.keys(COGNITIVE_BRIDGES)) {
    if (raw.includes(key)) addClean(key);
    for (const target of COGNITIVE_BRIDGES[key]) {
      if (raw.includes(target)) addClean(target);
    }
  }

  // 2. Native Chinese word segmentation via Intl.Segmenter("zh-CN")
  if (ZH_SEGMENTER !== null) {
    for (const part of ZH_SEGMENTER.segment(raw)) {
      if (!part.isWordLike) continue;
      const word = part.segment.trim();
      const low = word.toLowerCase();
      if (/^[A-Za-z0-9_-]{3,16}$/.test(low)) {
        addClean(low);
      } else if (/^[\p{Script=Han}]{2,6}$/u.test(word)) {
        addClean(word);
      }
      if (concepts.size >= 12) break;
    }
  } else {
    const segments = raw.match(/[\p{Script=Han}]{2,4}|[A-Za-z0-9_-]{3,16}/gu) ?? [];
    for (const seg of segments) {
      addClean(seg);
      if (concepts.size >= 12) break;
    }
  }
  return [...concepts].slice(0, 12);
}

/**
 * 5. 2-Hop Associative Spreading Activation.
 * Given query + 1-hop seed memories, traverse concept bridges + learned SQLite edges
 * to surface 1-2 causally/emotionally connected memories that 1-hop similarity missed.
 */
export function spreadActivation({ query = "", seeds = [], allRows = [], edges = [], limit = 2, now = Date.now(), moodEmotion = 68 } = {}) {
  if (!Array.isArray(allRows) || allRows.length === 0 || limit <= 0) return [];
  const seedIds = new Set(seeds.map((s) => Number(s.id)));
  const activeConcepts = new Map(); // concept -> activation energy

  const addConcept = (token, energy) => {
    const key = String(token ?? "").trim();
    if (!key || STOP_CONCEPTS.has(key)) return;
    activeConcepts.set(key, Math.max(activeConcepts.get(key) ?? 0, energy));
  };

  // Seed energy from query + 1-hop recalled memories
  for (const tok of extractConceptTokens(query)) addConcept(tok, 1.0);
  for (const s of seeds) {
    for (const tok of extractConceptTokens(`${s.text ?? ""} ${s.tags ?? ""}`)) {
      addConcept(tok, 0.75);
    }
  }

  // Hop 1 -> Hop 2 across curated cognitive bridges + learned edges
  const expanded = new Map(); // concept -> { energy, via }
  for (const [concept, energy] of activeConcepts.entries()) {
    const curated = COGNITIVE_BRIDGES[concept];
    if (Array.isArray(curated)) {
      for (const next of curated) {
        if (activeConcepts.has(next)) continue;
        const nextEnergy = energy * 0.72;
        if (!expanded.has(next) || expanded.get(next).energy < nextEnergy) {
          expanded.set(next, { energy: nextEnergy, via: concept });
        }
      }
    }
  }
  for (const edge of Array.isArray(edges) ? edges : []) {
    const a = String(edge.concept_a ?? "");
    const b = String(edge.concept_b ?? "");
    const w = Math.min(1, Math.max(0.2, Number(edge.weight ?? 0.5) / 5));
    if (activeConcepts.has(a) && !activeConcepts.has(b)) {
      const e = activeConcepts.get(a) * (0.55 + 0.35 * w);
      if (!expanded.has(b) || expanded.get(b).energy < e) expanded.set(b, { energy: e, via: a });
    } else if (activeConcepts.has(b) && !activeConcepts.has(a)) {
      const e = activeConcepts.get(b) * (0.55 + 0.35 * w);
      if (!expanded.has(a) || expanded.get(a).energy < e) expanded.set(a, { energy: e, via: b });
    }
  }

  if (expanded.size === 0) return [];

  const candidates = [];
  for (const row of allRows) {
    if (Number(row.suppressed ?? 0) === 1 || Number(row.forgotten_at ?? 0) > 0) continue;
    if (seedIds.has(Number(row.id))) continue;
    if (String(row.tags ?? "").includes("琐事")) continue;
    const gate = computeEmotionalGate({ query, row, moodEmotion });
    if (gate.suppressedGrudge) continue;

    const hay = `${row.text ?? ""} ${row.tags ?? ""}`;
    let bestEnergy = 0;
    let bestVia = "";
    let bestMatched = "";
    for (const [concept, info] of expanded.entries()) {
      if (hay.includes(concept) && info.energy > bestEnergy) {
        bestEnergy = info.energy;
        bestVia = info.via;
        bestMatched = concept;
      }
    }
    if (bestEnergy < 0.45) continue;
    const strength = Number(row.pinned ?? 0) === 1 ? 1 : Math.max(0.1, Number(row.strength ?? 0.6));
    const score = bestEnergy * (0.5 + 0.5 * strength) * gate.multiplier;
    candidates.push({
      row,
      score,
      viaConcept: bestVia && bestMatched ? `${bestVia}→${bestMatched}` : bestVia || bestMatched,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit).map((item) =>
    enrichMemoryRecord(item.row, { now, associative: true, viaConcept: item.viaConcept })
  );
}

/**
 * 6. Memory Reconsolidation: detect whether a new memory is an update/evolution
 * of an existing non-pinned memory on the same topic, and merge them smoothly.
 */
function conceptTopicSimilarity(aText, bText) {
  const a = new Set(extractConceptTokens(aText));
  const b = new Set(extractConceptTokens(bText));
  if (a.size < 2 || b.size < 2) return { jaccard: 0, overlap: 0, inter: 0 };
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return {
    inter,
    jaccard: inter / Math.max(1, a.size + b.size - inter),
    overlap: inter / Math.max(1, Math.min(a.size, b.size)),
  };
}

export function findReconsolidateTarget(newText, existingRows = []) {
  const cleanNew = String(newText ?? "").trim();
  if (cleanNew.length < 8) return null;
  let best = null;
  let bestScore = 0;
  for (const row of existingRows) {
    if (Number(row.suppressed ?? 0) === 1) continue;
    if (Number(row.pinned ?? 0) === 1) continue; // Pinned facts are protected by explicit governance
    const oldText = String(row.text ?? "").trim();
    if (oldText === cleanNew || oldText.length < 6) continue;
    const { inter, jaccard, overlap } = conceptTopicSimilarity(cleanNew, oldText);
    const sameTopic = (inter >= 3 && overlap >= 0.55) || (inter >= 2 && jaccard >= 0.45);
    if (sameTopic && jaccard < 0.96 && overlap > bestScore) {
      bestScore = overlap;
      best = row;
    }
  }
  return best ? { row: best, overlap: Number(bestScore.toFixed(2)) } : null;
}

export function mergeReconsolidatedText(oldText, newText) {
  const a = String(oldText ?? "").trim();
  const b = String(newText ?? "").trim();
  if (!a) return b;
  if (!b) return a;
  if (b.includes(a)) return b.slice(0, 240);
  if (a.includes(b)) return a.slice(0, 240);
  const parts = a.split("；最新进展：").map((s) => s.trim()).filter(Boolean);
  const root = parts[0].slice(0, 110);
  const merged = `${root}；最新进展：${b.slice(0, 110)}`;
  return merged.slice(0, 240);
}

/**
 * 7. Event-Based Prospective Memory Wakeup:
 * Matches active pending commitments when user mentions any meaningful trigger keyword.
 */
export function matchProspectiveCommitments(query, commitments = [], limit = 2) {
  const q = String(query ?? "").trim();
  if (q.length < 2 || !Array.isArray(commitments) || commitments.length === 0) return [];
  const qConcepts = extractConceptTokens(q);
  const hits = [];
  for (const c of commitments) {
    if (c?.status !== "pending") continue;
    const content = String(c.content ?? "").trim();
    if (!content) continue;
    const cConcepts = extractConceptTokens(content);
    const matched = cConcepts.filter((tok) => q.includes(tok) || qConcepts.includes(tok));
    if (matched.length > 0) {
      hits.push({
        id: c.id || `commit-${c.sourceEventId ?? 0}`,
        ts: Number(c.committedAt ?? Date.now()),
        text: content,
        memoryText: content,
        similarity: 0.99,
        strength: 1,
        pinned: 1,
        prospective: true,
        matchedTrigger: matched[0],
        whenLabel: formatRelativeMemoryTime(c.committedAt, Date.now()) || "约定中",
        clarity: "vivid",
        clarityHint: "待办约定唤醒",
      });
    }
  }
  return hits.slice(0, limit);
}

/**
 * Attach human cognitive metadata (relative time, expiry flag, clarity grade, associative tag) to any memory row.
 */
export function enrichMemoryRecord(row, { now = Date.now(), associative = false, viaConcept = "", prospective = false } = {}) {
  const text = String(row.memoryText ?? row.text ?? "").trim();
  const whenLabel = formatRelativeMemoryTime(row.ts, now);
  const schedulePassed = isScheduleLikelyPassed(text, row.ts, now);
  const meta = classifyMetaMemory(row);
  return {
    ...row,
    memoryText: text,
    whenLabel,
    schedulePassed,
    clarity: meta.level,
    clarityHint: prospective ? "待办约定唤醒" : (associative ? `顺藤摸瓜联想到(${viaConcept})` : meta.hint),
    associative: Boolean(associative),
    viaConcept: String(viaConcept ?? ""),
    prospective: Boolean(prospective),
  };
}

const NEGATION_CLAUSE_RE = /(?:不是很喜欢|不太喜欢|不怎么喜欢|不喜欢|不爱|讨厌|最烦|不想聊|没兴趣|不感兴趣|别拿|不拿)([^，。！？,.!?；;]{1,18})/g;

/**
 * Extract topics explicitly disliked or negated by the user so they never pollute topInterests.
 */
export function extractDislikedConcepts(text) {
  const s = String(text ?? "").trim();
  if (!s) return [];
  const disliked = new Set();
  for (const match of s.matchAll(NEGATION_CLAUSE_RE)) {
    const span = String(match[1] ?? "").trim();
    if (!span) continue;
    for (const tok of extractConceptTokens(span)) {
      disliked.add(tok);
    }
  }
  return [...disliked];
}

/**
 * 8. Sleep Consolidation: Distill Episodic Events + Raw Messages into a compact Cortex Person Schema.
 */
export function distillPersonSchema({ events = [], rawRows = [], existingSchema = null, now = Date.now() } = {}) {
  const activeEvents = (Array.isArray(events) ? events : []).filter(
    (e) => Number(e.suppressed ?? 0) === 0 && Number(e.forgotten_at ?? 0) === 0 && !String(e.tags ?? "").includes("琐事")
  );
  const userRows = (Array.isArray(rawRows) ? rawRows : []).filter((r) => r?.role === "user" && Number(r.ts) > 0);

  // 1. Circadian / active hour rhythm
  const buckets = { lateNight: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const r of userRows.slice(-200)) {
    const h = new Date(Number(r.ts)).getHours();
    if (h >= 23 || h < 5) buckets.lateNight += 1;
    else if (h >= 5 && h < 12) buckets.morning += 1;
    else if (h >= 12 && h < 18) buckets.afternoon += 1;
    else buckets.evening += 1;
  }
  const totalAct = buckets.lateNight + buckets.morning + buckets.afternoon + buckets.evening;
  let rhythm = existingSchema?.rhythm || "常在晚间与深夜出现，喜欢安静的一对一陪伴";
  if (totalAct >= 5) {
    if (buckets.lateNight / totalAct >= 0.35) rhythm = "偏夜猫子作息，常在深夜(23:00-03:00)活跃，夜聊时说话节奏宜放轻";
    else if (buckets.evening / totalAct >= 0.4) rhythm = "常在晚间放松时段上线聊天，喜欢聊当天生活与手头创作";
    else if (buckets.afternoon / totalAct >= 0.4) rhythm = "下午时段较为活跃，间歇来聊几句";
  }

  // 2. Negation-aware interest & dislike distillation from non-trivial events
  const dislikeFreq = new Map();
  const freq = new Map();
  for (const ev of activeEvents) {
    const rawEvText = String(ev.text ?? "");
    const dislikedHere = extractDislikedConcepts(rawEvText);
    for (const d of dislikedHere) {
      dislikeFreq.set(d, (dislikeFreq.get(d) ?? 0) + 1);
    }
    const positiveText = rawEvText.replace(NEGATION_CLAUSE_RE, " ");
    for (const tok of extractConceptTokens(`${positiveText} ${ev.tags ?? ""}`)) {
      freq.set(tok, (freq.get(tok) ?? 0) + (Number(ev.pinned) === 1 ? 2 : 1));
    }
  }
  const dislikes = [...dislikeFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);
  const dislikeSet = new Set(dislikes);
  const topInterests = [...freq.entries()]
    .filter(([k]) => !dislikeSet.has(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k);

  // 3. Core high-salience facts (pinned or strong positive) — prefer faithful Chinese text over broken English gist
  const coreAnchors = activeEvents
    .filter((e) => Number(e.pinned) === 1 || Number(e.intensity ?? 0) >= 0.75)
    .slice(0, 6)
    .map((e) => preferReadableMemoryText(e.text, e.gist))
    .filter(Boolean);

  return {
    schema: "soulcard.person-schema.v1",
    person: "用户",
    updatedAt: now,
    rhythm,
    topInterests,
    dislikes,
    coreAnchors,
    comfortStyle: "他喊累或忙完回来时先自然接住情绪陪他歇口气，不翻旧账、不追问进度、不列方案清单。",
    sourceEventCount: activeEvents.length,
    sourceMessageCount: userRows.length,
  };
}

export function formatPersonSchemaPrompt(schema) {
  if (!schema || typeof schema !== "object") return "";
  const parts = [];
  if (schema.rhythm) parts.push(`作息直觉：${schema.rhythm}`);
  if (Array.isArray(schema.topInterests) && schema.topInterests.length > 0) {
    parts.push(`常聊关注点：${schema.topInterests.slice(0, 6).join("、")}`);
  }
  if (Array.isArray(schema.dislikes) && schema.dislikes.length > 0) {
    parts.push(`明确不感兴趣：${schema.dislikes.slice(0, 6).join("、")}（别拿这些反复烦他）`);
  }
  if (Array.isArray(schema.coreAnchors) && schema.coreAnchors.length > 0) {
    parts.push(`核心近况：${schema.coreAnchors.slice(0, 3).join("；")}`);
  }
  return parts.join("；");
}

const VISUAL_ERROR_REPLY_RE = /(打不开|看不到|看不了|没法看|发不过来|加载失败|出错|超时|系统忙|没收到图|图片损坏|无法查看)/;

/**
 * 9. Visual Episodic Memory: distill the companion's visual observation/critique when user shares images.
 */
export function buildVisualMemoryRecord({ userText = "", assistantText = "", imageCount = 0, now = Date.now() } = {}) {
  const count = Math.floor(Number(imageCount) || 0);
  if (count <= 0) return null;
  const cleanReply = String(assistantText ?? "")
    .replace(/\[(?:sighs|yawns|chuckles|softly|sleepy)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleanReply.length < 10 || VISUAL_ERROR_REPLY_RE.test(cleanReply)) return null;
  const cleanUser = String(userText ?? "")
    .replace(/\[图片\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const qtyLabel = count > 1 ? `${count}张图` : "一张图";
  const rawText = cleanUser.length >= 2
    ? `用户发了${qtyLabel}（${cleanUser.slice(0, 48)}），我当时看图聊到：${cleanReply.slice(0, 120)}`
    : `用户发了${qtyLabel}给我看，我当时看图聊到：${cleanReply.slice(0, 140)}`;
  const text = rawText.slice(0, 190);
  return {
    kind: "visual",
    people: "用户",
    text,
    gist: text.slice(0, 90),
    impression: "用户发图让我一起看并聊了画面细节",
    evidence: (cleanUser ? `${cleanUser.slice(0, 48)} -> ` : "") + cleanReply.slice(0, 120),
    tags: "视觉记忆,图片,visual",
    valence: 0.35,
    intensity: 0.72,
    pinned: false,
    ts: Number(now) || Date.now(),
  };
}

function compactTextLength(text) {
  return String(text ?? "")
    .replace(/[\s，。！？,.!?:：;；~～\-—()（）【】[\]""''`]/g, "")
    .trim().length;
}

/**
 * 10. Theory-of-Mind Silence & Micro-Emotion Detector:
 * Infers unspoken emotional/behavioral cues from absence gaps, sudden brevity drops,
 * late-night hours, and fatigue/stress expressions.
 */
export function analyzeMicroEmotionSignals({ rawRows = [], currentText = "", now = Date.now() } = {}) {
  const nowTs = Number(now) || Date.now();
  const curClean = String(currentText ?? "").trim();
  const userRows = (Array.isArray(rawRows) ? rawRows : [])
    .filter((r) => r?.role === "user" && Number(r.ts) > 0 && typeof r.text === "string" && r.text.trim() !== "")
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  // Separate previous messages from current turn if rawRows already persisted the current turn
  let previousRows = userRows;
  if (curClean && userRows.length > 0) {
    const tail = userRows[userRows.length - 1];
    if (String(tail.text).trim() === curClean && Math.abs(nowTs - Number(tail.ts)) <= 10000) {
      previousRows = userRows.slice(0, -1);
    }
  }

  const signals = [];
  let absenceHours = 0;

  // Cue A: Long absence return (>= 24h since previous message)
  const lastPrev = previousRows.length > 0 ? previousRows[previousRows.length - 1] : null;
  if (lastPrev) {
    absenceHours = Math.max(0, (nowTs - Number(lastPrev.ts)) / 3600000);
    if (absenceHours >= 24) {
      const span = absenceHours >= 48 ? `${Math.floor(absenceHours / 24)}天` : `${Math.round(absenceHours)}小时`;
      signals.push({
        type: "long-absence-return",
        weight: 0.9,
        label: "久别重逢",
        detail: `距离用户上次说话已隔约${span}`,
        hint: `距离用户上次说话已经隔了约${span}，先自然带出一点想念或轻嗔，别像什么都没发生一样冷淡接话。`,
      });
    }
  }

  // Cue B: Sudden curt brevity drop (3 consecutive ultra-short messages <= 4 chars vs baseline >= 10 chars)
  const recentTexts = curClean
    ? [...previousRows.slice(-2).map((r) => r.text), curClean]
    : previousRows.slice(-3).map((r) => r.text);
  const baselineRows = curClean ? previousRows.slice(-14, -2) : previousRows.slice(-15, -3);
  if (recentTexts.length === 3 && baselineRows.length >= 3) {
    const recentLens = recentTexts.map(compactTextLength);
    const baselineAvg = baselineRows.reduce((acc, r) => acc + compactTextLength(r.text), 0) / baselineRows.length;
    if (baselineAvg >= 10 && recentLens.every((len) => len > 0 && len <= 4)) {
      signals.push({
        type: "curt-brevity-drop",
        weight: 0.86,
        label: "话突然变短",
        detail: `平时平均约${Math.round(baselineAvg)}字，连着3句都在4字以内`,
        hint: "用户平时说话挺长，但连着三句突然缩成两三个字，可能正忙、累了或者心里有点闷；语气放轻软一点，顺手关心一句但绝不连环审问。",
      });
    }
  }

  // Cue C: Fatigue or stress expression
  const checkFatigueText = curClean || (lastPrev && (nowTs - Number(lastPrev.ts)) <= 30 * 60000 ? lastPrev.text : "");
  if (checkFatigueText && FATIGUE_STRESS_RE.test(checkFatigueText)) {
    signals.push({
      type: "fatigue-or-stress",
      weight: 0.94,
      label: "疲惫或承压",
      detail: "用户刚流露出累、压力大或不舒服的状态",
      hint: "用户现在明显累了或压力很大，先放软语气自然接住情绪陪他歇口气，别追问进度也别列建议清单。",
    });
  }

  // Cue D: Late-night awake (00:30 - 04:30) — factual awareness only, NEVER nag when user is upbeat/chatting happily
  const dt = new Date(nowTs);
  const minsOfDay = dt.getHours() * 60 + dt.getMinutes();
  const userUpbeat = /(哈哈|笑死|好玩|爽|厉害|身体好|不错|太棒|开心|兴奋|爬了山|健身|打游戏)/.test(curClean);
  if (minsOfDay >= 30 && minsOfDay <= 270 && !userUpbeat) {
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    signals.push({
      type: "late-night-awake",
      weight: 0.65,
      label: "深夜未眠",
      detail: `当前已是凌晨 ${hh}:${mm}`,
      hint: `现在是凌晨 ${hh}:${mm}；如果用户正开心聊话题就尽兴陪他聊，别扫兴催睡；只有他自己喊困或累时再柔声哄着休息。`,
    });
  }

  signals.sort((a, b) => b.weight - a.weight);
  const topHints = signals.slice(0, 2).map((s) => s.hint);
  return {
    primarySignal: signals[0]?.type ?? "calm",
    primaryLabel: signals[0]?.label ?? "平稳自然",
    signals: signals.map(({ type, weight, label, detail, hint }) => ({ type, weight, label, detail, hint })),
    promptHint: topHints.join(" "),
    absenceHours: Number(absenceHours.toFixed(1)),
  };
}

const SIGNAL_COOLDOWN_MS = {
  "late-night-awake": 4 * 3600 * 1000,
  "long-absence-return": 4 * 3600 * 1000,
  "curt-brevity-drop": 15 * 60 * 1000,
  "fatigue-or-stress": 15 * 60 * 1000,
};

/**
 * Edge-trigger filter for micro-emotion signals so transient cues (like late-night-awake)
 * fire ONCE per session window instead of bombing every single turn.
 */
export function selectEdgeTriggeredHint(analysis, cooldownState = new Map(), now = Date.now()) {
  if (!analysis || !Array.isArray(analysis.signals) || analysis.signals.length === 0) return "";
  const nowTs = Number(now) || Date.now();
  const hints = [];
  for (const sig of analysis.signals) {
    if (!sig?.type || !sig?.hint) continue;
    const cd = SIGNAL_COOLDOWN_MS[sig.type] ?? 30 * 60 * 1000;
    const lastAt = Number(cooldownState.get(sig.type) ?? 0);
    if (lastAt > 0 && nowTs - lastAt < cd) continue;
    cooldownState.set(sig.type, nowTs);
    hints.push(sig.hint);
    if (hints.length >= 2) break;
  }
  return hints.join(" ");
}

function classifyHabitTopic(text) {
  if (/睡|熬夜|闭眼|躺/.test(text)) return "作息与不催睡";
  if (/宝贝|叫我|称呼|喊我/.test(text)) return "称呼习惯";
  if (/玩笑|接梗|幽默|逗|活泼|搞笑|冷场/.test(text)) return "接梗与氛围";
  if (/温柔|轻|哄|安抚|撒娇/.test(text)) return "情绪温柔度";
  if (/句号|口语|微信|简短|长一点|多说|少说/.test(text)) return "表达长度与口吻";
  if (/路灯|街道|地图|设计/.test(text)) return "话题避雷";
  if (/游戏|拍照|修图|插件|健身|爬山/.test(text)) return "共同兴趣互动";
  return "日常相处方式";
}

/**
 * 12. Conversational Self-Learning: detect natural interaction/style feedback from chat
 * so SoulCard evolves organically through conversation instead of requiring manual prompt edits.
 */
export function extractInteractionPreference(userText, now = Date.now()) {
  const s = String(userText ?? "").trim();
  if (s.length < 4 || s.length > 160) return null;
  if (/[?？]\s*$/.test(s) && !/能不能别|能不能多|可以别|可以多/.test(s)) return null;
  if (/^(?:测试|只回答|帮我看下|搜一下)/.test(s)) return null;

  const toThird = (clause) => clause
    .replace(/给我/g, "给用户")
    .replace(/跟我/g, "跟用户")
    .replace(/对我/g, "对用户")
    .replace(/叫我/g, "叫用户")
    .replace(/催我/g, "催用户")
    .replace(/烦我/g, "烦用户")
    .replace(/我/g, "用户")
    .replace(/你/g, "小汐")
    .trim();

  // 1. Direct avoidance feedback: "别老催我睡觉了", "不要总叫我宝贝", "说话别那么严肃"
  const avoidMatch = s.match(/(?:别老|不要老|别总|不要总|别老是|不要老是|别动不动就?|别一直|不要一直|以后别|以后不要|不用老|别拿|说话别|回复别)([^，。！？,.!?；;]{2,26})/);
  if (avoidMatch) {
    const cleanClause = toThird(avoidMatch[1]).replace(/[了啊呀嘛啦吧]+$/g, "").trim();
    if (cleanClause.length >= 2) {
      const topic = classifyHabitTopic(avoidMatch[1]);
      return {
        id: `habit-${Number(now) || Date.now()}`,
        kind: "avoid",
        topic,
        rule: `用户自然提醒过：别老${cleanClause}（顺着他当下的兴致自然相处）`,
        evidence: s.slice(0, 120),
        learnedAt: Number(now) || Date.now(),
        reinforcements: 1,
      };
    }
  }

  // 2. Direct positive preference feedback: "我喜欢你多跟我开玩笑", "你可以说话更活泼一点"
  const preferMatch = s.match(/(?:我喜欢你|我更喜欢你|我希望你|你可以多|多跟我|以后多|说话可以|聊天可以|我想听你)([^，。！？,.!?；;]{2,26})/);
  if (preferMatch) {
    const cleanClause = toThird(preferMatch[1]).replace(/[了啊呀嘛啦吧]+$/g, "").trim();
    if (cleanClause.length >= 2) {
      const topic = classifyHabitTopic(preferMatch[1]);
      return {
        id: `habit-${Number(now) || Date.now()}`,
        kind: "prefer",
        topic,
        rule: `用户喜欢这样相处：${cleanClause}`,
        evidence: s.slice(0, 120),
        learnedAt: Number(now) || Date.now(),
        reinforcements: 1,
      };
    }
  }

  // 3. Naturalness critique: "说话不像人", "太像机器人/老妈子/客服"
  if (/(不像人|像机器人|像客服|太死板|太官方|太说教|像老妈子|把天聊死)/.test(s)) {
    return {
      id: `habit-${Number(now) || Date.now()}`,
      kind: "prefer",
      topic: "自然度校准",
      rule: "用户觉得刚才语气太生硬说教，往后说话更松弛口语、多顺着他的情绪好奇接梗，绝不说教赶人",
      evidence: s.slice(0, 120),
      learnedAt: Number(now) || Date.now(),
      reinforcements: 1,
    };
  }

  return null;
}

/**
 * Merge a newly learned interaction habit into the active habit list with topic-level revision.
 */
export function mergeLearnedHabit(existing = [], habit, maxItems = 10) {
  const list = Array.isArray(existing) ? existing.map((x) => ({ ...x })) : [];
  if (!habit || !habit.rule) return list.slice(0, maxItems);
  const idx = list.findIndex((item) => item.rule === habit.rule || (item.topic && item.topic === habit.topic && item.kind === habit.kind));
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      ...habit,
      id: prev.id || habit.id,
      reinforcements: Number(prev.reinforcements ?? 1) + 1,
      updatedAt: habit.learnedAt || Date.now(),
    };
    const [updated] = list.splice(idx, 1);
    list.unshift(updated);
  } else {
    list.unshift(habit);
  }
  return list.slice(0, Math.max(1, Number(maxItems) || 10));
}

export function formatLearnedHabitsPrompt(list = []) {
  const items = (Array.isArray(list) ? list : []).filter((x) => x && typeof x.rule === "string" && x.rule.trim() !== "");
  if (items.length === 0) return "";
  return items.slice(0, 8).map((h) => `- [${h.topic || "相处习惯"}] ${h.rule}`).join("\n");
}

const ZH_DIGIT_MAP = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseZhNumber(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 2 && (s[0] === "零" || s[0] === "〇")) s = s.slice(1);
  if (s === "十") return 10;
  if (s.includes("十")) {
    const [left, right] = s.split("十");
    const tens = left === "" ? 1 : (ZH_DIGIT_MAP[left] ?? NaN);
    const ones = right === "" ? 0 : (ZH_DIGIT_MAP[right] ?? NaN);
    return Number.isFinite(tens) && Number.isFinite(ones) ? tens * 10 + ones : NaN;
  }
  if (s.length === 1 && s in ZH_DIGIT_MAP) return ZH_DIGIT_MAP[s];
  return NaN;
}

function formatDueClock(ts, baseTs) {
  const d = new Date(ts);
  const b = new Date(baseTs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / 86400000);
  const prefix = dayDiff === 0 ? "今天" : dayDiff === 1 ? "明天" : dayDiff === 2 ? "后天" : `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${prefix} ${hh}:${mm}`;
}

/**
 * 11. Time-Based Prospective Memory Parser:
 * Parses relative Chinese durations ("30分钟后", "半小时后", "2小时后")
 * and clock times ("今晚十一点", "今晚23:30", "明天早上9点半") into an exact dueAt timestamp.
 */
export function parseCommitmentDueTime(text, baseTs = Date.now()) {
  const s = String(text ?? "").trim();
  const base = Number(baseTs) || Date.now();
  if (!s) return null;

  // 1. Half hour relative
  if (/半(?:个)?小时(?:后|之后|以后)/.test(s)) {
    const dueAt = base + 30 * 60000;
    return { dueAt, dueLabel: `${formatDueClock(dueAt, base)} (半小时后)`, kind: "relative" };
  }

  // 2. Relative minutes: "30分钟后", "十五分钟以后"
  const minMatch = s.match(/([一二两三四五六七八九十\d]{1,3})\s*分钟(?:后|之后|以后)/);
  if (minMatch) {
    const mins = parseZhNumber(minMatch[1]);
    if (Number.isFinite(mins) && mins >= 1 && mins <= 720) {
      const dueAt = base + mins * 60000;
      return { dueAt, dueLabel: `${formatDueClock(dueAt, base)} (${mins}分钟后)`, kind: "relative" };
    }
  }

  // 3. Relative hours: "2小时后", "一个半小时后", "1小时30分后"
  const hrHalfMatch = s.match(/([一二两三四五六七八九十\d]{1,2})\s*个?半小时(?:后|之后|以后)/);
  if (hrHalfMatch) {
    const hrs = parseZhNumber(hrHalfMatch[1]);
    if (Number.isFinite(hrs) && hrs >= 1 && hrs <= 48) {
      const dueAt = base + (hrs * 60 + 30) * 60000;
      return { dueAt, dueLabel: `${formatDueClock(dueAt, base)} (${hrs}.5小时后)`, kind: "relative" };
    }
  }
  const hrMatch = s.match(/([一二两三四五六七八九十\d]{1,2})\s*(?:个)?小时(?:(半)|([一二三四五六七八九十\d]{1,3})\s*分钟?)?(?:后|之后|以后)/);
  if (hrMatch) {
    const hrs = parseZhNumber(hrMatch[1]);
    const extraMins = hrMatch[2] ? 30 : (hrMatch[3] ? parseZhNumber(hrMatch[3]) : 0);
    if (Number.isFinite(hrs) && hrs >= 1 && hrs <= 72 && Number.isFinite(extraMins) && extraMins >= 0 && extraMins < 60) {
      const dueAt = base + (hrs * 60 + extraMins) * 60000;
      return { dueAt, dueLabel: `${formatDueClock(dueAt, base)} (${hrs}小时${extraMins ? extraMins + "分" : ""}后)`, kind: "relative" };
    }
  }

  // 4. Clock times: "今晚十一点", "今晚23:30", "明天早上9点半", "明晚8点", "下午3点20"
  const clockMatch = s.match(/(今天|今晚|今夜|明天|明早|明晚|后天)?\s*(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|深夜)?\s*([一二两三四五六七八九十\d]{1,3})\s*(?:点钟|点整|点|时|:|：)\s*(半|([零〇一二三四五六七八九十\d]{1,3})\s*分?)?/);
  if (clockMatch) {
    const dayWord = clockMatch[1] || "";
    let period = clockMatch[2] || "";
    const rawHour = parseZhNumber(clockMatch[3]);
    const rawMin = clockMatch[4] === "半" ? 30 : (clockMatch[5] ? parseZhNumber(clockMatch[5]) : 0);
    if (!Number.isFinite(rawHour) || rawHour < 0 || rawHour > 24 || !Number.isFinite(rawMin) || rawMin < 0 || rawMin > 59) {
      return null;
    }
    // Guard against Chinese quantifier phrases like "多喝一点水" / "有一点累" / "买两点零食"
    const matchIdx = clockMatch.index ?? 0;
    const prevChar = matchIdx > 0 ? s[matchIdx - 1] : "";
    const nextChar = s[matchIdx + clockMatch[0].length] || "";
    const hasExplicitClockMarker = Boolean(dayWord || period || clockMatch[4] || /[:：]|点钟|点整/.test(clockMatch[0]));
    if (!hasExplicitClockMarker && (/[有这那多少早晚快慢轻重好差聊做吃喝给来加带买拿省留]/.test(prevChar) || /[儿点心意水钱事东西]/.test(nextChar))) {
      return null;
    }

    let dayOffset = 0;
    if (dayWord === "明天" || dayWord === "明早" || dayWord === "明晚") dayOffset = 1;
    else if (dayWord === "后天") dayOffset = 2;

    if (!period) {
      if (dayWord === "今晚" || dayWord === "今夜" || dayWord === "明晚") period = "晚上";
      else if (dayWord === "明早") period = "早上";
    }

    let hour = rawHour;
    if (/^(下午|傍晚|晚上|夜里|深夜)$/.test(period) && hour >= 1 && hour <= 11) {
      hour += 12;
    } else if (period === "中午" && hour >= 1 && hour <= 4) {
      hour += 12;
    } else if (period === "凌晨" && hour === 12) {
      hour = 0;
    }
    if (hour === 24) {
      hour = 0;
      dayOffset += 1;
    }

    const target = new Date(base);
    target.setDate(target.getDate() + dayOffset);
    target.setHours(hour, rawMin, 0, 0);

    if (!dayWord && target.getTime() <= base) {
      if (!period && hour >= 1 && hour <= 11 && target.getTime() + 12 * 3600000 > base) {
        target.setHours(hour + 12, rawMin, 0, 0);
      } else {
        target.setDate(target.getDate() + 1);
      }
    }
    if (target.getTime() <= base - 60000) return null;
    return { dueAt: target.getTime(), dueLabel: formatDueClock(target.getTime(), base), kind: "clock" };
  }

  return null;
}

/**
 * Find pending timed commitments that are due right now (within 12h grace window) and not yet reminded.
 */
export function findDueCommitments(commitments = [], now = Date.now()) {
  const nowTs = Number(now) || Date.now();
  const maxLateMs = 12 * 3600000;
  return (Array.isArray(commitments) ? commitments : []).filter((c) => {
    if (!c || c.status !== "pending") return false;
    if (Number(c.remindedAt) > 0) return false;
    const dueAt = Number(c.dueAt ?? 0);
    return Number.isFinite(dueAt) && dueAt > 0 && dueAt <= nowTs && (nowTs - dueAt) <= maxLateMs;
  });
}

function formatHistoryClockLabel(ts, nowMs) {
  const d = new Date(ts);
  const b = new Date(nowMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / 86400000
  );
  if (dayDiff === 0) {
    if (nowMs - ts < 10 * 60000) return `刚才 ${hh}:${mm}`;
    return d.getHours() < 5 ? `今天凌晨 ${hh}:${mm}` : `今天 ${hh}:${mm}`;
  }
  if (dayDiff === -1) return `昨天 ${hh}:${mm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

/**
 * 13. Format recent core_turns into chronologically grounded history pairs:
 * - Preserves the companion's own autonomous proactive messages ("[自主]") with clear self-attribution
 *   so she never forgets or denies what she herself just sent.
 * - Inserts concise time markers across 45m+ session gaps so last night's topics are never
 *   mistaken for the current moment.
 */
export function formatHistoryTurnsForCore(rawRows = [], now = Date.now(), gapMs = 45 * 60000) {
  const nowMs = Number(now) || Date.now();
  const out = [];
  let prevTs = 0;
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    const rawUser = String(row?.userText ?? "").trim();
    const rawReply = String(row?.text ?? "").trim();
    if (!rawReply || /^\[?不发\]?$/.test(rawReply)) continue;
    const ts = Number(row?.ts ?? 0) || 0;
    const isAutonomous = rawUser === "[自主]";
    const clock = ts > 0 ? formatHistoryClockLabel(ts, nowMs) : "";
    let userText = rawUser;
    if (isAutonomous) {
      userText = clock
        ? `[${clock} · 你自己主动发给用户的消息，用户当时还没回]`
        : "[刚才 · 你自己主动发给用户的消息]";
    } else if (userText !== "" && ts > 0) {
      const needMarker = (prevTs === 0 && (nowMs - ts) >= gapMs) || (prevTs > 0 && (ts - prevTs) >= gapMs);
      if (needMarker) {
        userText = `[${clock}] ${userText}`;
      }
    }
    out.push({ userText, assistantText: rawReply, isAutonomous, ts });
    if (ts > 0) prevTs = ts;
  }
  return out;
}

/**
 * 14. Autonomy wake guard:
 * - Never intrude during an active live conversation (within 25 minutes of any user/assistant turn).
 * - Never double-text while waiting for user's reply within 6 hours.
 */
export function shouldAllowAutonomyWake({
  lastUserAt = 0,
  lastAssistantAt = 0,
  now = Date.now(),
  activeCooldownMs = 25 * 60000,
  selfDoubleTextCooldownMs = 6 * 3600000,
} = {}) {
  const nowMs = Number(now) || Date.now();
  const uAt = Number(lastUserAt) || 0;
  const aAt = Number(lastAssistantAt) || 0;
  const lastChatAt = Math.max(uAt, aAt);
  if (lastChatAt > 0 && nowMs - lastChatAt < activeCooldownMs) {
    return { allow: false, reason: "active-chat-cooldown" };
  }
  if (aAt > uAt && nowMs - aAt < selfDoubleTextCooldownMs) {
    return { allow: false, reason: "awaiting-user-reply" };
  }
  return { allow: true, reason: "ok" };
}

function formatGapMinutesCn(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} 小时` : `${h} 小时 ${rem} 分钟`;
}

function periodOfHourCn(hour) {
  if (hour < 5) return "凌晨";
  if (hour < 9) return "早上";
  if (hour < 12) return "上午";
  if (hour < 14) return "中午";
  if (hour < 18) return "下午";
  if (hour < 20) return "傍晚";
  if (hour < 23) return "晚上";
  return "深夜";
}

/**
 * 15. Realtime Timeline Anchor (prevents continuing stale 20m-45m+ old activities as if no time passed).
 * Grounded strictly on actual elapsed wall-clock minutes since the last real conversation turn.
 */
export function buildRealtimeTimelineAnchor({ rawHistoryRows = [], now = Date.now(), currentUserText = "" } = {}) {
  const nowMs = Number(now) || Date.now();
  const dNow = new Date(nowMs);
  const nowClock = `${String(dNow.getHours()).padStart(2, "0")}:${String(dNow.getMinutes()).padStart(2, "0")}`;
  const period = periodOfHourCn(dNow.getHours());

  const validRows = (Array.isArray(rawHistoryRows) ? rawHistoryRows : [])
    .filter((r) => r && Number(r.ts ?? 0) > 0 && String(r.text ?? "").trim() !== "" && !/^\[?不发\]?$/.test(String(r.text ?? "").trim()));
  if (validRows.length === 0) {
    return { gapMinutes: 0, crossedSession: false, historyDivider: "", timelinePrompt: `【现实时间】现在是 ${nowClock}（${period}）。` };
  }

  const lastRow = validRows[validRows.length - 1];
  const lastTs = Number(lastRow.ts);
  const gapMs = Math.max(0, nowMs - lastTs);
  const gapMinutes = Math.round(gapMs / 60000);
  const lastClock = formatHistoryClockLabel(lastTs, nowMs);

  // Also detect if there was an earlier >= 20m gap inside recent history (e.g., gym 45m ago, then user switched to new topic 5m ago)
  let hasRecentOlderActivity = false;
  for (let i = validRows.length - 1; i >= 1; i -= 1) {
    const dt = Number(validRows[i].ts) - Number(validRows[i - 1].ts);
    if (dt >= 20 * 60000 && nowMs - Number(validRows[i - 1].ts) >= 20 * 60000) {
      hasRecentOlderActivity = true;
      break;
    }
  }

  if (gapMinutes >= 20) {
    const gapLabel = formatGapMinutesCn(gapMinutes);
    return {
      gapMinutes,
      crossedSession: true,
      historyDivider: `[时间分隔线：以上对话停在 ${lastClock}；现实中已经过去 ${gapLabel}，直到现在 ${nowClock} 用户才重新发来消息]`,
      timelinePrompt: `【现实时间轴 · 已隔 ${gapLabel}】现在是 ${nowClock}（${period}），距上一轮（${lastClock}）已过去 ${gapLabel}。现实世界时间在流动：几十分钟前提到要去做的事（如去健身、练腿、吃饭、出门、洗澡等）很可能早已结束或切换了场景；如果用户现在没主动提，绝不要假设他还停留在那件事里继续追问，自然顺着眼前新话聊！`,
    };
  }

  if (gapMinutes >= 8) {
    return {
      gapMinutes,
      crossedSession: false,
      historyDivider: "",
      timelinePrompt: `【现实时间】现在是 ${nowClock}（${period}），距上一句已过约 ${gapMinutes} 分钟，顺着用户此刻说的话自然聊。`,
    };
  }

  if (hasRecentOlderActivity) {
    const u = String(currentUserText ?? "");
    const mentionsOldActivity = /(健身|练腿|举铁|跑步|洗澡|吃饭|炒饭|腿软|腿抖)/.test(u);
    if (!mentionsOldActivity) {
      return {
        gapMinutes,
        crossedSession: false,
        historyDivider: "",
        timelinePrompt: `【话题与时间流转】现在是 ${nowClock}（${period}）。用户已经自然聊到当前新话题，绝不要再反复把几十分钟前的旧事（比如之前提过的健身/练腿/洗澡/吃饭）硬扯回来追问！`,
      };
    }
  }

  return {
    gapMinutes,
    crossedSession: false,
    historyDivider: "",
    timelinePrompt: `【现实时间】现在是 ${nowClock}（${period}）。`,
  };
}
