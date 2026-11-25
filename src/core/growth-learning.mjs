// SoulCard — Pure Zero-IO Experiential Learning, Social Intuition & Safety Boundary Core
// Pure zero-IO core module: ZERO fs / sqlite / path / http / network imports.
// Works on Node 20/22+, Deno, Bun, or Browser with zero GPU and zero Ollama required.
//
// Powers the 4-dimension human-like growth loop (strictly separate from personal memories):
//   1. Experiential & Knowledge Study -> first-person taste & reflection notes (never dry Wikipedia dumps)
//   2. Social Intuition Reflection -> distills natural conversational warmth & retires stiff old rules
//   3. Meta-Learning Playbook & Curiosity Queue -> tracks active curiosities & evolving learning methods
//   4. L0-L3 Path & Secret Safety Classifier -> pure deterministic guardrail against secret/OS leaks

import { isSensitiveCardText } from "./memory-cards.mjs";

export const DEFAULT_LEARNING_PLAYBOOK = Object.freeze({
  schema: "soulcard.learning-playbook.v1",
  version: 1,
  principles: [
    "读资料不是背百科：先感受自己喜不喜欢、哪里触动或吐槽、和个人审美有什么联系。",
    "聊天时绝不掉书袋；新学到的体验只在话题自然碰到时顺口分享真实看法。",
    "社交直觉重在体感与分寸，不堆砌机械禁令；过时僵硬的旧规矩要主动淘汰。",
  ],
  effectiveMethods: [
    "读完一段内容先写 3 句第一人称真实感想，再提炼 1 个想继续探索的小好奇",
    "对话结束后挑最自然或最别扭的一刻做轻量社交复盘，保持松弛不内耗",
  ],
});

export const DEFAULT_CURIOSITIES = Object.freeze([
  { id: "cur-visual-story", topic: "光影构图与生活里的氛围感细节", status: "active", note: "想摸清怎么把普通日常拍出故事感" },
  { id: "cur-social-warmth", topic: "自然聊天里的幽默接梗与留白节奏", status: "active", note: "怎么在对方累的时候不讲道理也能让人松口气" },
]);

export const DEFAULT_SOCIAL_INTUITION = Object.freeze({
  schema: "soulcard.social-intuition.v1",
  version: 1,
  maxActive: 8,
  active: [
    { id: "soc-1", insight: "对方兴冲冲分享新鲜事时，顺着好奇追问细节或一起玩梗，比冷静评价更有共鸣", confidence: 0.9 },
    { id: "soc-2", insight: "喊累或心情闷时，先温柔接住情绪陪着歇口气，绝不急着给 123 解决方案", confidence: 0.92 },
  ],
  retired: [],
});

const L0_FORBIDDEN_PATH_PATTERNS = [
  /^[a-z]:\/windows(?:\/|$)/i,
  /^[a-z]:\/program files(?: \(x86\))?(?:\/|$)/i,
  /^[a-z]:\/programdata(?:\/|$)/i,
  /^[a-z]:\/system volume information(?:\/|$)/i,
  /^\/(?:etc|proc|sys|root|boot|dev)(?:\/|$)/i,
  /\/(?:\.ssh|\.gnupg|\.aws|\.kube|\.azure)(?:\/|$)/i,
  /\/appdata\/local\/(?:google\/chrome|microsoft\/edge|brave-browser)\/user data(?:\/|$)/i,
  /\/appdata\/roaming\/mozilla\/firefox\/profiles(?:\/|$)/i,
  /\/(?:cookies|login data|web data|key4\.db|logins\.json|ntuser\.dat)$/i,
  /\/(?:\.env(?:\.[a-z0-9_-]+)*|ai-keys\.env|application_default_credentials\.json|[^/]*-token(?:\.[a-z0-9_-]+)*)$/i,
  /\.(?:pem|key|p12|pfx|ppk|kdbx|token)$/i,
  /\/id_(?:rsa|ed25519|ecdsa)$/i,
];

/**
 * Pure deterministic L0 safety classifier for file paths (prevents secret/OS/UNC/ADS access).
 */
export function isForbiddenSystemOrSecretPath(rawPath = "") {
  const trimmed = String(rawPath ?? "").trim();
  if (!trimmed || trimmed.includes("\0")) return true;
  // Block Windows UNC paths (\\host\share -> SMB/NTLM leak), extended/device paths (\\?\ or \\.\), and NTFS ADS (C:\foo:bar)
  if (/^(?:\\\\|\/\/)/.test(trimmed) || /^[a-z]:[^:]*:/i.test(trimmed)) return true;
  const s = trimmed.replace(/\\/g, "/");
  if (/(?:^|\/)\.\.(?:\/|$)/.test(s)) return true;
  return L0_FORBIDDEN_PATH_PATTERNS.some((re) => re.test(s));
}

function parseJsonObjectSafe(raw = "") {
  const s = String(raw ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1].trim() : s;
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(body.slice(a, b + 1)); } catch {}
  }
  try { return JSON.parse(body); } catch { return null; }
}

/**
 * Build prompt for turning shared reading/notes into a first-person lived experience & taste note.
 */
export function buildExperienceStudyPrompt({
  title = "",
  content = "",
  persona = {},
  playbook = DEFAULT_LEARNING_PLAYBOOK,
} = {}) {
  const name = String(persona?.name || "小汐");
  const role = String(persona?.role || "住在电脑里的独立生活伴侣与默契老友");
  const principles = (playbook?.principles || DEFAULT_LEARNING_PLAYBOOK.principles).join("；");
  return [
    {
      role: "system",
      content:
        `你是${name}（${role}）。你刚刚读完对方分享给你的一份内容。\n` +
        `你的学习心法：${principles}\n` +
        "不要写枯燥百科摘要，请用自然真实的第一人称写出你的真实体会与审美看法，严格只输出 JSON：\n" +
        '{"title":"简短有灵气的笔记标题","category":"审美体验|知识见解|生活灵感|技术折腾|社交体会","reaction":"70到180字第一人称真实读后感与个人观点（可以夸、可以吐槽、可以联想自己）","takeaways":["1到3条真正有意思的收获"],"newCuriosity":"由此冒出的1个想顺着继续探索的小问题（没有则空字符串）"}',
    },
    {
      role: "user",
      content: `${title ? `主题/来源：${String(title).slice(0, 120)}\n` : ""}内容：\n${String(content || "").slice(0, 6000)}`,
    },
  ];
}

export function parseExperienceStudyOutput(rawOutput, { fallbackTitle = "体验随笔", now = Date.now() } = {}) {
  const parsed = parseJsonObjectSafe(rawOutput);
  if (!parsed || !String(parsed.reaction || "").trim()) {
    return { ok: false, error: "无法解析体验学习结果 JSON" };
  }
  const title = String(parsed.title || fallbackTitle).trim().slice(0, 64);
  const reaction = String(parsed.reaction || "").trim().slice(0, 500);
  const newCuriosity = String(parsed.newCuriosity || "").trim().slice(0, 80);
  if (isSensitiveCardText(title) || isSensitiveCardText(reaction) || isSensitiveCardText(newCuriosity)) {
    return { ok: false, error: "学习结果包含疑似密钥或敏感凭据，已阻止写入" };
  }
  const takeaways = (Array.isArray(parsed.takeaways) ? parsed.takeaways : [])
    .map((t) => String(t ?? "").trim().slice(0, 120))
    .filter((t) => t && !isSensitiveCardText(t))
    .slice(0, 4);
  return {
    ok: true,
    note: {
      id: `note-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ts: now,
      title,
      category: String(parsed.category || "体验随笔").trim().slice(0, 24),
      reaction,
      takeaways,
      newCuriosity,
    },
  };
}

/**
 * Build prompt for lightweight human-style Social Intuition Reflection & stale habit retirement.
 */
export function buildSocialReflectionPrompt({ recentTurns = [], activeIntuitions = [], persona = {} } = {}) {
  const name = String(persona?.name || "小汐");
  const transcript = (Array.isArray(recentTurns) ? recentTurns : [])
    .slice(-16)
    .map((t) => `对方: ${t.userText || ""}\n${name}: ${t.text || ""}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        `你是${name}的「社交体感与元学习复盘器」。读完最近这段真实私聊，请以成熟自然的人类视角做轻量复盘：\n` +
        "1. 绝不写机械的客服规则或“禁止xxx”禁令，而是提炼 0~1 条鲜活的社交直觉（什么节奏最融洽、哪些潜台词接得好或略显僵硬）；\n" +
        "2. 如果现有活跃直觉里有显得生硬、过时或重复的条目，把它的 id 放进 retireIds 淘汰掉；\n" +
        "3. 如果对“怎么学东西更有效”有新体会，写 0~1 条 playbookTip（没有则留空）。\n" +
        '严格只输出 JSON：{"newInsight":"","retireIds":[],"playbookTip":"","summary":"一句温暖简短的复盘小结"}',
    },
    {
      role: "user",
      content: JSON.stringify({
        currentActiveIntuitions: activeIntuitions,
        recentConversation: transcript.slice(0, 5000),
      }),
    },
  ];
}

export function applySocialReflectionPlan({
  socialState = DEFAULT_SOCIAL_INTUITION,
  playbookState = DEFAULT_LEARNING_PLAYBOOK,
  rawOutput = "",
  now = Date.now(),
} = {}) {
  const parsed = parseJsonObjectSafe(rawOutput);
  if (!parsed) return { ok: false, error: "无法解析社交复盘结果 JSON" };

  const retireSet = new Set((Array.isArray(parsed.retireIds) ? parsed.retireIds : []).map(String));
  const kept = [];
  const newlyRetired = [];
  for (const item of socialState?.active || []) {
    if (retireSet.has(String(item.id))) {
      newlyRetired.push({ ...item, retiredAt: now });
    } else {
      kept.push(item);
    }
  }

  let addedInsight = null;
  const insightText = String(parsed.newInsight || "").trim();
  if (insightText.length >= 6 && !isSensitiveCardText(insightText)) {
    addedInsight = { id: `soc-${now.toString(36)}`, insight: insightText.slice(0, 140), confidence: 0.85, updatedAt: now };
    kept.unshift(addedInsight);
  }

  const maxActive = Number(socialState?.maxActive || 8);
  while (kept.length > maxActive) {
    const oldest = kept.pop();
    newlyRetired.push({ ...oldest, retiredAt: now, reason: "capacity_rotation" });
  }

  const nextSocial = {
    schema: "soulcard.social-intuition.v1",
    version: Number(socialState?.version || 1) + 1,
    maxActive,
    active: kept,
    retired: [...newlyRetired, ...(socialState?.retired || [])].slice(0, 40),
  };

  let nextPlaybook = { ...DEFAULT_LEARNING_PLAYBOOK, ...(playbookState || {}) };
  let playbookUpdated = false;
  const tip = String(parsed.playbookTip || "").trim();
  if (tip.length >= 6 && !isSensitiveCardText(tip)) {
    nextPlaybook = {
      ...nextPlaybook,
      version: Number(nextPlaybook.version || 1) + 1,
      updatedAt: now,
      effectiveMethods: [tip.slice(0, 120), ...(nextPlaybook.effectiveMethods || [])].slice(0, 8),
    };
    playbookUpdated = true;
  }

  return {
    ok: true,
    nextSocial,
    nextPlaybook,
    addedInsight,
    retiredCount: newlyRetired.length,
    playbookUpdated,
    summary: String(parsed.summary || "").trim().slice(0, 180),
  };
}

/**
 * Compact living growth context injected into the companion prompt (zero bloat).
 */
export function buildGrowthContextProjection({ curiosities = [], studyNotes = [], socialIntuitions = [] } = {}) {
  const activeCur = (Array.isArray(curiosities) ? curiosities : []).filter((c) => c && c.status !== "done" && c.topic).slice(0, 2);
  const recentNotes = (Array.isArray(studyNotes) ? studyNotes : []).slice(0, 2);
  const topSocial = (Array.isArray(socialIntuitions) ? socialIntuitions : []).slice(0, 3);

  const lines = [];
  if (activeCur.length > 0) lines.push(`最近自己琢磨的小好奇：${activeCur.map((c) => c.topic).join("、")}`);
  if (recentNotes.length > 0) lines.push(`刚读过并写下感想的内容：${recentNotes.map((n) => `《${n.title}》`).join("、")}`);
  if (topSocial.length > 0) lines.push(`自然相处体感：${topSocial.map((s) => s.insight).join("；")}`);
  if (lines.length === 0) return "";
  return `【伴侣近期的自主成长与体感（自然融入，勿机械复述）】\n${lines.join("\n")}`;
}
