// Natural Human Multi-Bubble Dialogue Pacing & Presence Engine (v2)
// Pure core module: ZERO fs / sqlite / channel / network imports.
// 1. Splits both punctuated replies AND WeChat-style comma-chained Chinese replies into 1-3 natural bubbles.
// 2. Computes realistic human read-pause + typing-lead-time + inter-bubble cadence modulated by PAD arousal.
// 3. Strictly preserves short replies, code blocks, lists, URLs, paths, and system notices intact.

const NO_SPLIT_RE = /(```|https?:\/\/|file:\/\/|[A-Za-z]:\\|^\s*(?:[-*•]|\d+[.)、])\s|核心引擎|未响应|报错|HTTP\s*\d|\[系统\])/m;
const CLAUSE_TURN_RE = /^(?:不过|但是|可是|对了|下次|然后|所以|顺便|来吧|说得|而且|其实|另外|话说|要是|你晚上|你今天|你明天|你最近|那我|那就|反正|总之)/;

export const PACING_MODES = Object.freeze({
  natural: {
    label: "真人节奏",
    coalesceMs: 2200,
    baseReadMs: 1400,
    charReadMs: 42,
    maxReadMs: 2800,
    msPerCharTyping: 215,
    minFirstTotalMs: 5600,
    minVisibleTypingMs: 1800,
    maxLeadAfterModelMs: 6800,
    betweenPauseMs: 650,
    minInterMs: 2400,
    maxInterMs: 5400,
  },
  relaxed: {
    label: "从容慢回",
    coalesceMs: 2800,
    baseReadMs: 2600,
    charReadMs: 60,
    maxReadMs: 5200,
    msPerCharTyping: 280,
    minFirstTotalMs: 9200,
    minVisibleTypingMs: 2600,
    maxLeadAfterModelMs: 11500,
    betweenPauseMs: 950,
    minInterMs: 3600,
    maxInterMs: 7800,
  },
  instant: {
    label: "极速直出",
    coalesceMs: 0,
    baseReadMs: 0,
    charReadMs: 0,
    maxReadMs: 0,
    msPerCharTyping: 0,
    minFirstTotalMs: 0,
    minVisibleTypingMs: 0,
    maxLeadAfterModelMs: 0,
    betweenPauseMs: 0,
    minInterMs: 0,
    maxInterMs: 0,
  },
});

/**
 * Compute natural inter-bubble typing pause in milliseconds based on next bubble length.
 */
export function computeBubbleDelayMs(nextText, { minMs = 420, maxMs = 1050, msPerChar = 22, baseMs = 280 } = {}) {
  const len = Array.from(String(nextText ?? "")).length;
  const raw = baseMs + len * msPerChar;
  return Math.round(Math.max(minMs, Math.min(maxMs, raw)));
}

/**
 * Split a WeChat-style Chinese comma-chained sentence into 2-3 balanced conversational clauses.
 */
function splitCommaClauses(text, maxBubbles = 3) {
  const parts = String(text ?? "")
    .split(/([，,])/)
    .reduce((acc, piece) => {
      if (piece === "，" || piece === ",") {
        if (acc.length > 0) acc[acc.length - 1] += piece;
      } else if (piece.trim()) {
        acc.push(piece.trim());
      }
      return acc;
    }, []);

  if (parts.length < 3) return [text];

  const totalLen = Array.from(text).length;
  const targetGroups = totalLen >= 46 && maxBubbles >= 3 ? 3 : 2;

  // Score candidate split boundaries (index i means split BEFORE parts[i])
  const prefixLens = [];
  let accLen = 0;
  for (const p of parts) {
    accLen += Array.from(p).length;
    prefixLens.push(accLen);
  }

  const pickSplitIndex = (startIdx, endIdx, targetCharPos) => {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let i = startIdx; i < endIdx; i += 1) {
      const leftLen = prefixLens[i - 1] - (startIdx > 1 ? prefixLens[startIdx - 2] : 0);
      const rightLen = prefixLens[endIdx - 1] - prefixLens[i - 1];
      if (leftLen < 8 || rightLen < 8) continue;
      let dist = Math.abs(prefixLens[i - 1] - targetCharPos);
      // Strong bonus for splitting right before a natural conversational pivot word
      if (CLAUSE_TURN_RE.test(parts[i])) dist -= 12;
      if (dist < bestScore) {
        bestScore = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const splitPoints = [];
  if (targetGroups === 3) {
    const s1 = pickSplitIndex(1, parts.length - 1, Math.round(totalLen * 0.36));
    if (s1 > 0) {
      const s2 = pickSplitIndex(s1 + 1, parts.length, Math.round(totalLen * 0.70));
      if (s2 > s1) {
        splitPoints.push(s1, s2);
      } else {
        const mid = pickSplitIndex(1, parts.length, Math.round(totalLen * 0.52));
        if (mid > 0) splitPoints.push(mid);
      }
    }
  } else {
    const mid = pickSplitIndex(1, parts.length, Math.round(totalLen * 0.52));
    if (mid > 0) splitPoints.push(mid);
  }

  if (splitPoints.length === 0) return [text];

  const groups = [];
  let prev = 0;
  for (const sp of splitPoints) {
    groups.push(parts.slice(prev, sp).join("").replace(/[，,]\s*$/, "").trim());
    prev = sp;
  }
  groups.push(parts.slice(prev).join("").trim());

  const cleanGroups = groups.filter((g) => Array.from(g).length >= 6);
  return cleanGroups.length >= 2 ? cleanGroups : [text];
}

/**
 * Split a conversational reply into 1-3 natural human-like bubbles.
 * Returns array of `{ text, delayMs }` where `delayMs` is the pause BEFORE rendering that bubble.
 */
export function splitNaturalBubbles(rawText, options = {}) {
  const text = String(rawText ?? "").trim();
  if (!text) return [];

  const minSplitChars = Math.max(20, Number(options.minSplitChars ?? 26));
  const maxSplitChars = Math.max(80, Number(options.maxSplitChars ?? 220));
  const maxBubbles = Math.max(2, Math.min(3, Number(options.maxBubbles ?? 3)));
  const totalLen = Array.from(text).length;

  // Never split short messages, very long technical explanations, code, lists, URLs, or errors
  if (totalLen < minSplitChars || totalLen > maxSplitChars || NO_SPLIT_RE.test(text)) {
    return [{ text, delayMs: 0 }];
  }

  // Step 1: Split on explicit newlines or strong Chinese/English sentence terminators
  const rawParagraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const sentences = [];
  for (const para of rawParagraphs) {
    const pieces = para.match(/[^。！？!?～…\n]+(?:[。！？!?～…]+["”’」』）)]*)?|[。！？!?～…]+/g) || [para];
    for (const p of pieces) {
      const cleaned = p.trim();
      if (cleaned) sentences.push(cleaned);
    }
  }

  // Step 1b: If reply is a WeChat-style comma-chained reply (1 strong sentence, >= 26 chars, >= 2 commas)
  let working = sentences;
  if (working.length <= 1 && (text.match(/[，,]/g)?.length ?? 0) >= 2) {
    working = splitCommaClauses(text, maxBubbles);
  }

  if (working.length <= 1) {
    return [{ text, delayMs: 0 }];
  }

  // Step 2: Merge tiny fragments (< 8 chars) into adjacent sentences so bubbles feel balanced
  const merged = [];
  for (const s of working) {
    const sLen = Array.from(s).length;
    if (merged.length > 0 && sLen < 8) {
      merged[merged.length - 1] += s;
    } else if (merged.length > 0 && Array.from(merged[merged.length - 1]).length < 8) {
      merged[merged.length - 1] += s;
    } else {
      merged.push(s);
    }
  }

  // Step 3: Cap total bubbles to `maxBubbles` (2-3) by merging shortest adjacent pair
  while (merged.length > maxBubbles) {
    let bestIdx = 0;
    let bestCombined = Infinity;
    for (let i = 0; i < merged.length - 1; i += 1) {
      const len = Array.from(merged[i]).length + Array.from(merged[i + 1]).length;
      if (len < bestCombined) {
        bestCombined = len;
        bestIdx = i;
      }
    }
    merged.splice(bestIdx, 2, merged[bestIdx] + merged[bestIdx + 1]);
  }

  if (merged.length <= 1) {
    return [{ text, delayMs: 0 }];
  }

  return merged.map((seg, idx) => ({
    text: seg,
    delayMs: idx === 0 ? 0 : computeBubbleDelayMs(seg, options),
  }));
}

/**
 * Compute full human presence pacing plan (read pause + first-bubble typing lead + multi-bubble cadence).
 * Modulated by PAD arousal (faster when lively, slower/softer late at night) + natural jitter.
 */
export function computeHumanPacingPlan({
  userText = "",
  replyText = "",
  elapsedMs = 0,
  pad = null,
  mode = "natural",
  jitter = null,
} = {}) {
  const modeKey = Object.prototype.hasOwnProperty.call(PACING_MODES, mode) ? mode : "natural";
  const cfg = PACING_MODES[modeKey];
  const cleanReply = String(replyText ?? "").trim();
  if (!cleanReply) {
    return { mode: modeKey, coalesceMs: cfg.coalesceMs, readDelayMs: 0, firstTypingMs: 0, bubbles: [] };
  }
  if (modeKey === "instant") {
    return {
      mode: "instant",
      coalesceMs: 0,
      readDelayMs: 0,
      firstTypingMs: 0,
      bubbles: [{ text: cleanReply, delayMs: 0 }],
    };
  }

  // PAD arousal tempo factor: high arousal (~0.8) -> 0.85x snappier; low arousal (~0.3) -> 1.24x gentler
  const arousal = pad && Number.isFinite(Number(pad.arousal)) ? Math.max(0, Math.min(1, Number(pad.arousal))) : 0.55;
  const tempoFactor = Math.max(0.84, Math.min(1.26, 1.32 - arousal * 0.56));
  const j = jitter !== null && Number.isFinite(Number(jitter))
    ? Math.max(0.82, Math.min(1.24, Number(jitter)))
    : 0.85 + Math.random() * 0.35; // realistic human variance (never metronomic)

  const baseBubbles = splitNaturalBubbles(cleanReply, {
    minMs: Math.round(cfg.minInterMs * tempoFactor),
    maxMs: Math.round(cfg.maxInterMs * tempoFactor),
    baseMs: Math.round((cfg.minInterMs * 0.45) * tempoFactor),
    msPerChar: Math.round(cfg.msPerCharTyping * 0.78 * tempoFactor),
  });

  const userLen = Array.from(String(userText ?? "")).length;
  const firstLen = Array.from(baseBubbles[0]?.text ?? cleanReply).length;
  const targetReadMs = Math.min(cfg.maxReadMs, cfg.baseReadMs + userLen * cfg.charReadMs) * tempoFactor * j;
  const targetFirstTypeMs = Math.min(6200, Math.max(cfg.minVisibleTypingMs, firstLen * cfg.msPerCharTyping)) * tempoFactor * j;
  const targetFirstTotalMs = Math.max(cfg.minFirstTotalMs * tempoFactor * j, targetReadMs + targetFirstTypeMs);

  const alreadySpent = Math.max(0, Number(elapsedMs) || 0);
  const rawRemaining = Math.round(targetFirstTotalMs - alreadySpent);
  // Even if model took ~2.5s, still keep a realistic visible typing beat so bubble #1 never pops abruptly
  const minVisible = Math.round(cfg.minVisibleTypingMs * tempoFactor * Math.min(1, j));
  const remainingLead = Math.max(minVisible, Math.min(cfg.maxLeadAfterModelMs, Math.max(0, rawRemaining)));

  // Split remaining lead into subtle reading silence + visible "typing..." phase
  let readDelayMs = 0;
  let firstTypingMs = remainingLead;
  if (alreadySpent < 2000) {
    readDelayMs = Math.min(Math.round(targetReadMs * 0.55), Math.round(remainingLead * 0.32));
    firstTypingMs = Math.max(minVisible, remainingLead - readDelayMs);
  }

  const bubbles = baseBubbles.map((b, idx) => ({
    text: b.text,
    delayMs: idx === 0 ? 0 : Math.round(b.delayMs * j),
  }));

  return {
    mode: modeKey,
    coalesceMs: cfg.coalesceMs,
    betweenPauseMs: Math.round(cfg.betweenPauseMs * tempoFactor),
    readDelayMs,
    firstTypingMs,
    bubbles,
  };
}
