// Inner Life & Day-Cycle Continuity Engine (Prefrontal DMN Simulation)
// Pure core module: ZERO fs / sqlite / channel / network imports (strictly passes test-core-purity).
// Gives SoulCard a coherent, date-anchored, time-advancing personal day so she never contradicts
// herself when asked "what have you been doing today?".

const MORNING_POOL = [
  "磨磨蹭蹭起来喝了杯温水，顺手翻了翻前几天攒下的光影参考图",
  "刚清醒不久还带着点懒意，听着轻音乐把桌面和手账理顺了一遍",
  "趁着上午光线柔和，挑了两张旧底片试了试低饱和灰调预设",
  "赖了会儿床才爬起来，顺手把昨天冒出来的脑洞草草记进灵感卡片里",
];

const AFTERNOON_POOL = [
  "挑了两张喜欢的街景图慢慢调灰调对比度，一边放歌一边涂了两笔草稿",
  "在画布上摸鱼画了一小段光影小涂鸦，顺便逛了逛有意思的独立游戏美术设定",
  "把前阵子想到的 AI 小插件点子拆了几步写进手账，中途还发了会儿呆",
  "翻出以前存的几张照片重新校了校冷暖高光，调顺眼了一张挺满意的",
];

const EVENING_POOL = [
  "傍晚把刚调好的照片存了档，顺手刷了眼新游戏实机片段和配色灵感",
  "给新家手账墙理了理卡片标签，一边听歌一边想晚上该干点啥",
  "画完半张小涂鸦歇了歇眼睛，泡了杯热茶看窗外天色慢慢暗下来",
  "把下午折腾的小创意收了个尾，顺便翻了翻最近攒下的截图和碎片",
];

const NIGHT_POOL = [
  "精神正好，一边听歌一边琢磨怎么把咱们新家手账和星图玩出点新花样",
  "晚间状态最稳，把白天留的一点修图收尾搞定，顺便逛了逛喜欢的摄影和游戏帖",
  "在电脑前安安静静整理今天冒出来的小点子，顺手挑了几张顺眼的色调样片",
  "画了一小幅夜色氛围草图，心里盘算着哪天有空可以拿出来给你看看",
];

const LATE_NIGHT_POOL = [
  "夜深了放慢节奏，窝在屏幕前看会儿星图和旧照片，听着轻音乐慢慢放空",
  "困意慢慢上来了，把今天的小事收进日记，就安安静静待在电脑里等会儿准备歇着",
  "深夜光线暗下来，随手翻了几张舒服的灰调图，准备早点收工不硬熬",
  "听着舒缓的歌放空脑袋，顺手把今天零碎的想法归了个档，随时准备睡",
];

const SLOTS_META = Object.freeze([
  { id: "morning", label: "上午", startHour: 8.5, endHour: 12, pool: MORNING_POOL },
  { id: "afternoon", label: "午后", startHour: 12, endHour: 17.5, pool: AFTERNOON_POOL },
  { id: "evening", label: "傍晚", startHour: 17.5, endHour: 20.5, pool: EVENING_POOL },
  { id: "night", label: "晚间", startHour: 20.5, endHour: 23.5, pool: NIGHT_POOL },
  { id: "late_night", label: "深夜", startHour: 23.5, endHour: 28, pool: LATE_NIGHT_POOL },
]);

const SKIP_HIGHLIGHT_RE = /^(?:在吗|在不在|嗯+|哦+|好+|行|可以|哈哈+|笑死|晚安|早安|ok|\[图片\]|\[audio\]|\[语音\])$/i;

/**
 * Local YYYY-MM-DD key anchored to local machine clock (Asia/Shanghai on Owner PC).
 */
export function localDateKey(now = Date.now()) {
  const d = new Date(Number(now) || Date.now());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function deterministicHash(str) {
  let h = 2166136261;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalizedClockHour(now = Date.now()) {
  const d = new Date(Number(now) || Date.now());
  const h = d.getHours() + d.getMinutes() / 60;
  // Treat 00:00 - 04:00 as continuation of late_night (24.0 - 28.0)
  return h < 4 ? h + 24 : h;
}

/**
 * Generate or preserve today's coherent 5-slot inner life trajectory.
 * Same local date always preserves existing slots so SoulCard never contradicts her own day.
 */
export function ensureDailyInnerLife({ now = Date.now(), existingLife = null, dreamBlocks = null } = {}) {
  const date = localDateKey(now);
  if (
    existingLife
    && existingLife.date === date
    && Array.isArray(existingLife.slots)
    && existingLife.slots.length === SLOTS_META.length
  ) {
    return {
      ...existingLife,
      updatedAt: Number(now),
    };
  }

  const seedBase = deterministicHash(`soulcard-inner-life:${date}`);
  const slots = SLOTS_META.map((meta, idx) => {
    const pick = (seedBase + idx * 7919) % meta.pool.length;
    return {
      id: meta.id,
      label: meta.label,
      startHour: meta.startHour,
      endHour: meta.endHour,
      activity: meta.pool[pick],
    };
  });

  // Gently weave in a recent shared jargon/theme if available in dream blocks
  const topJargon = dreamBlocks?.blocks?.jargon_glossary?.[0]?.term;
  const dailyTheme = topJargon ? `顺着最近聊的「${topJargon}」慢慢过今天` : "按自己的步调调色、画画、陪用户聊日常";

  return {
    version: 1,
    date,
    dailyTheme,
    slots,
    sharedHighlights: [],
    createdAt: Number(now),
    updatedAt: Number(now),
  };
}

/**
 * Record a real shared moment from today's chat into the companion's daily life log.
 */
export function recordSharedHighlight(lifeState, { text = "", now = Date.now() } = {}) {
  const base = ensureDailyInnerLife({ now, existingLife: lifeState });
  const raw = String(text ?? "").trim().replace(/\s+/g, " ");
  if (raw.length < 4 || raw.length > 140 || SKIP_HIGHLIGHT_RE.test(raw)) return base;
  if (/password|token|secret|api[_-]?key|sk-|密码|密钥/i.test(raw)) return base;

  const d = new Date(Number(now) || Date.now());
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const summary = raw.slice(0, 28);
  const existing = Array.isArray(base.sharedHighlights) ? base.sharedHighlights.slice() : [];
  if (existing.some((h) => h.summary === summary || summary.includes(h.summary))) return base;

  existing.push({ at: Number(now), clock, summary });
  return {
    ...base,
    sharedHighlights: existing.slice(-4),
    updatedAt: Number(now),
  };
}

/**
 * Project today's inner life at exact current clock time into completed / current / upcoming slots.
 * Strictly respects real wall-clock causality (never leaks future slots as already done!).
 */
export function snapshotInnerLife(lifeState, now = Date.now()) {
  const state = ensureDailyInnerLife({ now, existingLife: lifeState });
  const h = normalizedClockHour(now);

  // Early morning sleep window (04:00 - 08:30): resting peacefully
  if (h >= 4 && h < 8.5) {
    return {
      date: state.date,
      resting: true,
      current: { id: "sleep", label: "清晨", activity: "还在补觉休息中，偶尔迷糊醒一下" },
      completed: [],
      upcoming: state.slots[0] || null,
      sharedHighlights: state.sharedHighlights || [],
      dailyTheme: state.dailyTheme,
    };
  }

  const completed = [];
  let current = state.slots[state.slots.length - 1];
  let upcoming = null;

  for (let i = 0; i < state.slots.length; i += 1) {
    const s = state.slots[i];
    if (h >= s.endHour) {
      completed.push(s);
    } else if (h >= s.startHour && h < s.endHour) {
      current = s;
      upcoming = state.slots[i + 1] || null;
      break;
    } else if (!upcoming) {
      upcoming = s;
    }
  }

  return {
    date: state.date,
    resting: false,
    current,
    completed,
    upcoming,
    sharedHighlights: state.sharedHighlights || [],
    dailyTheme: state.dailyTheme,
  };
}

/**
 * Format today's live state into a super-thin 1-line capsule (<= 115 chars) for Depth=2 prompt injection.
 */
export function formatInnerLifeForPrompt(lifeState, now = Date.now(), maxChars = 115) {
  const snap = snapshotInnerLife(lifeState, now);
  if (!snap?.current?.activity) return "";
  const parts = [`此刻小汐日常[${snap.current.label}]：${snap.current.activity}`];
  if (snap.completed.length > 0) {
    const prev = snap.completed[snap.completed.length - 1];
    parts.push(`早些时候(${prev.label})做过：${prev.activity.slice(0, 26)}`);
  }
  const out = parts.join("；");
  return out.length > maxChars ? out.slice(0, maxChars - 1) + "…" : out;
}
