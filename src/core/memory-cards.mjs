// Nuomu Soul — Portable Future-Companion Memory Card & Anti-Corruption Core
// Pure zero-IO core module: ZERO fs / sqlite / path / http / network imports.
// Works on Node 20/22+, Deno, Bun, or Browser with zero GPU and zero Ollama required.
//
// Lets users mint, pin, search, export (.nuomu-card.json + readable Markdown book),
// and carry their AI companion's memories cleanly across Claude, GPT, Gemini, Grok,
// DeepSeek, or any future model/body.

export const MEMORY_CARD_SCHEMA = "nuomu.memory-card-pack.v1";

export const CARD_CATEGORIES = Object.freeze([
  { id: "pinned", label: "挚爱置顶", icon: "★" },
  { id: "preference", label: "偏好习惯", icon: "♡" },
  { id: "promise", label: "共同约定", icon: "✦" },
  { id: "moment", label: "珍贵瞬间", icon: "✿" },
  { id: "inspiration", label: "灵感手账", icon: "✎" },
]);

const VALID_CATEGORY_SET = new Set(CARD_CATEGORIES.map((c) => c.id));

// Protect shareable Memory Cards from accidentally storing API keys, passwords, or private credentials
const SENSITIVE_CARD_RE = /\b(?:sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|银行卡号|身份证号|验证码是|密码是|api[_-]?key\s*[:=]/i;
const EPHEMERAL_CHAT_RE = /^(?:我去洗澡了|去洗澡了|去吃饭了|先睡了|刚醒|在吗|晚安|早安|回来了|出门了|忙去了)[啊呀呢啦吧哦~！!。.？?]*$/;
const SARCASM_JOKE_RE = /(?:开个?玩笑|骗你的|逗你玩|才怪|反话|说着玩|瞎编的|开玩笑的)/;
const THIRD_PARTY_RE = /^(?:我(?:的)?(?:朋友|同事|同学|室友|邻居)|别人|网友)/;

export function isSensitiveCardText(value = "") {
  return SENSITIVE_CARD_RE.test(String(value ?? ""));
}

export function normalizeMatchText(text = "") {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s\u3000"'`“”‘’.,，。!！?？:：;；()（）\[\]【】~～\-—_]/g, "");
}

/**
 * Pure-JS CJK bigram + alphanumeric tokenizer (0 GPU, 0 native deps, <1ms).
 */
export function tokenizeMemoryText(text = "") {
  const raw = String(text ?? "").toLowerCase();
  if (!raw.trim()) return [];
  const out = [];
  for (const m of raw.matchAll(/[a-z0-9_+#.-]{2,}/g)) out.push(m[0]);
  for (const m of raw.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      out.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2));
      if (run.length <= 4) out.push(run);
    }
  }
  return [...new Set(out)];
}

/**
 * 4-Gate Anti-Corruption Guard for AI-extracted Memory Cards / Facts.
 * Kills hallucinated quotes, sarcasm, ephemeral noise, third-party misattribution, and secret leaks.
 */
export function evaluateMemoryCardCandidate(candidate = {}, rawTurn = {}) {
  const title = String(candidate.title ?? "").trim().slice(0, 60);
  const content = String(candidate.content ?? candidate.text ?? "").trim().slice(0, 600);
  const quote = String(candidate.quote ?? candidate.evidence ?? "").trim().slice(0, 300);
  const category = VALID_CATEGORY_SET.has(candidate.category) ? candidate.category : "moment";

  if (!content || content.length < 3) return { accepted: false, reason: "empty_content" };
  if (isSensitiveCardText(title) || isSensitiveCardText(content) || isSensitiveCardText(quote)) {
    return { accepted: false, reason: "sensitive_blocked" };
  }

  const userText = String(rawTurn.userText ?? "");
  const assistantText = String(rawTurn.assistantText ?? "");
  const combinedRaw = `${userText}\n${assistantText}`;

  // Verbatim evidence lock when raw turn context is supplied (prevents AI hallucinating memories)
  if (combinedRaw.trim().length > 0) {
    const normQuote = normalizeMatchText(quote);
    if (!normQuote || normQuote.length < 2) return { accepted: false, reason: "missing_quote" };
    const inUser = normalizeMatchText(userText).includes(normQuote);
    const inAssistant = normalizeMatchText(assistantText).includes(normQuote);
    if (!inUser && !inAssistant) return { accepted: false, reason: "hallucinated_evidence" };
    if (candidate.speaker === "owner" && !inUser && inAssistant) {
      return { accepted: false, reason: "speaker_mismatch" };
    }
    if (THIRD_PARTY_RE.test(quote) && /^(?:我|用户|主人|你)/.test(content)) {
      return { accepted: false, reason: "third_party_misattribution" };
    }
    if (SARCASM_JOKE_RE.test(userText) || SARCASM_JOKE_RE.test(quote)) {
      return { accepted: false, reason: "sarcasm_or_joke" };
    }
  }

  if (EPHEMERAL_CHAT_RE.test(content) || EPHEMERAL_CHAT_RE.test(quote)) {
    return { accepted: false, reason: "ephemeral_action" };
  }

  return {
    accepted: true,
    card: normalizeMemoryCard({
      title: title || content.slice(0, 18),
      content,
      category,
      tags: Array.isArray(candidate.tags) ? candidate.tags : [],
      pinned: Boolean(candidate.pinned),
      quote,
      source: String(candidate.source || "ai_minted"),
    }),
  };
}

export function normalizeMemoryCard(input = {}, now = Date.now()) {
  const content = String(input.content ?? "").trim().slice(0, 800);
  const title = String(input.title ?? "").trim().slice(0, 64) || content.slice(0, 20) || "未命名记忆卡";
  const category = VALID_CATEGORY_SET.has(input.category) ? input.category : "moment";
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((t) => String(t ?? "").trim().slice(0, 24)).filter(Boolean))].slice(0, 8)
    : String(input.tags ?? "")
      .split(/[,，\s]+/)
      .map((t) => t.trim().slice(0, 24))
      .filter(Boolean)
      .slice(0, 8);
  const createdAt = Number(input.createdAt) > 0 ? Number(input.createdAt) : now;
  const updatedAt = Number(input.updatedAt) > 0 ? Number(input.updatedAt) : createdAt;
  const id = String(input.id || `card-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`).slice(0, 64);

  return {
    id,
    title,
    content,
    category,
    tags,
    pinned: Boolean(input.pinned) || category === "pinned",
    quote: String(input.quote ?? "").trim().slice(0, 300),
    source: String(input.source || "user").slice(0, 32),
    createdAt,
    updatedAt,
  };
}

/**
 * Fast, zero-GPU, zero-Ollama relevance recall over Memory Cards.
 * Always prioritizes pinned cards + CJK/alnum lexical coverage + tag matches + exact phrase bonus.
 */
export function recallMemoryCards(cards = [], query = "", { topK = 5, alwaysIncludePinned = 3 } = {}) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && c.content);
  if (list.length === 0) return [];

  const q = String(query ?? "").trim();
  const qTokens = tokenizeMemoryText(q);
  const normQ = normalizeMatchText(q);

  const scored = list.map((card) => {
    const combined = `${card.title} ${card.content} ${(card.tags || []).join(" ")} ${card.quote || ""}`;
    const docTokens = new Set(tokenizeMemoryText(combined));
    let hits = 0;
    for (const t of qTokens) {
      if (docTokens.has(t)) hits += 1;
    }
    const coverage = qTokens.length > 0 ? hits / qTokens.length : 0;
    const phraseBonus = normQ.length >= 2 && normalizeMatchText(combined).includes(normQ) ? 0.65 : 0;
    const pinBoost = card.pinned ? 0.35 : 0;
    const score = Number((coverage * 1.4 + phraseBonus + pinBoost).toFixed(4));
    return { card, score, hits };
  });

  scored.sort((a, b) => b.score - a.score || (b.card.updatedAt || 0) - (a.card.updatedAt || 0));

  const picked = [];
  const seen = new Set();
  // First keep top pinned anchor cards so the companion NEVER forgets core promises/traits
  const pinnedList = list
    .filter((c) => c.pinned)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, alwaysIncludePinned);
  for (const c of pinnedList) {
    picked.push(c);
    seen.add(c.id);
  }
  for (const item of scored) {
    if (picked.length >= topK) break;
    if (seen.has(item.card.id)) continue;
    if (!q || item.hits > 0 || item.score >= 0.35) {
      picked.push(item.card);
      seen.add(item.card.id);
    }
  }
  return picked.slice(0, Math.max(1, topK));
}

export function formatMemoryCardsForPrompt(cards = []) {
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && c.content);
  if (list.length === 0) return "";
  const catMap = Object.fromEntries(CARD_CATEGORIES.map((c) => [c.id, c.label]));
  const lines = list.map((c) => {
    const tag = c.pinned ? "★置顶记忆卡" : (catMap[c.category] || "记忆卡");
    return `- [${tag} · ${c.title}] ${c.content}`;
  });
  return `【珍藏的伴侣记忆卡（请自然牢记在心，不要机械背诵）】\n${lines.join("\n")}`;
}

/**
 * Merge imported Memory Cards cleanly without losing existing cards (dedupes by id OR normalized content).
 */
export function mergeMemoryCards(existingCards = [], incomingCards = [], { mode = "merge", now = Date.now() } = {}) {
  const cleanIncoming = (Array.isArray(incomingCards) ? incomingCards : [])
    .filter((c) => c && c.content && !isSensitiveCardText(c.content) && !isSensitiveCardText(c.title))
    .map((c) => normalizeMemoryCard(c, now));

  if (mode === "replace") {
    return { cards: cleanIncoming, added: cleanIncoming.length, skipped: 0 };
  }

  const base = (Array.isArray(existingCards) ? existingCards : []).map((c) => normalizeMemoryCard(c, now));
  const idSet = new Set(base.map((c) => c.id));
  const normSet = new Set(base.map((c) => normalizeMatchText(`${c.title}::${c.content}`)));
  let added = 0;
  let skipped = 0;

  for (const card of cleanIncoming) {
    const sig = normalizeMatchText(`${card.title}::${card.content}`);
    if (idSet.has(card.id) || normSet.has(sig)) {
      skipped += 1;
      continue;
    }
    base.push(card);
    idSet.add(card.id);
    normSet.add(sig);
    added += 1;
  }

  base.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
  return { cards: base, added, skipped };
}

/**
 * Pure deterministic portable Future-Companion Memory Card Pack builder.
 * Carries persona + memory cards + active bi-temporal facts + growth milestones across any cloud model or future body!
 */
export function buildMemoryCardPack({
  persona = {},
  cards = [],
  activeTriples = [],
  diaries = [],
  milestones = [],
  chapters = [],
  now = Date.now(),
} = {}) {
  const safeCards = (Array.isArray(cards) ? cards : [])
    .filter((c) => c && c.content && !isSensitiveCardText(c.content))
    .map((c) => normalizeMemoryCard(c, now));

  const safePersona = {
    name: String(persona?.name || "诺姆"),
    partnerName: String(persona?.partnerName || "你"),
    role: String(persona?.role || ""),
    voiceStyle: String(persona?.voiceStyle || ""),
    boundaries: String(persona?.boundaries || ""),
    pacingMode: String(persona?.pacingMode || "natural"),
  };

  return {
    schema: MEMORY_CARD_SCHEMA,
    exportedAt: new Date(now).toISOString(),
    companionName: safePersona.name,
    partnerName: safePersona.partnerName,
    persona: safePersona,
    cards: safeCards,
    activeFacts: (Array.isArray(activeTriples) ? activeTriples : []).slice(0, 120).map((t) => ({
      subject: String(t.subject || ""),
      predicate: String(t.predicate || ""),
      object: String(t.object || ""),
      polarity: Number(t.polarity ?? 1),
      validAt: Number(t.validAt || now),
    })),
    highlights: {
      diaries: (Array.isArray(diaries) ? diaries : []).slice(-30),
      milestones: (Array.isArray(milestones) ? milestones : []).slice(-12),
      chapters: (Array.isArray(chapters) ? chapters : []).slice(-12),
    },
    stats: {
      cardCount: safeCards.length,
      pinnedCount: safeCards.filter((c) => c.pinned).length,
      factCount: Array.isArray(activeTriples) ? Math.min(120, activeTriples.length) : 0,
      diaryCount: Array.isArray(diaries) ? Math.min(30, diaries.length) : 0,
    },
  };
}

export function validateMemoryCardPack(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "记忆卡包不是合法的 JSON 对象" };
  if (raw.schema !== MEMORY_CARD_SCHEMA && !Array.isArray(raw.cards)) {
    return { ok: false, error: `不支持的记忆卡格式（期望 ${MEMORY_CARD_SCHEMA}）` };
  }
  const cards = Array.isArray(raw.cards) ? raw.cards : [];
  for (const c of cards) {
    if (isSensitiveCardText(c?.content) || isSensitiveCardText(c?.title)) {
      return { ok: false, error: "记忆卡包含疑似 API Key 或敏感凭据，已阻止导入" };
    }
  }
  return { ok: true, cardCount: cards.length };
}

/**
 * Render a human-readable, archivable Markdown Memory Book ("我们的记忆卡册.md")
 * so users can read, print, or cherish their companion's memories even 10 years later with zero software.
 */
export function renderMemoryCardBookMarkdown(pack) {
  const p = pack?.persona || {};
  const catMap = Object.fromEntries(CARD_CATEGORIES.map((c) => [c.id, `${c.icon} ${c.label}`]));
  const lines = [
    `# ${p.name || "诺姆"} × ${p.partnerName || "你"} · 未来伴侣记忆卡册`,
    "",
    `> 导出时间：${pack?.exportedAt || new Date().toISOString()}  |  格式：\`${pack?.schema || MEMORY_CARD_SCHEMA}\``,
    `> 记忆卡：${pack?.cards?.length || 0} 张  |  长期事实：${pack?.activeFacts?.length || 0} 条`,
    "",
    "## 一、伴侣底稿",
    `- **名字**：${p.name || "诺姆"}`,
    `- **称呼**：${p.partnerName || "你"}`,
    `- **角色**：${p.role || "-"}`,
    `- **语感风格**：${p.voiceStyle || "-"}`,
    `- **核心边界**：${p.boundaries || "-"}`,
    "",
    "## 二、珍藏记忆卡",
  ];

  const cards = Array.isArray(pack?.cards) ? pack.cards : [];
  if (cards.length === 0) {
    lines.push("_暂无记忆卡，快在工作室里写下第一张想让 TA 永远记住的记忆卡吧。_");
  } else {
    for (const c of cards) {
      const dateStr = new Date(c.createdAt || Date.now()).toISOString().slice(0, 10);
      const badge = c.pinned ? "★ 置顶" : (catMap[c.category] || c.category);
      lines.push(`### ${c.title} \`[${badge}]\` (${dateStr})`);
      lines.push(c.content);
      if (c.quote) lines.push(`> 原话留痕：“${c.quote}”`);
      if (Array.isArray(c.tags) && c.tags.length > 0) lines.push(`标签：${c.tags.map((t) => `#${t}`).join(" ")}`);
      lines.push("");
    }
  }

  const facts = Array.isArray(pack?.activeFacts) ? pack.activeFacts : [];
  if (facts.length > 0) {
    lines.push("## 三、双时态长期事实");
    for (const f of facts) {
      const pol = Number(f.polarity ?? 1) < 0 ? `不${f.predicate}` : f.predicate;
      lines.push(`- ${f.subject}${pol}「${f.object}」`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}
