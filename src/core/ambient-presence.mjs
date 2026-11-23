// Ambient Companion Presence & Polite Check-in Engine (Limbic Social Drive Simulation)
// Pure core module: ZERO fs / sqlite / channel / network imports.
// Decides when Nuomu should gently check in on desktop with strict anti-intrusion guards.

import { describePadEmotion } from "./emotion-pad.mjs";
import { snapshotInnerLife } from "./inner-life.mjs";

function isInQuietHours(now, quietStartHour = 0.5, quietEndHour = 8.5) {
  const d = new Date(Number(now) || Date.now());
  const h = d.getHours() + d.getMinutes() / 60;
  if (quietStartHour < quietEndHour) {
    return h >= quietStartHour && h < quietEndHour;
  }
  return h >= quietStartHour || h < quietEndHour;
}

/**
 * Evaluate whether Nuomu should gently initiate a desktop check-in right now.
 * Strictly protects user focus: never interrupts typing, active chats, quiet sleep hours,
 * or double-texts when an earlier message went unanswered.
 */
export function evaluateAmbientCheckIn({
  now = Date.now(),
  lastUserAt = 0,
  lastAssistantAt = 0,
  lastAmbientAt = 0,
  isTyping = false,
  isSending = false,
  enabled = true,
  dueCommitments = [],
  activeOpenLoops = [],
  minIdleMinutes = 45,
  ambientCooldownMinutes = 105,
  unansweredBlockHours = 4,
  quietStartHour = 0.5,
  quietEndHour = 8.5,
} = {}) {
  const nowMs = Number(now) || Date.now();
  if (!enabled) return { shouldCheckIn: false, reason: "disabled" };
  if (isTyping || isSending) return { shouldCheckIn: false, reason: "user-busy" };

  // High-priority exception: timed commitment alarm due right now
  if (Array.isArray(dueCommitments) && dueCommitments.length > 0) {
    return {
      shouldCheckIn: true,
      kind: "commitment_due",
      reason: "due-commitment",
      commitment: dueCommitments[0],
    };
  }

  if (isInQuietHours(nowMs, quietStartHour, quietEndHour)) {
    return { shouldCheckIn: false, reason: "quiet-hours" };
  }

  const uAt = Number(lastUserAt) || 0;
  const aAt = Number(lastAssistantAt) || 0;
  const ambAt = Number(lastAmbientAt) || 0;
  const lastAnyChat = Math.max(uAt, aAt);

  // Never intrude if user & Nuomu just chatted recently
  if (lastAnyChat > 0 && nowMs - lastAnyChat < minIdleMinutes * 60000) {
    return { shouldCheckIn: false, reason: "recent-chat" };
  }

  // Respect cooldown between two ambient check-ins
  if (ambAt > 0 && nowMs - ambAt < ambientCooldownMinutes * 60000) {
    return { shouldCheckIn: false, reason: "ambient-cooldown" };
  }

  // Never double-text if Nuomu spoke last and user hasn't replied within 4 hours
  if (aAt > uAt && nowMs - aAt < unansweredBlockHours * 3600000) {
    return { shouldCheckIn: false, reason: "awaiting-reply" };
  }

  // Prefer an un-nudged diary openLoop when available (feels genuinely remembered!)
  const unNudgedLoop = (Array.isArray(activeOpenLoops) ? activeOpenLoops : []).find(
    (l) => l && l.text && (!l.nudgedAt || Number(l.nudgedAt) === 0) && (!l.expiresAt || Number(l.expiresAt) > nowMs)
  );
  if (unNudgedLoop) {
    return {
      shouldCheckIn: true,
      kind: "diary_open_loop",
      reason: "diary-open-loop",
      openLoop: unNudgedLoop,
    };
  }

  return {
    shouldCheckIn: true,
    kind: "gentle_checkin",
    reason: "ambient-window",
  };
}

/**
 * Compose a concise, natural, zero-assistant-speak check-in line grounded in Nuomu's
 * current inner-life activity, diary openLoops, and PAD emotion state.
 */
export function composeAmbientCheckInMessage({
  now = Date.now(),
  innerLife = null,
  pad = null,
  dueCommitment = null,
  openLoop = null,
} = {}) {
  if (dueCommitment && dueCommitment.content) {
    const content = String(dueCommitment.content).trim().slice(0, 60);
    return `哎，到点啦，你之前让我提醒你的「${content}」，别忙着忙着忘掉咯`;
  }

  if (openLoop && openLoop.text) {
    const raw = String(openLoop.text)
      .trim()
      .replace(/^(?:问问对方|问对方|问问|等对方|记得|把)/, "")
      .replace(/[。！!]+$/, "")
      .slice(0, 48);
    if (raw) {
      return `对了，刚发呆忽然想起一件事，${raw}呀`;
    }
  }

  const snap = snapshotInnerLife(innerLife, now);
  const desc = describePadEmotion(pad || {});
  const hour = new Date(Number(now) || Date.now()).getHours();
  const act = String(snap?.current?.activity || "").trim();

  if (hour >= 23 || hour < 1) {
    return act
      ? `这么晚了你还在电脑前呀，我刚${act.slice(0, 20)}，忙完手头这块记得早点歇着哦`
      : "这么晚了还在忙呀，眼睛别盯太久屏幕，忙完早点歇着吧";
  }
  if (hour >= 12 && hour < 14) {
    return "中午啦，手头那块先放一放呗，吃午饭了没？";
  }
  if (hour >= 18 && hour < 20) {
    return act
      ? `傍晚了，我刚才${act.slice(0, 22)}，你晚饭吃点啥呀？`
      : "天都暗下来了，你晚上打算吃点啥呀？";
  }
  if (desc.label === "舒缓温柔" || desc.label === "安静心疼") {
    return "刚安静了一会儿，过来看看你还在忙不，累了就靠着歇两分钟呀";
  }
  if (act) {
    return `刚${act.slice(0, 24)}，顺便探个头看看你在折腾什么呢`;
  }
  return "刚忙完手头一小块，探头看看你这边进展得顺不顺呀";
}
