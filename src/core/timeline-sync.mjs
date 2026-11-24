// Physical-Time Session Boundary Cutoff + Ephemeral Activity TTL + Anti-Question-Streak Guard
// Pure core module: ZERO fs / sqlite / channel / network imports (strictly passes test-core-purity).
// Solves reality-clock desync while REDUCING prompt tokens by physically flushing stale >60m
// raw chat turns into a single compact past-tense background sentence.

export const EPHEMERAL_ACTIVITY_TTL = Object.freeze([
  { id: "shower", label: "洗澡/放水", ttlMinutes: 35, re: /(洗澡|放水|进热水|冲个澡|洗漱|洗头|披件外套|发抖)/ },
  { id: "meal", label: "吃饭/做饭", ttlMinutes: 50, re: /(吃饭|炒饭|做饭|晚饭|午饭|早饭|外卖|吃啥|洗锅|锅你洗)/ },
  { id: "find_photo", label: "翻相册找图", ttlMinutes: 20, re: /(翻相册|翻出来发你|找那张|存成图|调色那张|展示展示)/ },
  { id: "workout", label: "健身/练腿", ttlMinutes: 75, re: /(健身|练腿|举铁|跑步|练肩|练背|腿软|腿抖|拉伸)/ },
  { id: "commute", label: "出门/在路上", ttlMinutes: 50, re: /(出门|在路上|通勤|回家路上|买菜|买米)/ },
  { id: "meme", label: "斗图/表情包", ttlMinutes: 10, re: /(表情包|冻死了|搞笑|\[图片\])/ },
]);

const QUESTION_END_RE = /(?:[?？]\s*$|吗[啊呀呢吧~～!！。]*$|了没[啊呀呢吧~～!！。]*$|干点?啥[呀啊呢~～]*$|吃点?啥[呀啊呢~～]*$|站得住不[啊呀呢~～]*$|没啊[？?~～]*$)/;

function periodOfHour(hour) {
  if (hour < 5) return "凌晨";
  if (hour < 9) return "早上";
  if (hour < 12) return "上午";
  if (hour < 14) return "中午";
  if (hour < 18) return "下午";
  if (hour < 20) return "傍晚";
  if (hour < 23) return "晚上";
  return "深夜";
}

function hhmm(ts) {
  const d = new Date(Number(ts) || 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Format ultra-compact 8-char wall-clock tag: e.g. "[23:54 深夜]"
 */
export function formatClockTag(now = Date.now()) {
  const d = new Date(Number(now) || Date.now());
  return `[${hhmm(now)} ${periodOfHour(d.getHours())}]`;
}

/**
 * Detect ephemeral physical activities in archived turns whose realistic TTL has already expired.
 */
export function detectExpiredActivities(rows = [], now = Date.now()) {
  const nowMs = Number(now) || Date.now();
  const expired = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const ts = Number(row?.ts ?? 0) || 0;
    if (ts <= 0) continue;
    const elapsedMin = (nowMs - ts) / 60000;
    const combined = `${String(row?.userText ?? "")} ${String(row?.text ?? "")}`;
    for (const rule of EPHEMERAL_ACTIVITY_TTL) {
      if (elapsedMin >= rule.ttlMinutes && rule.re.test(combined)) {
        expired.add(rule.label);
      }
    }
  }
  return [...expired];
}

/**
 * Physically partition working-memory history along >= sessionGapMinutes (default 60m) boundaries.
 * Stale episodes are flushed out of raw user/assistant turns (breaking Transformer continuation bias
 * and cutting prompt tokens by 50%-80%) and distilled into 1 compact past-tense background line.
 */
export function partitionWorkingHistory(rawHistoryRows = [], { now = Date.now(), sessionGapMinutes = 60 } = {}) {
  const nowMs = Number(now) || Date.now();
  const gapMs = Math.max(15, Number(sessionGapMinutes) || 60) * 60000;
  const validRows = (Array.isArray(rawHistoryRows) ? rawHistoryRows : [])
    .filter((r) => r && String(r.text ?? "").trim() !== "" && !/^\[?不发\]?$/.test(String(r.text ?? "").trim()));

  if (validRows.length === 0) {
    return {
      activeRows: [],
      archivedRows: [],
      activeSinceTs: 0,
      crossedBoundary: false,
      gapMinutesFromLast: 0,
      expiredActivities: [],
      pastContextSummary: "",
      needClockPrefix: true,
    };
  }

  const latest = validRows[validRows.length - 1];
  const latestTs = Number(latest.ts ?? 0) || 0;
  const gapFromLastMs = latestTs > 0 ? Math.max(0, nowMs - latestTs) : 0;
  const gapMinutesFromLast = Math.round(gapFromLastMs / 60000);

  let activeRows = validRows;
  let archivedRows = [];
  let activeSinceTs = 0;
  let crossedBoundary = false;

  if (latestTs > 0 && gapFromLastMs >= gapMs) {
    // Full episode boundary flush: last chat was >= 60m ago -> start fresh active conversation!
    crossedBoundary = true;
    activeRows = [];
    archivedRows = validRows;
    activeSinceTs = Infinity;
  } else {
    // Keep only the current contiguous episode after the most recent >= 60m internal gap
    let splitIdx = 0;
    for (let i = validRows.length - 1; i >= 1; i -= 1) {
      const currTs = Number(validRows[i].ts ?? 0) || 0;
      const prevTs = Number(validRows[i - 1].ts ?? 0) || 0;
      if (currTs > 0 && prevTs > 0 && (currTs - prevTs) >= gapMs) {
        splitIdx = i;
        break;
      }
    }
    if (splitIdx > 0) {
      archivedRows = validRows.slice(0, splitIdx);
      activeRows = validRows.slice(splitIdx);
      activeSinceTs = Number(activeRows[0]?.ts ?? 0) || 0;
    }
  }

  const expiredActivities = detectExpiredActivities(archivedRows, nowMs);

  let pastContextSummary = "";
  if (archivedRows.length > 0) {
    const firstTs = Number(archivedRows[0]?.ts ?? 0) || 0;
    const lastTs = Number(archivedRows[archivedRows.length - 1]?.ts ?? 0) || 0;
    const span = firstTs > 0 && lastTs > 0
      ? (hhmm(firstTs) === hhmm(lastTs) ? hhmm(lastTs) : `${hhmm(firstTs)}-${hhmm(lastTs)}`)
      : "早些时候";

    // Build ultra-compact topic snippets from archived user turns if no TTL activity matched
    const topics = expiredActivities.length > 0
      ? expiredActivities.slice(0, 4)
      : [...new Set(
        archivedRows
          .map((r) => String(r.userText ?? "").trim())
          .filter((t) => t.length >= 3 && t !== "[自主]" && t !== "[图片]")
          .slice(-2)
          .map((t) => t.slice(0, 14))
      )];

    const topicText = topics.length > 0 ? topics.join("、") : "一些日常闲聊";
    const gapNote = crossedBoundary
      ? `（距今已过 ${gapMinutesFromLast >= 60 ? `${Math.floor(gapMinutesFromLast / 60)}小时${gapMinutesFromLast % 60 ? `${gapMinutesFromLast % 60}分` : ""}` : `${gapMinutesFromLast}分钟`}，早已结束翻篇；绝不要按正在进行去催或追问，若用户没提就顺着当下新话聊）`
      : "（更早之前的旧段，已翻篇，别硬扯回来）";
    pastContextSummary = `【今日早些时候背景 ${span}】曾聊过：${topicText}${gapNote}`;
  }

  const needClockPrefix = crossedBoundary || gapMinutesFromLast >= 20;

  return {
    activeRows,
    archivedRows,
    activeSinceTs,
    crossedBoundary,
    gapMinutesFromLast,
    expiredActivities,
    pastContextSummary,
    needClockPrefix,
  };
}

/**
 * Anti-RLHF Question-Streak Guard:
 * Detects when the companion's last 2 consecutive replies both ended with interrogative questions
 * (a telltale closed-source AI habit) and emits a crisp 1-line brake.
 */
export function buildAntiQuestionStreakHint(activeRows = []) {
  const recent = (Array.isArray(activeRows) ? activeRows : [])
    .filter((r) => String(r?.text ?? "").trim() !== "")
    .slice(-2);
  if (recent.length < 2) return "";
  const bothQuestion = recent.every((r) => QUESTION_END_RE.test(String(r.text ?? "").trim()));
  if (!bothQuestion) return "";
  return "【去AI追问提醒】你刚刚连续两轮都在句尾反问/提问了；这一句直接自然接梗、吐槽或陈述收尾，不要再抛问题，让对话松弛落下来。";
}
