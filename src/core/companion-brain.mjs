// SoulCard — Pure Zero-IO Companion Brain Orchestrator (Standalone Autonomous Core)
// Composes all cognitive pillars into a deterministic, testable, vendor-agnostic prompt
// assembly & reply post-processing pipeline without touching disk, SQLite, or network.

import { describePadEmotion, formatPadShort, stepPadEmotion } from "./emotion-pad.mjs";
import { buildDiaryContinuityHint } from "./episode-consolidation.mjs";
import { buildGrowthMilestoneHint, buildMonthlyChapterHint } from "./growth-evolution.mjs";
import { buildGrowthContextProjection } from "./growth-learning.mjs";
import { formatInnerLifeForPrompt, snapshotInnerLife } from "./inner-life.mjs";
import { extractConceptTokens } from "./memory-cognition.mjs";
import { formatMemoryCardsForPrompt, isSensitiveCardText, recallMemoryCards } from "./memory-cards.mjs";
import { buildBiTemporalTriples, runPersonalizedPageRank } from "./memory-graph-v2.mjs";
import { computeHumanPacingPlan } from "./reply-pacing.mjs";
import { buildAntiQuestionStreakHint, formatClockTag, partitionWorkingHistory } from "./timeline-sync.mjs";

export const DEFAULT_PERSONA = Object.freeze({
  name: "小汐",
  partnerName: "你",
  role: "住在电脑里的独立生活伴侣与默契老友",
  voiceStyle: "说话像真实微信私聊：自然、简短、口语化、有温度也有小主见和小脾气；绝不说客服套话、绝不列123清单、绝不写小说式括号动作旁白。",
  boundaries: "记忆诚实第一：完全记不得的事就直说记不得，绝不瞎编迎合；亲近不等于无条件顺从，也不说教催睡；别每句结尾都机械反问。",
  pacingMode: "natural",
});

// Strip novel-style RP parenthetical stage directions like （笑） / （往后缩了缩） / *smiles*
const RP_STAGE_RE = /[（(][^）)\n]{0,16}(?:笑|叹|眨|托腮|歪头|点头|摇头|伸懒腰|打哈欠|翻白眼|往后缩|凑近|轻声|小声|沉默|发呆|挑眉|捂脸|摸头|撇嘴)[^）)\n]{0,12}[）)]/g;

/**
 * Clean mechanical AI clichés and RP stage directions while preserving authentic voice.
 */
export function cleanCompanionReply(rawText = "") {
  let s = String(rawText ?? "").trim();
  if (!s) return "";
  s = s.replace(RP_STAGE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  // Remove accidental leading speaker label such as "小汐：" or "Assistant:"
  s = s.replace(/^(?:小汐|伴侣|assistant|ai|bot)\s*[:：]\s*/i, "").trim();
  return s;
}

/**
 * Retrieve top relevant bi-temporal facts (plus superseded historical context if relevant)
 * for the current user utterance via HippoRAG-style Personalized PageRank.
 */
export function recallBiTemporalContext({
  userText = "",
  memoryEvents = [],
  now = Date.now(),
  topK = 5,
} = {}) {
  const built = buildBiTemporalTriples(memoryEvents, { now });
  if (built.active.length === 0 && built.historical.length === 0) {
    return { activeTriples: [], historicalTriples: [], recalled: [], promptBlock: "" };
  }

  const seeds = extractConceptTokens(userText, { stripNegation: false });
  const ranked = seeds.length > 0
    ? runPersonalizedPageRank({ seeds, triples: built.active, topK: 10 })
    : [];
  const rankedNodes = new Set(ranked.map((r) => r.node));

  // Score active triples by direct token overlap + PPR associative score + confidence
  const scored = built.active.map((t) => {
    let score = Number(t.confidence || 0.75);
    const obj = String(t.object || "");
    if (obj && String(userText).includes(obj)) score += 2.5;
    if (rankedNodes.has(obj)) score += 1.4;
    if (seeds.some((s) => obj.includes(s) || s.includes(obj))) score += 1.0;
    return { triple: t, score };
  });
  scored.sort((a, b) => b.score - a.score || (b.triple.validAt || 0) - (a.triple.validAt || 0));

  const recalled = scored.slice(0, Math.max(1, topK)).map((x) => x.triple);
  const lines = recalled.map((t) => {
    const pol = Number(t.polarity ?? 1) < 0 ? `不${t.predicate}` : t.predicate;
    return `- ${t.subject}${pol}「${t.object}」`;
  });

  // Mention relevant superseded history cleanly ("formerly X, now Y")
  const relevantHist = built.historical
    .filter((h) => recalled.some((a) => a.object === h.object && a.predicate === h.predicate))
    .slice(0, 2);
  for (const h of relevantHist) {
    const pol = Number(h.polarity ?? 1) < 0 ? `曾不${h.predicate}` : `曾${h.predicate}`;
    lines.push(`- （历史演变）${h.subject}${pol}「${h.object}」，后来已改变`);
  }

  const promptBlock = lines.length > 0 ? `【已知的长期事实与偏好（双时态图谱）】\n${lines.join("\n")}` : "";
  return {
    activeTriples: built.active,
    historicalTriples: built.historical,
    recalled,
    promptBlock,
  };
}

/**
 * Determine whether a user utterance carries durable preference/fact signal worth recording in L2 memory events.
 */
export function shouldCaptureMemoryEvent(userText = "") {
  const s = String(userText ?? "").trim();
  if (s.length < 4) return false;
  if (isSensitiveCardText(s)) return false;
  if (/(?:开个?玩笑|骗你的|逗你玩|才怪|反话)/.test(s)) return false;
  return /(?:喜欢|讨厌|不爱|不再|戒了|正在做|在做|打算|准备|约定|说好|答应|下次|平时|最爱|过敏|害怕|工作|健身|练腿|拍照|修图|游戏|猫|狗|名字叫|叫我)/.test(s);
}

/**
 * Assemble the complete model-agnostic system + conversation messages array for a single turn.
 * Pure function: zero side effects, deterministic given `now`.
 */
export function assembleCompanionPrompt({
  userText = "",
  historyTurns = [],
  persona = DEFAULT_PERSONA,
  pad = null,
  memoryEvents = [],
  memoryCards = [],
  growthDesk = null,
  diaryEntries = [],
  milestones = [],
  monthlyChapters = [],
  resolvedOpenLoopKeys = [],
  sessionSummary = "",
  now = Date.now(),
  sessionGapMinutes = 60,
  maxActiveTurns = 12,
} = {}) {
  const p = { ...DEFAULT_PERSONA, ...(persona || {}) };
  const nextPad = stepPadEmotion(pad, { text: userText, now });
  const padDesc = describePadEmotion(nextPad);
  const innerLife = snapshotInnerLife(now);

  // 1. Physical timeline cutoff: flush >= 60m old bubbles into 1 compact past-tense background sentence
  const timeline = partitionWorkingHistory(historyTurns, { now, sessionGapMinutes });
  const activeTurns = timeline.activeRows.slice(-Math.max(2, maxActiveTurns));

  // 2. Trailing question streak guard
  const antiQuestionHint = buildAntiQuestionStreakHint(activeTurns);

  // 3. Bi-temporal knowledge graph + HippoRAG PPR recall
  const graph = recallBiTemporalContext({ userText, memoryEvents, now, topK: 5 });

  // 3b. Portable Memory Cards recall (pinned anchors + query-matched cards)
  const recalledCards = recallMemoryCards(memoryCards, userText, { topK: 5, alwaysIncludePinned: 3 });
  const cardsBlock = formatMemoryCardsForPrompt(recalledCards);

  // 4. Hierarchical continuity hints (Daily -> Weekly -> Monthly + Living Growth Desk)
  const diaryHint = buildDiaryContinuityHint(diaryEntries, { now, resolvedKeys: resolvedOpenLoopKeys });
  const weeklyHint = buildGrowthMilestoneHint(milestones);
  const monthlyHint = buildMonthlyChapterHint(monthlyChapters);
  const growthProjection = growthDesk ? buildGrowthContextProjection(growthDesk) : "";

  const systemSections = [
    `你叫${p.name}，是${p.role}。你面对的对话对象是${p.partnerName}。`,
    `【说话风格】${p.voiceStyle}`,
    `【核心边界】${p.boundaries}`,
    `【此刻现实时间】${formatClockTag(now)}`,
    `【你此刻的情绪状态】${formatPadShort(nextPad)} — ${padDesc.toneHint}`,
    formatInnerLifeForPrompt(innerLife),
  ];

  if (sessionSummary && String(sessionSummary).trim()) {
    systemSections.push(`【更早会话摘要】${String(sessionSummary).trim().slice(0, 420)}`);
  }
  if (timeline.pastContextSummary) {
    systemSections.push(timeline.pastContextSummary);
  }
  if (cardsBlock) systemSections.push(cardsBlock);
  if (growthProjection) systemSections.push(growthProjection);
  if (monthlyHint) systemSections.push(monthlyHint);
  if (weeklyHint) systemSections.push(weeklyHint);
  if (diaryHint) systemSections.push(diaryHint);
  if (graph.promptBlock) {
    systemSections.push(graph.promptBlock);
  } else if (memoryEvents.length === 0 && diaryEntries.length === 0 && recalledCards.length === 0) {
    systemSections.push("【记忆现实约束】当前长期记忆库为空。如果对方问起过去的事，请直接诚实地说现在还没有相关记忆，绝对不要装作记得或编造细节。");
  }

  if (antiQuestionHint) {
    systemSections.push(antiQuestionHint);
  }

  const messages = [{ role: "system", content: systemSections.filter(Boolean).join("\n\n") }];

  for (const turn of activeTurns) {
    if (turn.userText) messages.push({ role: "user", content: String(turn.userText) });
    if (turn.text) messages.push({ role: "assistant", content: String(turn.text) });
  }
  messages.push({ role: "user", content: String(userText ?? "").trim() });

  return {
    messages,
    nextPad,
    innerLife,
    timeline,
    graph,
    recalledCards,
    antiQuestionTriggered: Boolean(antiQuestionHint),
    promptChars: messages.reduce((sum, m) => sum + m.content.length, 0),
  };
}

/**
 * Post-process raw LLM output into cleaned natural text + human multi-bubble pacing plan.
 */
export function postprocessCompanionReply({
  userText = "",
  rawReply = "",
  pad = null,
  pacingMode = "natural",
  elapsedMs = 0,
  jitter = null,
} = {}) {
  const reply = cleanCompanionReply(rawReply);
  const pacing = computeHumanPacingPlan({
    userText,
    replyText: reply,
    pad,
    mode: pacingMode,
    elapsedMs,
    jitter,
  });
  return { reply, pacing };
}
