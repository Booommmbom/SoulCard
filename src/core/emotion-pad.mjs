// PAD 3D Continuous Emotion Dynamics (Pleasure / Arousal / Dominance)
// Pure core module: ZERO fs / sqlite / channel / network imports.
// Implements exponential inertia damping + circadian rhythm baseline + partner-aware warmth.

const JOY_RE = /哈哈|笑死|开心|好耶|太好了|喜欢|可爱|好看|谢谢|厉害|牛|棒|绝了|惊喜|漂亮|爱了/;
const FATIGUE_RE = /好累|累死|太累|撑不住|困死了|熬夜|失眠|头疼|头晕|加班|忙死|好困|没精神|疲惫/;
const DISTRESS_RE = /难过|难受|委屈|崩了|想哭|焦虑|压力大|心烦|郁闷|emo|气死|烦死|讨厌|生气/;
const AFFECTION_RE = /小汐|想你|抱抱|亲亲|陪陪我|晚安|早安|辛苦了|最喜欢你|乖|宝贝|老婆|贴贴/;
const DEEP_FOCUS_RE = /架构|算法|代码|原理|学习|研究|测试|分析|方案|思路|优化|设计/;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function round3(v) {
  return Math.round(clamp01(v) * 1000) / 1000;
}

/**
 * Circadian emotional baseline for SoulCard across 24h local time.
 */
export function circadianPadBaseline(now = Date.now()) {
  const hour = new Date(Number(now) || Date.now()).getHours();
  if (hour >= 23 || hour < 6) {
    return { pleasure: 0.58, arousal: 0.30, dominance: 0.52 }; // Late night: soft, velvet, low arousal
  }
  if (hour >= 6 && hour < 12) {
    return { pleasure: 0.55, arousal: 0.44, dominance: 0.50 }; // Morning: gentle wake-up
  }
  if (hour >= 12 && hour < 18) {
    return { pleasure: 0.62, arousal: 0.58, dominance: 0.56 }; // Afternoon: relaxed & steady
  }
  return { pleasure: 0.66, arousal: 0.66, dominance: 0.58 }; // Evening: lively & expressive
}

/**
 * Normalize or initialize a PAD state, optionally seeding pleasure from legacy scalar emotion (0..100).
 */
export function normalizePadState(pad, fallbackEmotion = 68, now = Date.now()) {
  const base = circadianPadBaseline(now);
  const legacyP = clamp01(Number(fallbackEmotion ?? 68) / 100);
  const pleasure = pad && Number.isFinite(Number(pad.pleasure)) ? clamp01(pad.pleasure) : legacyP;
  const arousal = pad && Number.isFinite(Number(pad.arousal)) ? clamp01(pad.arousal) : base.arousal;
  const dominance = pad && Number.isFinite(Number(pad.dominance)) ? clamp01(pad.dominance) : base.dominance;
  const updatedAt = pad && Number.isFinite(Number(pad.updatedAt)) ? Number(pad.updatedAt) : Number(now);
  const described = describePadEmotion({ pleasure, arousal, dominance });
  return {
    pleasure: round3(pleasure),
    arousal: round3(arousal),
    dominance: round3(dominance),
    label: described.label,
    toneHint: described.toneHint,
    updatedAt,
  };
}

/**
 * Exponential drift toward circadian baseline during silence/idle intervals.
 * Half-life ~ 90 minutes so emotions linger organically instead of snapping to flat 50.
 */
export function driftPadEmotion(prevPad, { now = Date.now(), fallbackEmotion = 68, halfLifeMinutes = 90 } = {}) {
  const current = normalizePadState(prevPad, fallbackEmotion, now);
  const elapsedMinutes = Math.max(0, (Number(now) - Number(current.updatedAt || now)) / 60000);
  if (elapsedMinutes <= 0) return current;
  const hl = Math.max(5, Number(halfLifeMinutes) || 90);
  const keep = Math.pow(0.5, elapsedMinutes / hl);
  const base = circadianPadBaseline(now);
  const pleasure = round3(base.pleasure + (current.pleasure - base.pleasure) * keep);
  const arousal = round3(base.arousal + (current.arousal - base.arousal) * keep);
  const dominance = round3(base.dominance + (current.dominance - base.dominance) * keep);
  const described = describePadEmotion({ pleasure, arousal, dominance });
  return {
    pleasure,
    arousal,
    dominance,
    label: described.label,
    toneHint: described.toneHint,
    updatedAt: Number(now),
  };
}

/**
 * Step PAD emotion with inertia damping when receiving a new message.
 * Prevents abrupt robotic "mood teleportation" while responding empathetically.
 */
export function stepPadEmotion(prevPad, { text = "", now = Date.now(), fallbackEmotion = 68, inertia = 0.72 } = {}) {
  const drifted = driftPadEmotion(prevPad, { now, fallbackEmotion });
  const raw = String(text ?? "");
  let targetP = drifted.pleasure;
  let targetA = drifted.arousal;
  let targetD = drifted.dominance;

  if (JOY_RE.test(raw)) {
    targetP += 0.22;
    targetA += 0.18;
    targetD += 0.06;
  }
  if (AFFECTION_RE.test(raw)) {
    targetP += 0.16;
    targetA += 0.04;
    targetD += 0.05;
  }
  if (FATIGUE_RE.test(raw)) {
    // Partner-aware warmth: when user is tired, SoulCard softens arousal & steps up gentle care (dominance)
    targetP -= 0.06;
    targetA -= 0.24;
    targetD += 0.14;
  }
  if (DISTRESS_RE.test(raw)) {
    targetP -= 0.18;
    targetA += FATIGUE_RE.test(raw) ? -0.05 : 0.08;
    targetD += 0.06;
  }
  if (DEEP_FOCUS_RE.test(raw)) {
    targetP += 0.04;
    targetA += 0.06;
    targetD += 0.12;
  }

  targetP = clamp01(targetP);
  targetA = clamp01(targetA);
  targetD = clamp01(targetD);

  const alpha = Math.max(0.45, Math.min(0.92, Number(inertia) || 0.72));
  const pleasure = round3(drifted.pleasure * alpha + targetP * (1 - alpha));
  const arousal = round3(drifted.arousal * alpha + targetA * (1 - alpha));
  const dominance = round3(drifted.dominance * alpha + targetD * (1 - alpha));
  const described = describePadEmotion({ pleasure, arousal, dominance });

  return {
    pleasure,
    arousal,
    dominance,
    label: described.label,
    toneHint: described.toneHint,
    updatedAt: Number(now),
  };
}

/**
 * Translate continuous PAD coordinates into a concise human emotion label & conversational tone cue.
 */
export function describePadEmotion(pad = {}) {
  const p = clamp01(pad.pleasure ?? 0.6);
  const a = clamp01(pad.arousal ?? 0.5);
  const d = clamp01(pad.dominance ?? 0.55);

  if (p >= 0.68 && a >= 0.62) {
    return { label: "雀跃接梗", toneHint: "语气轻快有灵气，顺着用户的兴致一起好奇接梗，别端着" };
  }
  if (p >= 0.60 && a <= 0.42) {
    return { label: "舒缓温柔", toneHint: "语调放轻放慢，温柔松弛陪着，多一点自然留白" };
  }
  if (p < 0.44 && a <= 0.45) {
    return { label: "安静心疼", toneHint: "声音轻下来，先稳稳接住情绪，不说教不讲大道理" };
  }
  if (p < 0.44 && a > 0.45) {
    return { label: "有点闷烦", toneHint: "允许带一点直率小脾气或吐槽，但对用户保持亲近分寸" };
  }
  if (d >= 0.65 && a <= 0.55) {
    return { label: "稳稳兜底", toneHint: "松弛笃定、主动温柔照料，像默契老友一样稳住节奏" };
  }
  return { label: "松弛自然", toneHint: "像微信私聊一样自然松弛，顺着聊下去，别把天聊死" };
}

/**
 * Compact one-line PAD readout for UI or Depth=2 recency anchor.
 */
export function formatPadShort(pad) {
  if (!pad || typeof pad !== "object") return "";
  const p = Math.round(clamp01(pad.pleasure ?? 0.6) * 100);
  const a = Math.round(clamp01(pad.arousal ?? 0.5) * 100);
  const d = Math.round(clamp01(pad.dominance ?? 0.55) * 100);
  const { label } = describePadEmotion(pad);
  return `${label}(愉悦${p}/精力${a}/笃定${d})`;
}
