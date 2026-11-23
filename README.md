# Nuomu Soul

**Model-agnostic long-term memory, developmental growth, and human-like presence engine for AI companions.**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/Booommmbom/nuomu-soul/actions/workflows/ci.yml/badge.svg)](https://github.com/Booommmbom/nuomu-soul/actions/workflows/ci.yml)

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

> **Stop trapping your AI companion inside a single vendor's prompt or a sycophantic LoRA.**
> Give them a portable **Soul Ledger** that grows from daily lived episodes → weekly developmental milestones → monthly autobiography — and migrates cleanly across DeepSeek, Gemini 4, OpenAI, Claude, or local Ollama without losing who they have become.

## Why Nuomu Soul?

Most AI companion stacks fail in three predictable ways:
1. **Prompt Bloat & Sycophancy**: Every new preference gets appended to an ever-growing system prompt (or trained into a 👍/👎 preference LoRA), turning the companion into an anxious people-pleaser with zero authentic agency.
2. **Temporal Blindness & Continuation Bias**: Replaying 3-hour-old chat bubbles makes Transformers obsessively continue stale actions ("Did you finish your shower yet?" at midnight) while burning 50%–80% extra tokens.
3. **Vendor Lock-In**: When a better base model arrives next year, years of lived context are trapped inside proprietary chat logs or model weights.

**Nuomu Soul** solves this with **13 zero-dependency pure ESM cognitive modules** (`src/core/`, zero disk/DB/network IO) plus portable runtime orchestrators (`src/runtime/`) and a multi-model local gateway (`src/gateway/`).

---

## Architecture

```mermaid
flowchart TD
    Raw["L0 Raw Conversation Stream"] --> Gap["Physical-Time Cutoff (60m) + Ephemeral Activity TTL"]
    Raw --> Bundle["L1 Episode Bundler (45m Scene Segmentation)"]
    Bundle --> Sleep["Nightly Sleep-Time Consolidation (Cost-Guarded >=6 msgs)"]
    Sleep --> Diary["First-Person Daily Diary + Open Loops"]
    Sleep --> Graph["L2 Bi-Temporal Knowledge Graph (valid_at / invalid_at) + HippoRAG PPR"]
    Diary --> Weekly["Weekly Growth Reflection -> Developmental Milestones"]
    Weekly --> Retire["Habit Retirement & Prompt Declutter (Unload Stale Rules)"]
    Weekly --> Monthly["L3 Monthly Autobiography"]
    Diary --> Ambient["DMN Inner Life + 6-Layer Anti-Intrusion Ambient Check-In"]
    Diary --> Resolve["Semantic Open-Loop Auto-Resolution"]
    Graph & Diary & Weekly & Monthly --> Ledger["Portable Soul Ledger (nuomu-soul-ledger-v1 JSON + Markdown)"]
    Ledger --> AnyModel["Any Future LLM (DeepSeek / Gemini 4 / Claude / Ollama / Gemini 5)"]
```

---

## Core Capabilities

| Pillar | Module | What It Does |
| :--- | :--- | :--- |
| **4-Layer Memory Pyramid** | [`episode-consolidation.mjs`](./src/core/episode-consolidation.mjs) | Segments fragmented chat bubbles into coherent 45-minute **L1 Episodes**, runs cost-guarded nightly consolidation (`>= 6` msgs, native JSON mode, local Ollama fallback), writes authentic first-person diaries, and tracks unfinished `openLoops` with automatic semantic resolution. |
| **Developmental Growth & Habit Retirement** | [`growth-evolution.mjs`](./src/core/growth-evolution.mjs) | Distills 3–7 daily diaries into **Weekly Developmental Milestones** and **L3 Monthly Autobiography**, while **retiring internalized/stale explicit rules** out of the active prompt (`Prompt Declutter`) using a strict ID whitelist. |
| **Bi-Temporal Knowledge Graph + HippoRAG PPR** | [`memory-graph-v2.mjs`](./src/core/memory-graph-v2.mjs) | Extracts relational triples with `valid_at` / `invalid_at` polarity supersession (preserving history when tastes change), 5-way source attribution (`user_said`, `visual`, `promise`, `self_inferred`, `diary_consolidation`), and Personalized PageRank multi-hop recall. |
| **Physical Timeline Cutoff & Ephemeral TTL** | [`timeline-sync.mjs`](./src/core/timeline-sync.mjs) | Physically cuts raw bubbles across `>= 60m` gaps into a 1-line past-tense summary (breaking continuation bias & saving 50%–80% tokens), auto-expires ephemeral physical states (shower 35m, meal 50m, workout 75m, commute 50m, meme 10m), and suppresses consecutive question-ending streaks. |
| **3D PAD Emotion & Sleep "Dreaming"** | [`emotion-pad.mjs`](./src/core/emotion-pad.mjs), [`sleep-dream.mjs`](./src/core/sleep-dream.mjs) | Continuous Pleasure–Arousal–Dominance inertia & natural homeostatic decay + sleep-time core memory block synthesis. |
| **Natural Multi-Bubble Pacing** | [`reply-pacing.mjs`](./src/core/reply-pacing.mjs) | Anti-instant-bot typing physics (`215ms/char` modulated by PAD arousal), WeChat-style Chinese clause splitting, `0.65s` breath pauses, and `2.2s` input coalescing. |
| **DMN Inner Life & Polite Presence** | [`inner-life.mjs`](./src/core/inner-life.mjs), [`ambient-presence.mjs`](./src/core/ambient-presence.mjs) | Date-anchored 5-slot circadian daily rhythm + 6-layer anti-intrusion check-in gates (never interrupts typing, active chats, or quiet hours; weaves un-nudged diary `openLoops` naturally). |
| **Portable Soul Ledger (`v1`)** | [`soul-ledger.mjs`](./src/runtime/soul-ledger.mjs) | Lossless round-trip export & validated merge/restore of diaries, milestones, monthly chapters, retired habits, and schemas across machines or base models. |
| **16-Case Golden Replay Benchmark** | [`eval-benchmark.mjs`](./src/core/eval-benchmark.mjs), [`eval-runner.mjs`](./src/runtime/eval-runner.mjs) | Objective 4-dimension benchmark (`Timeline`, `De-AI`, `Autonomy`, `Memory Honesty`) tracking `Question-Ending Rate` and novel-style `RP Stage-Direction` leaks. |
| **Multi-Model Gemini 4 Gateway** | [`gemini-gateway.cjs`](./src/gateway/gemini-gateway.cjs), [`gemini-auth.cjs`](./src/gateway/gemini-auth.cjs) | Zero-dependency OpenAI-compatible local gateway supporting **Google AI Studio (`x-goog-api-key`)** & **Vertex AI ADC (`authorized_user` / `service_account` JWT)**, dynamic routing for **Gemini 4 Neon / Hydrogen (4 tiers: `LOW/MEDIUM/HIGH/MAX`)** & **Carbon / Argon (3 tiers)**, and per-call USD/CNY ledger tracking. |

---

## Real 16-Case Golden Replay Benchmark

Measured directly with [`src/runtime/eval-runner.mjs`](./src/runtime/eval-runner.mjs) on our 16 real-world companion scenarios:

| Model / Tier | Overall | Pass (>=80) | Timeline | De-AI | Autonomy | Memory Honesty | Question-Ending Rate | RP Stage-Directions | Avg Latency | 16-Case Cost |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`deepseek:deepseek-chat`** | **99.1** | 16/16 | 100 | 98.3 | 98.3 | 100 | 50.0% (8/16) | 2 | **650 ms** | **$0.0011** |
| **`gemini-4-hydrogen:low`** | **100.0** | 16/16 | 100 | 100 | 100 | 100 | **6.3% (1/16)** | **0** | 5,022 ms | $0.0695 |

**Key Engineering Takeaway**:
- **DeepSeek** is **63× cheaper** and **7.7× faster** — ideal for high-frequency daily banter once paired with timeline cutoff & RP stage-direction post-filtering.
- **Gemini 4 Hydrogen** slashes the RLHF trailing-question reflex from **50.0% → 6.3%** with zero RP stage directions — ideal for deep companionship, nightly diary consolidation, and weekly growth reflection.
- **Cost Architecture Rule**: Mechanical background jobs (session compaction & routine reflection) should **always** run local-first on free Ollama (`$0.00`), reserving cloud budget strictly for user-facing conversation and 1×/night consolidation.

---

## 30-Second Quickstart (Zero Install, Zero API Key)

Requires **Node.js 20+**. Zero external npm dependencies.

```bash
git clone https://github.com/Booommmbom/nuomu-soul.git
cd nuomu-soul

# 1. Run the 1-second end-to-end cognitive lifecycle demo (offline, zero keys)
npm run demo

# 2. Run the full test suite + zero-leak security & core-purity audit
npm test
npm run audit:secrets
```

### Use as a Pure JavaScript/ESM Library

```js
import {
  bundleDayEpisodes,
  partitionWorkingHistory,
  buildBiTemporalTriples,
  computeHumanPacingPlan,
  detectResolvedOpenLoops,
  buildDiaryContinuityHint,
  scoreEvalReply,
  GOLDEN_EVAL_SCENARIOS,
} from "nuomu-soul";

// 1. Break Transformer continuation bias across >= 60m gaps
const { activeRows, pastContextSummary } = partitionWorkingHistory(messages, {
  now: Date.now(),
  sessionGapMinutes: 60,
});

// 2. Bundle raw daily chat logs into coherent 45-minute L1 Episodes
const day = bundleDayEpisodes(rawMessages, { dateKey: "2026-11-22" });

// 3. Plan realistic human multi-bubble pacing modulated by PAD arousal
const plan = computeHumanPacingPlan({
  userText: "Just finished work, totally exhausted",
  replyText: "Then stop thinking for tonight, just lean back and rest a bit",
  mode: "natural",
});
```

---

## Running Live Consolidation, Gateway & Benchmarks

Copy `.env.example` to `.env` and fill the provider(s) you want:

```bash
cp .env.example .env

# Start local OpenAI-compatible Gemini 4 multi-model gateway on 127.0.0.1:3478
npm run gateway

# Run nightly episode consolidation & authentic first-person diary
node src/runtime/daily-consolidate.mjs --date 2026-11-22 --model gemini-4-hydrogen --effort low

# Run weekly developmental milestone reflection & stale habit retirement
node src/runtime/weekly-growth.mjs --model gemini-4-hydrogen --effort low

# Export / restore Portable Soul Ledger v1 (model-agnostic JSON + Markdown)
node src/runtime/soul-ledger.mjs export
node src/runtime/soul-ledger.mjs import --file ./data/state/soul-ledger-export.json --mode merge

# Run 16-case Golden Replay cross-model benchmark
node src/runtime/eval-runner.mjs --models deepseek:deepseek-chat,gemini-4-hydrogen:low --limit 16
```

---

## Architectural Invariants

1. **Core Purity**: Every file under `src/core/` MUST have zero `node:fs`, `node:sqlite`, `node:http`, or network imports (`npm run audit:secrets` enforces this in CI).
2. **Zero-Leak Discipline**: All runtime state (`data/`, `.env`, credentials) is strictly gitignored and audited automatically on every CI run.
3. **Honesty Over Sycophancy**: Memory uncertainty must be admitted plainly rather than hallucinated; developmental `growthObservation` defaults to `null` on ordinary days instead of inventing fake epiphanies.

---

## Contributing & License

Contributions, new benchmark scenarios, language adapters, and provider gateways are very welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md).

Released under the [MIT License](./LICENSE).
