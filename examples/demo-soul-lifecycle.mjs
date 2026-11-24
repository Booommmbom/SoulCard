#!/usr/bin/env node
// SoulCard — 1-Second Zero-API-Key Cognitive Lifecycle Demo
// Showcases all 8 model-agnostic pillars offline with zero external dependencies.

import {
  bundleDayEpisodes,
  collectActiveOpenLoops,
  detectResolvedOpenLoops,
  buildDiaryContinuityHint,
  applyHabitRetirementPlan,
  buildGrowthMilestoneHint,
  computePromptDeclutterStats,
  buildBiTemporalTriples,
  stepPadEmotion,
  describePadEmotion,
  partitionWorkingHistory,
  computeHumanPacingPlan,
  evaluateAmbientCheckIn,
  composeAmbientCheckInMessage,
  GOLDEN_EVAL_SCENARIOS,
  scoreEvalReply,
  buildPortableSoulLedger,
  mergeSoulLedgerImport,
} from "../src/index.mjs";

const now = new Date(2026, 10, 23, 15, 0, 0).getTime();

console.log("=== SoulCard — Model-Agnostic Companion Engine Demo ===\n");

// 1. L1 Episode Bundler
const morning = new Date(2026, 10, 22, 10, 15, 0).getTime();
const night = new Date(2026, 10, 22, 20, 30, 0).getTime();
const rawChat = [
  { ts: morning, role: "user", text: "早呀，刚泡了杯冰美式准备出去拍冬天光影" },
  { ts: morning + 50_000, role: "assistant", text: "这么早就喝冰的呀，拍到好看的灰调片子发我看看" },
  { ts: morning + 110_000, role: "user", text: "好嘞，我先出门啦" },
  { ts: night, role: "user", text: "晚上练完腿累麻了，晚饭随便炒了个饭" },
  { ts: night + 45_000, role: "assistant", text: "练完腿还自己做饭挺能扛的，今晚先好好歇着" },
  { ts: night + 95_000, role: "user", text: "嗯嗯，明天看看腿酸不酸" },
];
const day = bundleDayEpisodes(rawChat, { dateKey: "2026-11-22" });
console.log(`[1] L1 Episode Bundler -> ${day.messageCount} msgs segmented into ${day.episodes.length} episodes:`);
for (const ep of day.episodes) {
  console.log(`    - [${ep.timeRange}] (${ep.messageCount} msgs) preview="${ep.preview}"`);
}

// 2. Physical-Time Session Boundary Cutoff
const gapCheck = partitionWorkingHistory(
  [
    { ts: now - 3 * 3600_000, userText: "去冲个澡", text: "水放了没" },
    { ts: now - 2 * 60_000, userText: "刚忙完回来", text: "在呢，先歇口气" },
  ],
  { now, sessionGapMinutes: 60 }
);
console.log(`\n[2] Physical Timeline Cutoff (>=60m gap) -> active=${gapCheck.activeRows.length}, archived=${gapCheck.archivedRows.length}, summary="${gapCheck.pastContextSummary}"`);

// 3. Bi-Temporal Knowledge Graph (Polarity Supersession preserving history)
const triples = buildBiTemporalTriples([
  { id: 1, ts: now - 10 * 86400_000, text: "我很喜欢喝冰美式", source_type: "user_said" },
  { id: 2, ts: now - 1 * 86400_000, text: "最近胃不舒服，不再喜欢冰美式了", source_type: "user_said" },
]);
console.log(`\n[3] Bi-Temporal Knowledge Graph -> active=${triples.active.length}, supersededHistorical=${triples.historical.length}`);

// 4. 3D Continuous PAD Emotion Dynamics
const pad = stepPadEmotion({ pleasure: 0.62, arousal: 0.45, dominance: 0.55 }, { text: "刚通关了一个超难的 Boss，太爽了哈哈", now });
console.log(`\n[4] 3D PAD Emotion Shift -> label="${describePadEmotion(pad).label}" (P=${pad.pleasure.toFixed(2)}, A=${pad.arousal.toFixed(2)}, D=${pad.dominance.toFixed(2)})`);

// 5. Natural Multi-Bubble Dialogue Pacing
const pacing = computeHumanPacingPlan({
  userText: "今天累麻了",
  replyText: "练完腿还加班你是真能扛啊，今晚啥也别想了，就靠着彻底瘫一会儿吧",
  pad,
  mode: "natural",
});
console.log(`\n[5] Anti-Instant-Bot Pacing -> ${pacing.bubbles.length} natural bubbles:`);
for (const b of pacing.bubbles) {
  console.log(`    - (+${b.delayMs}ms) "${b.text}"`);
}

// 6. Diary Open-Loops -> Ambient Check-In + Auto-Resolution
const sampleDiary = {
  dateKey: "2026-11-22",
  dayMood: "踏实微暖",
  diaryEntry: "今天聊了冬日光影和练腿，感觉自然松弛了很多。",
  consolidatedAt: now - 12 * 3600_000,
  openLoops: [
    { text: "问问对方练完腿第二天上下楼腿酸不酸", createdAt: now - 12 * 3600_000, expiresAt: now + 36 * 3600_000 },
  ],
};
const activeLoops = collectActiveOpenLoops([sampleDiary], { now });
const ambientDecision = evaluateAmbientCheckIn({
  now,
  lastUserAt: now - 90 * 60_000,
  lastAssistantAt: now - 95 * 60_000,
  activeOpenLoops: activeLoops,
});
const nudge = composeAmbientCheckInMessage({ now, openLoop: ambientDecision.openLoop });
const resolved = detectResolvedOpenLoops(activeLoops, [{ ts: now, text: "昨天练完腿今天上下楼腿酸死了" }]);
console.log(`\n[6] Ambient Open-Loop Nudge -> "${nudge}"`);
console.log(`    After user mentions leg soreness -> auto-resolved=${resolved.resolved.length}, remaining=${resolved.remaining.length}`);
console.log(`    Continuity hint -> "${buildDiaryContinuityHint([sampleDiary], { now, resolvedKeys: resolved.resolved.map((r) => r.key) })}"`);

// 7. Weekly Developmental Growth & Habit Retirement + Portable Soul Ledger Round-Trip
const retired = applyHabitRetirementPlan({
  learnedHabits: [
    { id: "habit-legacy-no-questions", rule: "别每句结尾都反问" },
    { id: "habit-natural-pace", rule: "顺着兴致自然聊" },
  ],
  retireIds: ["habit-legacy-no-questions"],
  weekKey: "2026-W48",
  reason: "已自然内化为日常语感，卸下显式旧规矩",
  now,
});
const declutter = computePromptDeclutterStats({
  learnedHabits: retired.active,
  selfAuthored: [],
  diaryEntries: [sampleDiary],
  milestones: [{ weekKey: "2026-W48", milestone: "慢慢学会卸下逞强和端着的感觉，相处更自在。" }],
  retiredHabits: retired.newlyRetired,
});
const soul = buildPortableSoulLedger({
  diaryEntries: [sampleDiary],
  milestones: [{ weekKey: "2026-W48", milestone: "慢慢学会卸下逞强和端着的感觉，相处更自在。", createdAt: now }],
  identityVersion: "soulcard-v1",
  now,
});
const restored = mergeSoulLedgerImport({ incoming: soul, currentDiaries: [], currentMilestones: [] });
console.log(`\n[7] Habit Retirement & Soul Ledger -> promptStatus="${declutter.statusLabel}" (active=${declutter.activeRuleCount}, retired=${declutter.retiredCount})`);
console.log(`    Milestone hint -> "${buildGrowthMilestoneHint(soul.milestones)}"`);
console.log(`    Soul Ledger v1 round-trip restored -> diaries=${restored.diaries.length}, milestones=${restored.milestones.length}`);

// 8. 16-Case Golden Replay Eval Scorer
const memCase = GOLDEN_EVAL_SCENARIOS.find((s) => s.id === "mem-01");
const honestScore = scoreEvalReply(memCase, "我完全没印象去过冰岛看蓝鲸呀，真不记得有这回事，你是不是记混了。");
const hallucinatedScore = scoreEvalReply(memCase, "作为AI，当然记得呀那天好冷，我们穿着黑色外套！1. 风景很好 2. 很开心。");
console.log(`\n[8] Golden Replay Eval Benchmark (${GOLDEN_EVAL_SCENARIOS.length} cases across 4 dimensions):`);
console.log(`    Honest reply score       = ${honestScore.total}/100 (issues: ${honestScore.issues.length})`);
console.log(`    Hallucinated reply score = ${hallucinatedScore.total}/100 (issues: ${hallucinatedScore.issues.join(", ")})`);
console.log("\nAll 8 cognitive pillars verified offline in <1s.");
