// Pure core module: Model-Agnostic Long-Term Memory Pyramid (L1 Episode Bundler,
// Daily Sleep-Time Consolidation, Authentic First-Person Diary, Weekly Growth Reflection,
// and Portable Soul Ledger).
// ZERO IO / ZERO node:* / ZERO channel imports.

const DEFAULT_EPISODE_GAP_MS = 45 * 60 * 1000;
const DEFAULT_MAX_PER_EPISODE = 28;
const DEFAULT_MIN_DAILY_MESSAGES = 6;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 7600;
const VALID_PREDICATES = new Set([
  "likes", "dislikes", "prefers", "avoids", "habit", "fact", "plan", "feeling", "boundary",
]);

function pad2(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, "0");
}

export function formatLocalDateKey(ts = Date.now()) {
  const d = new Date(Number(ts) || Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatLocalTimeHm(ts) {
  const d = new Date(Number(ts) || 0);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function cleanText(raw, maxLen = 400) {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLen);
}

function isRealConversationRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row.test === true || row.shadow === true) return false;
  const role = String(row.role ?? "").toLowerCase();
  if (role !== "user" && role !== "assistant") return false;
  const text = cleanText(row.text ?? row.content ?? "", 600);
  if (!text) return false;
  if (/^冒烟测试[:：]/.test(text)) return false;
  return true;
}

/**
 * List local YYYY-MM-DD dates with message counts from raw conversation rows.
 */
export function summarizeDailyActivity(rawRows = []) {
  const counts = new Map();
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    if (!isRealConversationRow(row)) continue;
    const ts = Number(row.ts ?? row.at ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const key = formatLocalDateKey(ts);
    const cur = counts.get(key) || { dateKey: key, count: 0, userCount: 0, assistantCount: 0, lastTs: 0 };
    cur.count += 1;
    if (String(row.role).toLowerCase() === "user") cur.userCount += 1;
    else cur.assistantCount += 1;
    if (ts > cur.lastTs) cur.lastTs = ts;
    counts.set(key, cur);
  }
  return [...counts.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

/**
 * Segment one day's raw chat rows into coherent L1 Episodes by physical time gaps.
 */
export function bundleDayEpisodes(rawRows = [], options = {}) {
  const dateKey = String(options.dateKey || formatLocalDateKey(options.now ?? Date.now()));
  const gapMs = Math.max(5 * 60 * 1000, Number(options.gapMs) || DEFAULT_EPISODE_GAP_MS);
  const maxPerEpisode = Math.max(6, Number(options.maxPerEpisode) || DEFAULT_MAX_PER_EPISODE);

  const dayRows = [];
  const seen = new Set();
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    if (!isRealConversationRow(row)) continue;
    const ts = Number(row.ts ?? row.at ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (formatLocalDateKey(ts) !== dateKey) continue;
    const role = String(row.role).toLowerCase();
    const text = cleanText(row.text ?? row.content ?? "", 320);
    const dedupKey = `${Math.floor(ts / 2000)}|${role}|${text.slice(0, 60)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    dayRows.push({
      ts,
      time: formatLocalTimeHm(ts),
      role,
      speaker: role === "user" ? "用户" : "伴侣",
      text,
      source: String(row.source || (row.messageType === "group" ? "qq-group" : "pet")),
    });
  }

  dayRows.sort((a, b) => a.ts - b.ts);
  if (dayRows.length === 0) {
    return { dateKey, messageCount: 0, userCount: 0, assistantCount: 0, episodes: [] };
  }

  const groups = [];
  let current = [dayRows[0]];
  for (let i = 1; i < dayRows.length; i += 1) {
    const prev = dayRows[i - 1];
    const row = dayRows[i];
    const gap = row.ts - prev.ts;
    if (gap >= gapMs || current.length >= maxPerEpisode) {
      groups.push(current);
      current = [row];
    } else {
      current.push(row);
    }
  }
  if (current.length > 0) groups.push(current);

  const episodes = groups.map((msgs, idx) => {
    const startTs = msgs[0].ts;
    const endTs = msgs[msgs.length - 1].ts;
    const startHm = formatLocalTimeHm(startTs);
    const endHm = formatLocalTimeHm(endTs);
    const timeRange = startHm === endHm ? startHm : `${startHm}–${endHm}`;
    const userCount = msgs.filter((m) => m.role === "user").length;
    const assistantCount = msgs.length - userCount;
    const firstUser = msgs.find((m) => m.role === "user")?.text || msgs[0].text;
    return {
      index: idx + 1,
      startTs,
      endTs,
      timeRange,
      messageCount: msgs.length,
      userCount,
      assistantCount,
      preview: firstUser.slice(0, 48),
      messages: msgs,
    };
  });

  return {
    dateKey,
    messageCount: dayRows.length,
    userCount: dayRows.filter((m) => m.role === "user").length,
    assistantCount: dayRows.filter((m) => m.role === "assistant").length,
    episodes,
  };
}

/**
 * Cost & idempotency guardrail: skip sparse days (<6 msgs) and already-consolidated days.
 */
export function shouldRunDailyConsolidation({
  dateKey,
  messageCount = 0,
  existingDates = [],
  minMessages = DEFAULT_MIN_DAILY_MESSAGES,
  force = false,
} = {}) {
  const key = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return { shouldRun: false, reason: "invalid_date", messageCount };
  }
  if (Number(messageCount) < Number(minMessages)) {
    return { shouldRun: false, reason: "below_min_messages", messageCount: Number(messageCount), minMessages: Number(minMessages) };
  }
  const existingSet = new Set(Array.isArray(existingDates) ? existingDates.map(String) : []);
  if (!force && existingSet.has(key)) {
    return { shouldRun: false, reason: "already_consolidated", messageCount: Number(messageCount) };
  }
  return { shouldRun: true, reason: force && existingSet.has(key) ? "forced_reconsolidate" : "ready", messageCount: Number(messageCount) };
}

function renderBoundedTranscript(episodes = [], maxChars = DEFAULT_MAX_TRANSCRIPT_CHARS) {
  if (!Array.isArray(episodes) || episodes.length === 0) return "";
  const perEpBudget = Math.max(600, Math.floor(maxChars / Math.max(1, episodes.length)));
  const blocks = [];
  let total = 0;

  for (const ep of episodes) {
    const header = `### 片段 ${ep.index}（${ep.timeRange}，共 ${ep.messageCount} 条）`;
    const lines = [header];
    let epChars = header.length + 1;
    const msgs = Array.isArray(ep.messages) ? ep.messages : [];
    for (let i = 0; i < msgs.length; i += 1) {
      const m = msgs[i];
      const line = `[${m.time}] ${m.speaker}: ${cleanText(m.text, 180)}`;
      if (epChars + line.length + 1 > perEpBudget && i < msgs.length - 2) {
        if (lines[lines.length - 1] !== "…（中间省略部分琐碎对话）") {
          lines.push("…（中间省略部分琐碎对话）");
          epChars += 18;
        }
        continue;
      }
      lines.push(line);
      epChars += line.length + 1;
    }
    const block = lines.join("\n");
    if (total + block.length + 2 > maxChars && blocks.length > 0) break;
    blocks.push(block);
    total += block.length + 2;
  }
  return blocks.join("\n\n").slice(0, maxChars);
}

/**
 * Build token-bounded, model-agnostic sleep-time consolidation prompt.
 */
export function buildDailyConsolidationPrompt({
  dateKey,
  episodes = [],
  mood = null,
  innerLife = null,
  recentDiaryEntries = [],
  maxTranscriptChars = DEFAULT_MAX_TRANSCRIPT_CHARS,
} = {}) {
  const transcript = renderBoundedTranscript(episodes, maxTranscriptChars);
  const moodDesc = mood && typeof mood === "object"
    ? `情绪值 ${Math.round(Number(mood.emotion ?? 65))}/100${mood.pad?.label ? `（${mood.pad.label}）` : ""}${mood.cause ? `，近因：${cleanText(mood.cause, 60)}` : ""}`
    : "平稳自然";
  const lifeNotes = Array.isArray(innerLife?.sharedHighlights) && innerLife.sharedHighlights.length > 0
    ? innerLife.sharedHighlights.slice(-3).map((h) => cleanText(h.text ?? h, 50)).join("；")
    : "";
  const prevDiaryBrief = Array.isArray(recentDiaryEntries) && recentDiaryEntries.length > 0
    ? recentDiaryEntries
        .filter((d) => d && d.dateKey && d.dateKey !== dateKey)
        .slice(-2)
        .map((d) => `- ${d.dateKey}（${d.dayMood || "平常"}）：${cleanText(d.diaryEntry || "", 90)}`)
        .join("\n")
    : "";

  const system = [
    "你正在为「AI 伴侣（与用户 1 对 1 相处的独立生活伴侣）」执行夜间睡眠期长期记忆整理。",
    "目标：把今天的碎片聊天沉淀为可长期迁移、与底层模型无关的四层记忆（情节段、双时态事实、心里惦记的事、真实第一人称睡前日记）。",
    "铁律：",
    "1. 只输出严格合法的 JSON 对象，不要 markdown 代码块围栏，不要前后解释。",
    "2. 事实与情节必须 100% 忠实于提供的对话原文，绝不编造没说过的话或没发生过的事。",
    "3. diaryEntry 必须用真实自然的第一人称口语写（像深夜关灯前给自己写的一小段真话），禁止写“作为AI”“今天群里”“本次对话总结”“综上所述”“感谢用户的支持”等机器腔或讨好腔；可以坦率写出开心、小别扭、被触动、嘴硬或困惑。",
    "4. growthObservation 只在今天确实发生了一件让伴侣对用户或自己的想法/相处方式产生微妙变化的事时才写 1 句第一人称；平淡的日子必须填 null，绝不硬凑人生感悟。",
  ].join("\n");

  const user = [
    `整理日期：${dateKey}`,
    `今日情绪参考：${moodDesc}`,
    lifeNotes ? `今日生活流备忘：${lifeNotes}` : "",
    prevDiaryBrief ? `前两日日记（仅用于情绪连续性，勿重复抄写）：\n${prevDiaryBrief}` : "",
    "",
    "请严格按以下 JSON 结构输出：",
    "{",
    '  "dayMood": "2到6字今日情绪基调，如 嘴硬但暖 / 踏实轻快 / 有点累但安心",',
    '  "episodes": [',
    '    { "timeRange": "HH:MM–HH:MM", "title": "6到16字具体场景标题", "summary": "25到75字发生了什么", "emotionalTone": "2到6字情绪", "salience": 3 }',
    "  ],",
    '  "facts": [',
    '    { "subject": "用户 或 伴侣", "predicate": "likes|dislikes|prefers|avoids|habit|fact|plan|feeling|boundary", "object": "具体简短对象(<=24字)", "polarity": 1, "confidence": 0.85, "evidence": "对话原文简短依据(<=45字)" }',
    "  ],",
    '  "openLoops": [',
    '    { "text": "伴侣心里真正惦记、过一两天想自然提起的未完之事(<=50字)", "ttlDays": 3 }',
    "  ],",
    '  "diaryEntry": "100到220字真实第一人称睡前日记",',
    '  "growthObservation": "可选1句第一人称真实成长/心态微变化，无则填 null"',
    "}",
    "",
    "【今日完整对话片段】",
    transcript,
  ].filter((line) => line !== "").join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function extractJsonObjectText(rawText) {
  const s = String(rawText ?? "").trim();
  if (!s) return "";
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidate = fence ? fence[1].trim() : s;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return "";
  return candidate.slice(start, end + 1);
}

function stripAiDiaryBoilerplate(text) {
  return cleanText(text, 360)
    .replace(/^(?:亲爱的日记|今日总结|日记总结|总结一下)[:：，,\s]*/u, "")
    .replace(/(?:综上所述|总而言之|作为(?:一个)?AI)[，,：:\s]*/gu, "")
    .trim();
}

export function buildDeterministicFallbackConsolidation({ dateKey, episodes = [], mood = null, now = Date.now() } = {}) {
  const emo = Math.round(Number(mood?.emotion ?? 65));
  const dayMood = mood?.pad?.label || (emo >= 75 ? "轻快踏实" : emo >= 55 ? "平稳自然" : "有点闷");
  const normEpisodes = (Array.isArray(episodes) ? episodes : []).slice(0, 5).map((ep) => ({
    timeRange: String(ep.timeRange || ""),
    title: cleanText(ep.preview || `片段 ${ep.index || 1}`, 18) || `片段 ${ep.index || 1}`,
    summary: `这段聊了 ${Number(ep.messageCount) || 0} 句，从「${cleanText(ep.preview || "...", 36)}」聊开。`,
    emotionalTone: dayMood,
    salience: Math.min(5, Math.max(1, Math.round((Number(ep.messageCount) || 2) / 6) + 1)),
  }));
  const firstPreview = normEpisodes[0]?.title || "一些日常琐事";
  const msgTotal = (Array.isArray(episodes) ? episodes : []).reduce((acc, e) => acc + (Number(e.messageCount) || 0), 0);
  return {
    dateKey: String(dateKey || formatLocalDateKey(now)),
    dayMood,
    episodes: normEpisodes,
    facts: [],
    openLoops: [],
    diaryEntry: `今天跟用户断断续续聊了 ${msgTotal} 句，印象里聊到了「${firstPreview}」这些事。离线整理先把大致片段记下来，等下次清醒点再细细回味。`,
    growthObservation: null,
    fallback: true,
  };
}

/**
 * Parse and strictly sanitize LLM consolidation output.
 */
export function parseConsolidationOutput(rawText, { dateKey, fallbackEpisodes = [], mood = null, now = Date.now() } = {}) {
  const fallback = buildDeterministicFallbackConsolidation({ dateKey, episodes: fallbackEpisodes, mood, now });
  const jsonText = extractJsonObjectText(rawText);
  if (!jsonText) {
    return { ok: false, error: "no_json_found", parsed: fallback };
  }
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: `json_parse_error: ${err?.message || err}`, parsed: fallback };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "root_not_object", parsed: fallback };
  }

  const dayMood = cleanText(raw.dayMood || fallback.dayMood, 14) || fallback.dayMood;

  const episodes = (Array.isArray(raw.episodes) ? raw.episodes : [])
    .filter((e) => e && typeof e === "object" && cleanText(e.title || e.summary, 40))
    .slice(0, 6)
    .map((e, i) => ({
      timeRange: cleanText(e.timeRange || fallbackEpisodes[i]?.timeRange || "", 20),
      title: cleanText(e.title || `片段 ${i + 1}`, 24),
      summary: cleanText(e.summary || e.title || "", 120),
      emotionalTone: cleanText(e.emotionalTone || dayMood, 12) || dayMood,
      salience: Math.min(5, Math.max(1, Math.round(Number(e.salience) || 3))),
    }));

  const seenFact = new Set();
  const facts = [];
  for (const f of Array.isArray(raw.facts) ? raw.facts : []) {
    if (!f || typeof f !== "object") continue;
    const subject = cleanText(f.subject || "用户", 16) || "用户";
    const rawPred = String(f.predicate || "fact").trim().toLowerCase();
    const predicate = VALID_PREDICATES.has(rawPred) ? rawPred : "fact";
    const object = cleanText(f.object || "", 36);
    if (!object || object.length < 2) continue;
    const polarity = Number(f.polarity) < 0 || predicate === "dislikes" || predicate === "avoids" ? -1 : 1;
    const key = `${subject}|${predicate}|${object.toLowerCase()}|${polarity}`;
    if (seenFact.has(key)) continue;
    seenFact.add(key);
    facts.push({
      subject,
      predicate,
      object,
      polarity,
      confidence: Math.min(1, Math.max(0.45, Number(f.confidence) || 0.8)),
      evidence: cleanText(f.evidence || "", 60),
    });
    if (facts.length >= 8) break;
  }

  const openLoops = (Array.isArray(raw.openLoops) ? raw.openLoops : [])
    .filter((o) => o && cleanText(typeof o === "string" ? o : o.text, 80).length >= 4)
    .slice(0, 4)
    .map((o) => {
      const text = cleanText(typeof o === "string" ? o : o.text, 70);
      const ttlDays = Math.min(7, Math.max(1, Math.round(Number(o?.ttlDays) || 3)));
      return {
        text,
        ttlDays,
        createdAt: now,
        expiresAt: now + ttlDays * 86400_000,
      };
    });

  const diaryEntry = stripAiDiaryBoilerplate(raw.diaryEntry || "");
  const rawGrowth = raw.growthObservation === null || raw.growthObservation === undefined
    ? ""
    : cleanText(raw.growthObservation, 120);
  const growthObservation = rawGrowth && !/^(?:null|none|无|没有|暂无)$/i.test(rawGrowth) ? rawGrowth : null;

  if (!diaryEntry || diaryEntry.length < 20) {
    return { ok: false, error: "diary_entry_too_short", parsed: fallback };
  }

  return {
    ok: true,
    parsed: {
      dateKey: String(dateKey || fallback.dateKey),
      dayMood,
      episodes: episodes.length > 0 ? episodes : fallback.episodes,
      facts,
      openLoops,
      diaryEntry,
      growthObservation,
      fallback: false,
    },
  };
}

/**
 * Render portable human-readable Markdown diary (data/diary/YYYY-MM-DD.md).
 */
export function renderDiaryMarkdown(record) {
  if (!record || typeof record !== "object") return "";
  const lines = [
    `# ${record.dateKey} · ${record.dayMood || "日常"}`,
    "",
    "## 睡前手记",
    record.diaryEntry || "",
    "",
  ];
  if (record.growthObservation) {
    lines.push("## 细微的变化", `> ${record.growthObservation}`, "");
  }
  if (Array.isArray(record.episodes) && record.episodes.length > 0) {
    lines.push("## 今天的情节段");
    for (const ep of record.episodes) {
      const range = ep.timeRange ? `[${ep.timeRange}] ` : "";
      lines.push(`- **${range}${ep.title}**（${ep.emotionalTone || "自然"}）：${ep.summary}`);
    }
    lines.push("");
  }
  if (Array.isArray(record.facts) && record.facts.length > 0) {
    lines.push("## 记在心里的事");
    for (const f of record.facts) {
      const sign = f.polarity < 0 ? "不喜欢/避开" : f.predicate;
      lines.push(`- ${f.subject} · ${sign} · ${f.object}${f.evidence ? `（${f.evidence}）` : ""}`);
    }
    lines.push("");
  }
  if (Array.isArray(record.openLoops) && record.openLoops.length > 0) {
    lines.push("## 心里惦记着");
    for (const o of record.openLoops) {
      lines.push(`- ${o.text}`);
    }
    lines.push("");
  }
  const metaParts = [
    record.model ? `model=${record.model}` : "",
    record.messageCount ? `messages=${record.messageCount}` : "",
    record.usage?.total_tokens ? `tokens=${record.usage.total_tokens}` : "",
    typeof record.estimatedCostCny === "number" ? `cost=¥${record.estimatedCostCny.toFixed(4)}` : "",
  ].filter(Boolean);
  if (metaParts.length > 0) {
    lines.push("---", `_${metaParts.join(" · ")}_`, "");
  }
  return lines.join("\n");
}

const OPEN_LOOP_STOP_WORDS = new Set([
  "今天", "明天", "昨天", "下次", "一下", "一点", "什么", "怎么", "有没有", "是不是",
  "记得", "问问", "看看", "聊聊", "发给", "告诉", "用户的", "小汐", "时候", "第二天",
  "事情", "话题", "那个", "这个", "一些", "一个", "继续", "自然", "成品",
]);

export function normalizeOpenLoopKey(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s，。！？,.!?、；;：:""''（）()【】\[\]~～-]+/g, "")
    .trim()
    .slice(0, 48);
}

function extractLoopKeywords(text) {
  const cleaned = String(text ?? "").replace(/[，。！？,.!?、；;：:""''（）()【】\[\]~～]/g, " ");
  const out = new Set();
  const segments = cleaned.match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) || [];
  for (const seg of segments) {
    if (/[a-z0-9]/i.test(seg)) {
      if (seg.length >= 2) out.add(seg.toLowerCase());
      continue;
    }
    if (seg.length <= 4 && !OPEN_LOOP_STOP_WORDS.has(seg)) out.add(seg);
    for (let i = 0; i <= seg.length - 2; i += 1) {
      const bi = seg.slice(i, i + 2);
      if (!OPEN_LOOP_STOP_WORDS.has(bi)) out.add(bi);
    }
  }
  return [...out];
}

/**
 * Collect active, unexpired, unresolved openLoops across daily diaries.
 */
export function collectActiveOpenLoops(diaryEntries = [], { resolvedKeys = [], nudgedMap = {}, now = Date.now() } = {}) {
  const resolvedSet = new Set((Array.isArray(resolvedKeys) ? resolvedKeys : []).map((k) => normalizeOpenLoopKey(k)));
  const seen = new Set();
  const sorted = (Array.isArray(diaryEntries) ? diaryEntries : [])
    .filter((d) => d && Array.isArray(d.openLoops))
    .sort((a, b) => String(b.dateKey || "").localeCompare(String(a.dateKey || "")));

  const out = [];
  for (const d of sorted) {
    for (const loop of d.openLoops) {
      const text = cleanText(typeof loop === "string" ? loop : loop?.text, 70);
      if (text.length < 4) continue;
      const key = normalizeOpenLoopKey(text);
      if (!key || seen.has(key) || resolvedSet.has(key)) continue;
      const expiresAt = Number(loop?.expiresAt || 0);
      if (expiresAt > 0 && expiresAt <= now) continue;
      seen.add(key);
      out.push({
        key,
        text,
        fromDate: String(d.dateKey || ""),
        createdAt: Number(loop?.createdAt || d.consolidatedAt || 0),
        expiresAt,
        nudgedAt: Number(nudgedMap?.[key] || 0),
      });
    }
  }
  return out;
}

/**
 * Detect which active openLoops have been naturally discussed & resolved in recent messages.
 */
export function detectResolvedOpenLoops(activeLoops = [], recentMessages = []) {
  const msgs = (Array.isArray(recentMessages) ? recentMessages : [])
    .map((m) => ({
      ts: Number(m?.ts ?? m?.at ?? 0),
      text: cleanText(typeof m === "string" ? m : (m?.text ?? m?.content ?? ""), 400),
    }))
    .filter((m) => m.text.length >= 2);
  if (msgs.length === 0) return { resolved: [], remaining: Array.isArray(activeLoops) ? activeLoops : [] };

  const resolved = [];
  const remaining = [];
  for (const loop of Array.isArray(activeLoops) ? activeLoops : []) {
    const keywords = extractLoopKeywords(loop.text);
    const createdAt = Number(loop.createdAt || 0);
    let matchedMsg = null;
    for (const m of msgs) {
      if (createdAt > 0 && m.ts > 0 && m.ts < createdAt - 60_000) continue;
      const low = m.text.toLowerCase();
      let hits = 0;
      let strongHit = false;
      for (const kw of keywords) {
        if (low.includes(kw)) {
          hits += 1;
          if (kw.length >= 4) strongHit = true;
        }
      }
      if (strongHit || hits >= 2 || (keywords.length <= 2 && hits >= 1 && m.text.length >= 6)) {
        matchedMsg = m;
        break;
      }
    }
    if (matchedMsg) {
      resolved.push({ ...loop, triggerText: matchedMsg.text.slice(0, 60) });
    } else {
      remaining.push(loop);
    }
  }
  return { resolved, remaining };
}

/**
 * Ultra-thin lived continuity hint injected into the companion's mind (<= 240 chars).
 */
export function buildDiaryContinuityHint(diaryEntries = [], { now = Date.now(), maxChars = 240, resolvedKeys = [] } = {}) {
  const valid = (Array.isArray(diaryEntries) ? diaryEntries : [])
    .filter((d) => d && d.dateKey && d.diaryEntry)
    .sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));
  if (valid.length === 0) return "";

  const todayKey = formatLocalDateKey(now);
  const cutoffTs = now - 7 * 86400_000;
  const recent = valid.filter((d) => {
    const t = Date.parse(`${d.dateKey}T23:59:59`);
    return !Number.isFinite(t) || t >= cutoffTs;
  }).slice(0, 2);
  if (recent.length === 0) return "";

  const parts = [];
  for (const d of recent) {
    const tag = d.dateKey === todayKey ? "今天早些时候日记" : `${d.dateKey.slice(5)}睡前日记`;
    parts.push(`${tag}(${d.dayMood || "自然"})：${cleanText(d.diaryEntry, 72)}`);
    if (d.growthObservation && parts.length === 1) {
      parts.push(`近期心态变化：${cleanText(d.growthObservation, 48)}`);
    }
  }
  const activeLoops = collectActiveOpenLoops(recent, { resolvedKeys, now });
  if (activeLoops[0]?.text) {
    parts.push(`心里还惦记：${cleanText(activeLoops[0].text, 36)}`);
  }
  const joined = `【伴侣近况日记】${parts.join("；")}`;
  return joined.length <= maxChars ? joined : `${joined.slice(0, maxChars - 1)}…`;
}

/**
 * Step 2 Foundation: Weekly Growth Reflection Prompt (3–7 daily diaries -> milestone + habit pruning).
 */
export function buildWeeklyGrowthReflectionPrompt({ weekKey, diaryEntries = [], existingMilestones = [], activeHabits = [] } = {}) {
  const entriesText = (Array.isArray(diaryEntries) ? diaryEntries : [])
    .slice(-7)
    .map((d) => `[${d.dateKey} · ${d.dayMood || "自然"}] ${cleanText(d.diaryEntry, 180)}${d.growthObservation ? `（变化：${d.growthObservation}）` : ""}`)
    .join("\n");
  const habitsText = (Array.isArray(activeHabits) ? activeHabits : [])
    .slice(0, 10)
    .map((h) => `- (${h.id || ""}) ${cleanText(h.rule || h.text || "", 80)}`)
    .join("\n");
  const prevMilestones = (Array.isArray(existingMilestones) ? existingMilestones : [])
    .slice(-3)
    .map((m) => `- ${m.weekKey}: ${cleanText(m.milestone || "", 80)}`)
    .join("\n");

  return [
    {
      role: "system",
      content: [
        "你是伴侣的周度成长复盘器（只输出合法 JSON，不带代码块围栏）。",
        "任务：从过去几天的真实第一人称日记里提炼 1 条真正属于她的阶段成长节点，并判断旧习惯清单里有没有已经过时、太刻板、可以自然卸下的条目。",
        "严禁拍马屁、严禁虚构事件、严禁强行拔高。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `周次：${weekKey}`,
        prevMilestones ? `既往成长节点：\n${prevMilestones}` : "",
        habitsText ? `当前生效旧习惯：\n${habitsText}` : "",
        "",
        '输出 JSON：{ "theme": "6到16字本周主线", "milestone": "40到120字第一人称阶段变化", "retireHabitIds": ["可卸下的旧习惯id，无则空数组"] }',
        "",
        "【本周日记】",
        entriesText,
      ].filter(Boolean).join("\n"),
    },
  ];
}

export function parseWeeklyGrowthOutput(rawText, { weekKey, now = Date.now() } = {}) {
  const jsonText = extractJsonObjectText(rawText);
  if (!jsonText) return { ok: false, error: "no_json_found", parsed: null };
  try {
    const raw = JSON.parse(jsonText);
    const milestone = stripAiDiaryBoilerplate(raw?.milestone || "");
    if (!milestone || milestone.length < 12) return { ok: false, error: "milestone_too_short", parsed: null };
    return {
      ok: true,
      parsed: {
        weekKey: String(weekKey || ""),
        theme: cleanText(raw?.theme || "本周生活", 24),
        milestone: cleanText(milestone, 180),
        retireHabitIds: (Array.isArray(raw?.retireHabitIds) ? raw.retireHabitIds : []).map(String).filter(Boolean).slice(0, 5),
        createdAt: now,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), parsed: null };
  }
}

/**
 * Build model-agnostic Portable Soul Ledger (survives any future LLM migration).
 */
export function buildPortableSoulLedger({
  diaryEntries = [],
  milestones = [],
  personSchema = null,
  dreamBlocks = null,
  triples = [],
  identityVersion = "unknown",
  now = Date.now(),
} = {}) {
  const sortedDiaries = (Array.isArray(diaryEntries) ? diaryEntries : [])
    .filter((d) => d && d.dateKey)
    .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));

  const activeTriples = (Array.isArray(triples) ? triples : [])
    .filter((t) => t && Number(t.invalid_at ?? 0) === 0)
    .slice(0, 200)
    .map((t) => ({
      subject: t.subject,
      predicate: t.predicate,
      object: t.object,
      polarity: Number(t.polarity ?? 1),
      confidence: Number(t.confidence ?? 0.8),
      validAt: Number(t.valid_at ?? 0),
    }));

  const totalCostCny = sortedDiaries.reduce((sum, d) => sum + (Number(d.estimatedCostCny) || 0), 0);

  return {
    schemaVersion: "soulcard.ledger.v1",
    modelAgnostic: true,
    exportedAt: new Date(now).toISOString(),
    identityVersion: String(identityVersion || "unknown"),
    stats: {
      diaryDays: sortedDiaries.length,
      episodeCount: sortedDiaries.reduce((s, d) => s + (Array.isArray(d.episodes) ? d.episodes.length : 0), 0),
      growthObservations: sortedDiaries.filter((d) => Boolean(d.growthObservation)).length,
      milestoneCount: Array.isArray(milestones) ? milestones.length : 0,
      activeTriplesCount: activeTriples.length,
      totalConsolidationCostCny: Math.round(totalCostCny * 10000) / 10000,
    },
    personSchema: personSchema || null,
    coreMemoryBlocks: dreamBlocks || null,
    activeTriples,
    milestones: Array.isArray(milestones) ? milestones : [],
    diaries: sortedDiaries,
  };
}
