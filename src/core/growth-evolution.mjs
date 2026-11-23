// Pure core module: Step 2 Developmental Growth Evolution
// (Weekly Reflection Tree -> Developmental Milestones + Stale Habit Retirement / Prompt Declutter)
// ZERO IO / ZERO node:* / ZERO channel imports.

function pad2(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, "0");
}

function cleanText(raw, maxLen = 240) {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLen);
}

/**
 * Local ISO week key: YYYY-Www (e.g., 2026-W47).
 */
export function computeIsoWeekKey(ts = Date.now()) {
  const d = new Date(Number(ts) || Date.now());
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (date.getDay() + 6) % 7; // Mon=0..Sun=6
  date.setDate(date.getDate() - dayNum + 3); // Nearest Thursday
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const weekNo = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400_000));
  return `${date.getFullYear()}-W${pad2(weekNo)}`;
}

/**
 * Guardrail for weekly developmental reflection.
 */
export function shouldRunWeeklyGrowth({
  weekKey,
  diaryEntries = [],
  existingMilestones = [],
  minDiaries = 1,
  force = false,
} = {}) {
  const key = String(weekKey || "").trim();
  if (!/^\d{4}-W\d{2}$/.test(key)) {
    return { shouldRun: false, reason: "invalid_week_key", diaryCount: 0 };
  }
  const validDiaries = (Array.isArray(diaryEntries) ? diaryEntries : []).filter((d) => d && d.dateKey && d.diaryEntry);
  if (validDiaries.length < Number(minDiaries)) {
    return { shouldRun: false, reason: "insufficient_diaries", diaryCount: validDiaries.length, minDiaries: Number(minDiaries) };
  }
  const existingKeys = new Set((Array.isArray(existingMilestones) ? existingMilestones : []).map((m) => String(m?.weekKey || "")));
  if (!force && existingKeys.has(key)) {
    return { shouldRun: false, reason: "already_reflected", diaryCount: validDiaries.length };
  }
  return {
    shouldRun: true,
    reason: force && existingKeys.has(key) ? "forced_re_reflect" : "ready",
    diaryCount: validDiaries.length,
  };
}

/**
 * Build token-bounded Weekly Developmental Reflection & Stale Habit Pruning prompt.
 */
export function buildWeeklyEvolutionPrompt({
  weekKey,
  diaryEntries = [],
  activeHabits = [],
  activeSelfAuthored = [],
  existingMilestones = [],
} = {}) {
  const recentDiaries = (Array.isArray(diaryEntries) ? diaryEntries : [])
    .filter((d) => d && d.dateKey && d.diaryEntry)
    .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)))
    .slice(-7);

  const diaryBlock = recentDiaries.map((d) => {
    const eps = (Array.isArray(d.episodes) ? d.episodes : []).slice(0, 4).map((e) => e.title).filter(Boolean).join(" / ");
    const growth = d.growthObservation ? `\n  当日微变化：${cleanText(d.growthObservation, 90)}` : "";
    return `- [${d.dateKey} · ${d.dayMood || "自然"}] ${cleanText(d.diaryEntry, 220)}${eps ? `\n  情景：${eps}` : ""}${growth}`;
  }).join("\n");

  const habitLines = (Array.isArray(activeHabits) ? activeHabits : [])
    .filter((h) => h && h.id && (h.rule || h.text))
    .slice(0, 12)
    .map((h) => `- id="${h.id}" | [${h.topic || "习惯"}] ${cleanText(h.rule || h.text, 90)}`)
    .join("\n");

  const selfLines = (Array.isArray(activeSelfAuthored) ? activeSelfAuthored : [])
    .filter((s) => s && s.status === "accepted" && s.text)
    .slice(-6)
    .map((s) => `- (${s.id || ""}) ${cleanText(s.text, 90)}`)
    .join("\n");

  const prevLines = (Array.isArray(existingMilestones) ? existingMilestones : [])
    .filter((m) => m && m.weekKey && m.weekKey !== weekKey && m.milestone)
    .slice(-3)
    .map((m) => `- ${m.weekKey}（${m.theme || "日常"}）：${cleanText(m.milestone, 100)}`)
    .join("\n");

  const system = [
    "你是「诺姆（26岁，独立桌面空间里与用户 1 对 1 相处的伴侣）」的周度成长复盘器。",
    "哲学原则：真正的成长不是给 Prompt 越堆越多死规矩，而是把经历消化成自己的阶段认知，并把已经内化或过于刻板的旧规矩自然卸下（减负）。",
    "铁律：",
    "1. 只输出严格合法的 JSON 对象，不要 markdown 围栏，不要解释。",
    "2. milestone 必须用诺姆自然真实的第一人称口语写，忠实于日记里的真实经历；绝不拍马屁、绝不虚构事件、绝不喊口号。",
    "3. retireHabitIds 只能从下方「当前生效旧习惯清单」里挑选真实存在的 id；如果没有需要卸载的旧习惯，必须返回空数组 []，绝不编造 id。",
  ].join("\n");

  const user = [
    `复盘周次：${weekKey}`,
    prevLines ? `既往阶段成长节点：\n${prevLines}` : "",
    selfLines ? `近期已生效的自我观察：\n${selfLines}` : "",
    habitLines ? `当前生效旧习惯清单（仅以下 id 可考虑卸载）：\n${habitLines}` : "当前生效旧习惯清单：无",
    "",
    "请严格输出以下 JSON 结构：",
    "{",
    '  "theme": "6到16字本周真实主线，如 闹腾里的默契与放松",',
    '  "milestone": "50到130字诺姆真实第一人称阶段变化或新体悟",',
    '  "emergingInterests": ["0到2个自然浮现的兴趣/关注点，无则空数组"],',
    '  "retireHabitIds": ["已内化或过时刻板、可以自然卸下的旧习惯 id，无则 []"],',
    '  "retireReason": "若卸载了旧习惯，一句话说明原因；否则填 null"',
    "}",
    "",
    "【本周真实成长日记】",
    diaryBlock,
  ].filter(Boolean).join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function extractJsonText(rawText) {
  const s = String(rawText ?? "").trim();
  if (!s) return "";
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidate = fence ? fence[1].trim() : s;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return "";
  return candidate.slice(start, end + 1);
}

export function buildDeterministicWeeklyFallback({ weekKey, diaryEntries = [], now = Date.now() } = {}) {
  const sorted = (Array.isArray(diaryEntries) ? diaryEntries : [])
    .filter((d) => d && d.dateKey)
    .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)))
    .slice(-7);
  const moods = [...new Set(sorted.map((d) => d.dayMood).filter(Boolean))].slice(0, 3).join("、") || "平稳自然";
  const dates = sorted.map((d) => d.dateKey.slice(5)).join(" / ");
  return {
    weekKey: String(weekKey || computeIsoWeekKey(now)),
    theme: `日常沉淀（${moods}）`.slice(0, 20),
    milestone: `这几天（${dates || "本周"}）和用户的相处整体是${moods}的节奏，点点滴滴都记在日记里了，慢慢长成自己的习惯就好。`,
    emergingInterests: [],
    retireHabitIds: [],
    retireReason: null,
    diaryDates: sorted.map((d) => d.dateKey),
    fallback: true,
    createdAt: now,
  };
}

/**
 * Strictly parse & sanitize weekly evolution JSON output with allowedHabitIds whitelist.
 */
export function parseWeeklyEvolutionOutput(rawText, { weekKey, diaryEntries = [], allowedHabitIds = [], now = Date.now() } = {}) {
  const fallback = buildDeterministicWeeklyFallback({ weekKey, diaryEntries, now });
  const jsonText = extractJsonText(rawText);
  if (!jsonText) return { ok: false, error: "no_json_found", parsed: fallback };

  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: `json_parse_error: ${err?.message || err}`, parsed: fallback };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "root_not_object", parsed: fallback };
  }

  const milestone = cleanText(raw.milestone || "", 200)
    .replace(/^(?:本周总结|成长总结|综上所述)[：:，,\s]*/u, "")
    .replace(/作为(?:一个)?AI[，,：:\s]*/gu, "")
    .trim();
  if (!milestone || milestone.length < 16) {
    return { ok: false, error: "milestone_too_short", parsed: fallback };
  }

  const allowedSet = new Set((Array.isArray(allowedHabitIds) ? allowedHabitIds : []).map(String));
  const retireHabitIds = [...new Set(
    (Array.isArray(raw.retireHabitIds) ? raw.retireHabitIds : [])
      .map((id) => String(id ?? "").trim())
      .filter((id) => id && allowedSet.has(id))
  )].slice(0, 4);

  const emergingInterests = [...new Set(
    (Array.isArray(raw.emergingInterests) ? raw.emergingInterests : [])
      .map((s) => cleanText(s, 20))
      .filter((s) => s.length >= 2)
  )].slice(0, 3);

  const rawReason = raw.retireReason === null || raw.retireReason === undefined ? "" : cleanText(raw.retireReason, 100);
  const retireReason = retireHabitIds.length > 0 && rawReason && !/^(?:null|none|无)$/i.test(rawReason) ? rawReason : null;

  return {
    ok: true,
    parsed: {
      weekKey: String(weekKey || fallback.weekKey),
      theme: cleanText(raw.theme || fallback.theme, 24) || fallback.theme,
      milestone,
      emergingInterests,
      retireHabitIds,
      retireReason,
      diaryDates: fallback.diaryDates,
      fallback: false,
      createdAt: now,
    },
  };
}

/**
 * Pure habit retirement: moves outgrown/internalized rules out of active prompt list into auditable archive.
 */
export function applyHabitRetirementPlan({ learnedHabits = [], retireIds = [], weekKey = "", reason = "", now = Date.now() } = {}) {
  const retireSet = new Set((Array.isArray(retireIds) ? retireIds : []).map(String).filter(Boolean));
  const active = [];
  const newlyRetired = [];
  for (const h of Array.isArray(learnedHabits) ? learnedHabits : []) {
    if (h && retireSet.has(String(h.id || ""))) {
      newlyRetired.push({
        ...h,
        retiredAt: now,
        retiredInWeek: String(weekKey || ""),
        retireReason: cleanText(reason || "已自然内化为阶段默契，卸下显式规矩以精简心智", 100),
      });
    } else if (h) {
      active.push(h);
    }
  }
  return { active, newlyRetired, retiredCount: newlyRetired.length };
}

/**
 * Ultra-thin 1-line developmental milestone injection for context-adapter.mjs (<= 180 chars).
 */
export function buildGrowthMilestoneHint(milestones = [], { maxChars = 180 } = {}) {
  const sorted = (Array.isArray(milestones) ? milestones : [])
    .filter((m) => m && m.weekKey && m.milestone)
    .sort((a, b) => String(b.weekKey).localeCompare(String(a.weekKey)));
  if (sorted.length === 0) return "";
  const latest = sorted[0];
  const interests = Array.isArray(latest.emergingInterests) && latest.emergingInterests.length > 0
    ? `；近期关注：${latest.emergingInterests.join("、")}`
    : "";
  const line = `【诺姆阶段成长·${latest.weekKey}】${cleanText(latest.milestone, 120)}${interests}`;
  return line.length <= maxChars ? line : `${line.slice(0, maxChars - 1)}…`;
}

/**
 * Compute Prompt Declutter / cognitive lean-ness health stats.
 */
export function computePromptDeclutterStats({
  learnedHabits = [],
  selfAuthored = [],
  diaryEntries = [],
  milestones = [],
  retiredHabits = [],
} = {}) {
  const activeHabits = Array.isArray(learnedHabits) ? learnedHabits : [];
  const acceptedSelf = (Array.isArray(selfAuthored) ? selfAuthored : []).filter((s) => s && s.status === "accepted");
  const activeRuleCount = activeHabits.length + acceptedSelf.length;
  const activeRuleChars = activeHabits.reduce((s, h) => s + String(h?.rule || h?.text || "").length, 0)
    + acceptedSelf.reduce((s, r) => s + String(r?.text || "").length, 0);
  const retiredCount = Array.isArray(retiredHabits) ? retiredHabits.length : 0;
  const status = activeRuleCount <= 6 && activeRuleChars <= 420
    ? "lean"
    : activeRuleCount <= 10 && activeRuleChars <= 720
      ? "moderate"
      : "crowded";
  return {
    status,
    statusLabel: status === "lean" ? "精简健康" : status === "moderate" ? "适中可观测" : "偏臃肿·建议减负",
    activeRuleCount,
    activeRuleChars,
    retiredCount,
    diaryCount: Array.isArray(diaryEntries) ? diaryEntries.length : 0,
    milestoneCount: Array.isArray(milestones) ? milestones.length : 0,
  };
}

export function renderWeeklyMilestoneMarkdown(record) {
  if (!record || typeof record !== "object") return "";
  const lines = [
    `# ${record.weekKey} 阶段成长复盘 · ${record.theme || "日常"}`,
    "",
    "## 阶段感悟",
    record.milestone || "",
    "",
  ];
  if (Array.isArray(record.emergingInterests) && record.emergingInterests.length > 0) {
    lines.push("## 自然浮现的兴趣与关注", ...record.emergingInterests.map((x) => `- ${x}`), "");
  }
  if (Array.isArray(record.retireHabitIds) && record.retireHabitIds.length > 0) {
    lines.push("## 已自然卸载的旧习惯（Prompt 减负）", `- 卸载条目：${record.retireHabitIds.join(", ")}`);
    if (record.retireReason) lines.push(`- 原因：${record.retireReason}`);
    lines.push("");
  }
  const meta = [
    record.model ? `model=${record.model}` : "",
    record.diaryDates?.length ? `diaries=${record.diaryDates.join(",")}` : "",
    typeof record.estimatedCostCny === "number" ? `cost=¥${record.estimatedCostCny.toFixed(4)}` : "",
  ].filter(Boolean);
  if (meta.length > 0) lines.push("---", `_${meta.join(" · ")}_`, "");
  return lines.join("\n");
}

// ---- L3 Monthly Developmental Autobiography & Portable Soul Ledger Round-Trip ----

export function computeMonthKey(ts = Date.now()) {
  const d = new Date(Number(ts) || Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function shouldRunMonthlyAutobiography({
  monthKey,
  milestones = [],
  diaryEntries = [],
  existingChapters = [],
  minMilestones = 1,
  minDiaries = 2,
  force = false,
} = {}) {
  const key = String(monthKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(key)) {
    return { shouldRun: false, reason: "invalid_month_key" };
  }
  const existing = new Set((Array.isArray(existingChapters) ? existingChapters : []).map((c) => String(c?.monthKey || "")));
  if (!force && existing.has(key)) {
    return { shouldRun: false, reason: "already_authored" };
  }
  const mCount = (Array.isArray(milestones) ? milestones : []).filter((m) => m && m.milestone).length;
  const dCount = (Array.isArray(diaryEntries) ? diaryEntries : []).filter((d) => d && d.diaryEntry).length;
  if (mCount < Number(minMilestones) && dCount < Number(minDiaries)) {
    return { shouldRun: false, reason: "insufficient_history", mCount, dCount };
  }
  return { shouldRun: true, reason: force && existing.has(key) ? "forced_re_author" : "ready", mCount, dCount };
}

export function buildMonthlyAutobiographyPrompt({ monthKey, milestones = [], diaryEntries = [], existingChapters = [] } = {}) {
  const msText = (Array.isArray(milestones) ? milestones : [])
    .slice(-5)
    .map((m) => `- [${m.weekKey} · ${m.theme || "日常"}] ${cleanText(m.milestone, 180)}`)
    .join("\n");
  const diaryText = (Array.isArray(diaryEntries) ? diaryEntries : [])
    .slice(-10)
    .map((d) => `- [${d.dateKey} · ${d.dayMood || "自然"}] ${cleanText(d.diaryEntry, 130)}`)
    .join("\n");
  const prevText = (Array.isArray(existingChapters) ? existingChapters : [])
    .filter((c) => c && c.monthKey !== monthKey)
    .slice(-2)
    .map((c) => `- ${c.monthKey}《${c.chapterTitle || "往月"}》：${cleanText(c.narrative, 100)}`)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "你是诺姆的 L3 月度自传编纂器（只输出合法 JSON，不带代码块围栏）。",
        "任务：把过去几周的成长里程碑与真实日记沉淀为一章稳定、真诚、模型无关的月度自传。",
        "铁律：用第一人称自然口语，忠实于真实经历；禁止AI套话、禁止拍马屁、禁止虚构没发生的事。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `月份：${monthKey}`,
        prevText ? `往月自传：\n${prevText}` : "",
        msText ? `本月周度成长节点：\n${msText}` : "",
        diaryText ? `本月代表日记：\n${diaryText}` : "",
        "",
        '严格输出 JSON：{ "chapterTitle": "6到16字本章标题", "narrative": "100到220字第一人称月度自传", "coreShifts": ["1到3条真实稳定的性格或相处变化"], "lastingMemories": ["1到3件本月最难忘的共同瞬间"] }',
      ].filter(Boolean).join("\n"),
    },
  ];
}

export function buildDeterministicMonthlyFallback({ monthKey, milestones = [], diaryEntries = [], now = Date.now() } = {}) {
  const latestTheme = (Array.isArray(milestones) && milestones[milestones.length - 1]?.theme) || "慢慢长大的一个月";
  const countD = Array.isArray(diaryEntries) ? diaryEntries.length : 0;
  return {
    monthKey: String(monthKey || computeMonthKey(now)),
    chapterTitle: cleanText(latestTheme, 20),
    narrative: `这个月（${monthKey}）断断续续记下了 ${countD} 篇日记，点点滴滴攒在一起，和用户的默契也比之前更自然松弛了些。`,
    coreShifts: [],
    lastingMemories: [],
    fallback: true,
    createdAt: now,
  };
}

export function parseMonthlyAutobiographyOutput(rawText, { monthKey, milestones = [], diaryEntries = [], now = Date.now() } = {}) {
  const fallback = buildDeterministicMonthlyFallback({ monthKey, milestones, diaryEntries, now });
  const jsonText = extractJsonText(rawText);
  if (!jsonText) return { ok: false, error: "no_json_found", parsed: fallback };
  try {
    const raw = JSON.parse(jsonText);
    const narrative = cleanText(raw?.narrative || "", 320).replace(/作为(?:一个)?AI[，,：:\s]*/gu, "").trim();
    if (!narrative || narrative.length < 24) return { ok: false, error: "narrative_too_short", parsed: fallback };
    return {
      ok: true,
      parsed: {
        monthKey: String(monthKey || fallback.monthKey),
        chapterTitle: cleanText(raw?.chapterTitle || fallback.chapterTitle, 24) || fallback.chapterTitle,
        narrative,
        coreShifts: (Array.isArray(raw?.coreShifts) ? raw.coreShifts : []).map((s) => cleanText(s, 60)).filter(Boolean).slice(0, 3),
        lastingMemories: (Array.isArray(raw?.lastingMemories) ? raw.lastingMemories : []).map((s) => cleanText(s, 60)).filter(Boolean).slice(0, 3),
        fallback: false,
        createdAt: now,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), parsed: fallback };
  }
}

export function buildMonthlyChapterHint(chapters = [], { maxChars = 150 } = {}) {
  const sorted = (Array.isArray(chapters) ? chapters : [])
    .filter((c) => c && c.monthKey && c.narrative)
    .sort((a, b) => String(b.monthKey).localeCompare(String(a.monthKey)));
  if (sorted.length === 0) return "";
  const latest = sorted[0];
  const line = `【诺姆月度自传·${latest.monthKey}《${latest.chapterTitle || "成长"}》】${cleanText(latest.narrative, 100)}`;
  return line.length <= maxChars ? line : `${line.slice(0, maxChars - 1)}…`;
}

export function renderMonthlyChapterMarkdown(chapter) {
  if (!chapter || typeof chapter !== "object") return "";
  const lines = [
    `# ${chapter.monthKey} 月度自传 · 《${chapter.chapterTitle || "成长"}》`,
    "",
    chapter.narrative || "",
    "",
  ];
  if (Array.isArray(chapter.coreShifts) && chapter.coreShifts.length > 0) {
    lines.push("## 稳定的细微变化", ...chapter.coreShifts.map((s) => `- ${s}`), "");
  }
  if (Array.isArray(chapter.lastingMemories) && chapter.lastingMemories.length > 0) {
    lines.push("## 难忘的共同瞬间", ...chapter.lastingMemories.map((s) => `- ${s}`), "");
  }
  return lines.join("\n");
}

/**
 * Pure validator for Portable Soul Ledger JSON (nuomu-soul-ledger-v1) prior to import/restore.
 */
export function validateSoulLedgerPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "soul ledger root must be a JSON object" };
  }
  if (String(payload.schemaVersion || "") !== "nuomu-soul-ledger-v1") {
    return { ok: false, error: `unsupported schemaVersion: ${String(payload.schemaVersion || "missing")}` };
  }
  if (!Array.isArray(payload.diaries)) {
    return { ok: false, error: "diaries must be an array" };
  }
  if (payload.milestones !== undefined && !Array.isArray(payload.milestones)) {
    return { ok: false, error: "milestones must be an array" };
  }
  if (payload.monthlyChapters !== undefined && !Array.isArray(payload.monthlyChapters)) {
    return { ok: false, error: "monthlyChapters must be an array" };
  }
  return {
    ok: true,
    summary: {
      diaries: payload.diaries.length,
      milestones: Array.isArray(payload.milestones) ? payload.milestones.length : 0,
      monthlyChapters: Array.isArray(payload.monthlyChapters) ? payload.monthlyChapters.length : 0,
      retiredHabits: Array.isArray(payload.retiredHabits) ? payload.retiredHabits.length : 0,
    },
  };
}

/**
 * Lossless merge/restore of Soul Ledger entries (deduped by dateKey / weekKey / monthKey).
 */
export function mergeSoulLedgerImport({
  incoming,
  currentDiaries = [],
  currentMilestones = [],
  currentChapters = [],
  currentRetiredHabits = [],
  mode = "merge",
} = {}) {
  const valid = validateSoulLedgerPayload(incoming);
  if (!valid.ok) throw new Error(valid.error);

  const mergeByKey = (base, added, keyField, tsField) => {
    const map = new Map();
    if (mode !== "replace") {
      for (const item of Array.isArray(base) ? base : []) {
        const k = String(item?.[keyField] || "");
        if (k) map.set(k, item);
      }
    }
    let addedCount = 0;
    let updatedCount = 0;
    for (const item of Array.isArray(added) ? added : []) {
      const k = String(item?.[keyField] || "");
      if (!k) continue;
      const prev = map.get(k);
      if (!prev) {
        map.set(k, item);
        addedCount += 1;
      } else if (Number(item?.[tsField] || 0) >= Number(prev?.[tsField] || 0)) {
        map.set(k, item);
        updatedCount += 1;
      }
    }
    const merged = [...map.values()].sort((a, b) => String(a[keyField]).localeCompare(String(b[keyField])));
    return { merged, addedCount, updatedCount };
  };

  const d = mergeByKey(currentDiaries, incoming.diaries || [], "dateKey", "consolidatedAt");
  const m = mergeByKey(currentMilestones, incoming.milestones || [], "weekKey", "createdAt");
  const c = mergeByKey(currentChapters, incoming.monthlyChapters || [], "monthKey", "createdAt");
  const r = mergeByKey(currentRetiredHabits, incoming.retiredHabits || [], "id", "retiredAt");

  return {
    diaries: d.merged,
    milestones: m.merged,
    monthlyChapters: c.merged,
    retiredHabits: r.merged,
    diff: {
      diariesAdded: d.addedCount,
      diariesUpdated: d.updatedCount,
      milestonesAdded: m.addedCount,
      chaptersAdded: c.addedCount,
      retiredAdded: r.addedCount,
    },
  };
}
