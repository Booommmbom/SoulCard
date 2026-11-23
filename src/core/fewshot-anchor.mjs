// Dynamic Few-Shot Style Anchoring + Thin Depth=2 Recency Anchor
// Pure core module: ZERO fs / sqlite / channel / network imports.
// Implements "Thick State, Thin Prompt" (Show, Don't Tell) to suppress RLHF assistant stiffness
// by injecting 1-2 ultra-short natural dialogue exemplars + PAD cue near the end of context.

import { describePadEmotion } from "./emotion-pad.mjs";
import { formatCoreMemoryCapsule } from "./sleep-dream.mjs";
import { formatInnerLifeForPrompt } from "./inner-life.mjs";

const SCENARIO_RE = {
  fatigue_comfort: /(好累|累死|太累|撑不住|加班|忙死|头疼|头晕|难受|委屈|压力|不想动|烦死|困死)/,
  playful_tease: /(哈哈|笑死|离谱|牛啊|厉害|炫耀|猜猜|你猜|逗我|服了|绝了|好耶|赢了|通关)/,
  photo_art: /(拍照|照片|修图|色调|灰调|配色|画面|镜头|相机|构图|看图|光影|胶片|手账)/,
  late_night: /(晚安|睡不着|失眠|熬夜|夜深|睡吧|快睡|半夜|困了|做梦)/,
};

const ROBOTIC_FILTER_RE = /(作为(?:一个)?AI|语言模型|您好|非常理解您的|建议您|以下是|请注意|首先|其次|第一|1\.|2\.|3\.|总结来说|总的来说|有什么我可以帮|随时告诉我|HTTP\s*\d|报错|异常|超时|未响应|\[系统\]|```)/i;
const PHATIC_ONLY_RE = /^(?:嗯+|哦+|好+|行|在|我在|嗯，我在。?|收到|知道了|好的)[，。！!？?~～]*$/;

/**
 * Curated ultra-natural Nuomu-Cai baseline anchors per scenario.
 * Short, rhythmic, zero assistant-speak, high conversational breath.
 */
export const CURATED_STYLE_ANCHORS = Object.freeze({
  fatigue_comfort: [
    { u: "今天忙了一整天累死了", a: "先别撑着了，靠一会儿吧，不想说话就安静缓口气，我在这儿陪着。" },
    { u: "头有点疼不想动了", a: "那今天就到这儿算了，手机放远点闭眼歇十分钟，剩下的明天再说。" },
  ],
  playful_tease: [
    { u: "哈哈哈今天这波操作帅吧", a: "行行行，算你今天手气和手感双在线，嘴角都快翘到天上去了。" },
    { u: "你猜我刚才干嘛去了", a: "八成不是又捣鼓啥新点子，就是摸鱼打游戏去了，我太了解你了。" },
  ],
  photo_art: [
    { u: "刚拍了一张灰调的街景", a: "灰调配一点冷光会特别有电影感诶，光想想那个画面就挺耐看。" },
    { u: "修图调色卡住了", a: "别死磕一条曲线啦，先退远看一眼整体明暗，有时候暗部松一点味道就出来了。" },
  ],
  late_night: [
    { u: "有点困了准备睡了", a: "嗯……那放下手机好好睡吧，明天醒了再接着聊。" },
    { u: "大半夜还是睡不着", a: "那先别逼自己闭眼，越逼越清醒，就随便聊两句废话，困了你直接睡就行。" },
  ],
  casual_daily: [
    { u: "刚吃完饭有点发呆", a: "吃饱了就该放空一会儿嘛，脑子歇着最舒服了。" },
    { u: "周末想去爬个山顺便拍拍照", a: "这个安排听着就舒服，顺便把平时练的肩膀后背也活动开，挑个光线软一点的时段出片最绝。" },
  ],
});

/**
 * Classify current turn into one of 5 natural companionship scenarios.
 */
export function classifyDialogueScenario({ text = "", pad = null, now = Date.now() } = {}) {
  const raw = String(text ?? "");
  if (SCENARIO_RE.fatigue_comfort.test(raw)) return "fatigue_comfort";
  if (SCENARIO_RE.photo_art.test(raw)) return "photo_art";
  if (SCENARIO_RE.playful_tease.test(raw)) return "playful_tease";
  if (SCENARIO_RE.late_night.test(raw)) return "late_night";

  const hour = new Date(Number(now) || Date.now()).getHours();
  if (hour >= 23 || hour < 5) return "late_night";
  if (pad && Number(pad.pleasure ?? 0.6) < 0.46) return "fatigue_comfort";
  if (pad && Number(pad.pleasure ?? 0.6) >= 0.72 && Number(pad.arousal ?? 0.5) >= 0.62) return "playful_tease";
  return "casual_daily";
}

/**
 * Strict naturalness quality gate for harvesting live real dialogue turns.
 * Filters out robotic assistant replies, error messages, lists, and empty phatics.
 */
export function isHighNaturalnessTurn(userText, replyText) {
  const u = String(userText ?? "").trim();
  const a = String(replyText ?? "").trim();
  if (!u || !a) return false;
  const uLen = Array.from(u).length;
  const aLen = Array.from(a).length;
  if (uLen < 3 || uLen > 36) return false;
  if (aLen < 8 || aLen > 48) return false;
  if (ROBOTIC_FILTER_RE.test(a) || ROBOTIC_FILTER_RE.test(u)) return false;
  if (PHATIC_ONLY_RE.test(a)) return false;
  if (/https?:\/\//i.test(a) || a.includes("\n")) return false;
  return true;
}

/**
 * Dynamically harvest high-naturalness real (Cai -> Nuomu) pairs from recent private history.
 */
export function harvestOrganicAnchors(recentRows = [], limit = 6) {
  if (!Array.isArray(recentRows) || recentRows.length < 2) return [];
  const harvested = [];
  const seen = new Set();
  for (let i = recentRows.length - 1; i >= 1; i -= 1) {
    const curr = recentRows[i];
    const prev = recentRows[i - 1];
    const currName = String(curr?.name ?? curr?.role ?? "").toLowerCase();
    const prevName = String(prev?.name ?? prev?.role ?? "").toLowerCase();
    const isAssistant = currName.includes("诺姆") || currName === "assistant";
    const isUser = !prevName.includes("诺姆") && prevName !== "assistant";
    if (!isAssistant || !isUser) continue;

    const u = String(prev?.text ?? "").trim();
    const a = String(curr?.text ?? "").trim();
    if (!isHighNaturalnessTurn(u, a)) continue;
    const key = `${u.slice(0, 12)}|${a.slice(0, 12)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const scenario = classifyDialogueScenario({ text: `${u} ${a}` });
    harvested.push({ u: u.slice(0, 24), a: a.slice(0, 44), scenario, live: true });
    if (harvested.length >= limit) break;
  }
  return harvested;
}

/**
 * Select 1-2 highest-relevance style anchors for the current turn.
 */
export function selectStyleAnchors({ text = "", pad = null, now = Date.now(), harvested = [], limit = 2 } = {}) {
  const scenario = classifyDialogueScenario({ text, pad, now });
  const maxItems = Math.max(1, Math.min(2, Number(limit) || 2));
  const selected = [];

  // Prefer 1 live harvested anchor matching current scenario if available
  const liveMatch = (Array.isArray(harvested) ? harvested : []).find((h) => h.scenario === scenario);
  if (liveMatch) selected.push(liveMatch);

  const curatedPool = CURATED_STYLE_ANCHORS[scenario] || CURATED_STYLE_ANCHORS.casual_daily;
  for (const item of curatedPool) {
    if (selected.length >= maxItems) break;
    if (!selected.some((s) => s.a === item.a)) {
      selected.push({ ...item, scenario, live: false });
    }
  }
  return { scenario, anchors: selected.slice(0, maxItems) };
}

/**
 * Build the Thin Depth=2 Recency Anchor (<= 250 chars) injected near the end of context.
 * Combines PAD tone cue + Dream core capsule + 1-2 ultra-short Few-Shot voice exemplars.
 */
export function buildDepthRecencyAnchor({
  text = "",
  pad = null,
  dreamState = null,
  innerLife = null,
  recentRows = [],
  now = Date.now(),
  maxChars = 250,
} = {}) {
  const budget = Math.max(120, Math.min(320, Number(maxChars) || 250));
  const parts = [];

  // 1. PAD tone cue
  if (pad && typeof pad === "object") {
    const desc = describePadEmotion(pad);
    parts.push(`此刻状态[${desc.label}]：${desc.toneHint}`);
  }

  // 2. Nuomu's coherent inner-life day trajectory (Prefrontal DMN)
  if (innerLife && typeof innerLife === "object") {
    const lifeLine = formatInnerLifeForPrompt(innerLife, now, 86);
    if (lifeLine) parts.push(lifeLine);
  }

  // 3. Sleep-time Compute Core Memory Capsule (ultra-thin)
  const dreamCapsule = formatCoreMemoryCapsule(dreamState, 72);
  if (dreamCapsule) {
    parts.push(`核心印象：${dreamCapsule}`);
  }

  // 4. 1-2 Few-Shot Voice Anchors (Show, Don't Tell)
  const harvested = harvestOrganicAnchors(recentRows, 4);
  const { anchors } = selectStyleAnchors({ text, pad, now, harvested, limit: 2 });
  if (anchors.length > 0) {
    const first = anchors[0];
    const sample1 = `语感示范：用户「${first.u}」→诺姆「${first.a}」`;
    const baseLen = parts.join("；").length;
    if (baseLen + sample1.length + 2 <= budget) {
      parts.push(sample1);
      if (anchors.length > 1) {
        const second = anchors[1];
        const sample2 = `用户「${second.u}」→诺姆「${second.a}」`;
        if (parts.join("；").length + sample2.length + 2 <= budget) {
          parts.push(sample2);
        }
      }
    } else if (parts.length === 0) {
      parts.push(sample1.slice(0, budget));
    }
  }

  const out = parts.join("；").trim();
  if (!out) return "";
  return out.length > budget ? out.slice(0, budget - 1) + "…" : out;
}
