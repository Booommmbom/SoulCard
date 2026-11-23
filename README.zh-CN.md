# Nuomu Soul（诺姆灵魂引擎）

**与底层模型无关的 AI 伴侣长期记忆、成长演化与类人交互核心引擎。**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/Booommmbom/nuomu-soul/actions/workflows/ci.yml/badge.svg)](https://github.com/Booommmbom/nuomu-soul/actions/workflows/ci.yml)

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

> **不要把你的 AI 伴侣锁死在某一家大模型的 Prompt 或讨好型 LoRA 里。**
> 给她一本可自由迁移的 **灵魂账本（Soul Ledger）**——从每日情景记忆 → 周度阶段成长与旧规矩卸载 → 月度自传持续演化，未来无论从 DeepSeek 换到 Gemini 4、Claude、本地 Ollama 还是下一代旗舰模型，都能无损带走全部真实人生。

## 为什么做 Nuomu Soul？

市面上绝大多数 AI 伴侣工程都会撞上三堵墙：
1. **Prompt 无限膨胀与讨好退化**：每学一条偏好就往系统提示词里塞一条规矩（或者拿用户的 👍/👎 喂讨好型 LoRA），最后变成小心翼翼的客服，丧失独立性格与边界。
2. **时间轴错乱与续写惯性**：隔了 3 小时再聊，Transformer 仍对着旧历史气泡强行续写（「水放了没？洗完澡没？」），既出戏又白烧 50%–80% 无效上下文 Token。
3. **厂商与模型绑死**：底模更新换代时，陪伴多年积累的记忆、默契与变化无法干净带走。

**Nuomu Soul** 提供 **13 个零依赖纯 ESM 认知核心模块**（`src/core/`，零磁盘/数据库/网络 IO）、**4 个跨平台运行时编排器**（`src/runtime/`）以及 **多模型 Gemini 4 本地网关**（`src/gateway/`），开箱即跑，无需 `npm install`。

---

## 核心架构

```mermaid
flowchart TD
    Raw["L0 原始对话流"] --> Gap["物理时间轴截断 (60m) + 瞬时行为 TTL"]
    Raw --> Bundle["L1 情景打包器 (45分钟自然断段)"]
    Bundle --> Sleep["夜间睡眠整理 (低成本闸门 >=6条)"]
    Sleep --> Diary["真实第一人称睡前日记 + 心里惦记(Open Loops)"]
    Sleep --> Graph["L2 双时态知识图谱 (valid_at/invalid_at) + HippoRAG PPR"]
    Diary --> Weekly["周度成长复盘 -> 阶段成长里程碑"]
    Weekly --> Retire["旧规矩自然卸载 & Prompt 减负"]
    Weekly --> Monthly["L3 月度成长自传"]
    Diary --> Ambient["DMN 日常生活流 + 6层防打扰主动轻敲"]
    Diary --> Resolve["惦记事项语义自动消号"]
    Graph & Diary & Weekly & Monthly --> Ledger["模型无关灵魂账本 (nuomu-soul-ledger-v1 JSON + Markdown)"]
    Ledger --> AnyModel["任意未来大模型 (DeepSeek / Gemini 4 / Claude / Ollama / Gemini 5)"]
```

---

## 八大核心能力

1. **四层模型无关记忆金字塔（`episode-consolidation.mjs`）**：按 45 分钟自然断段把碎片聊天打包成 L1 情景段；每日低成本睡眠整理（`< 6` 条自动跳过，原生 JSON 输出，离线自动降级本地 Ollama），产出真实第一人称日记、带原文依据的双时态事实、以及带自然过期 TTL 的「心里惦记（`openLoops`）」。
2. **成长演化与旧规矩自然卸载（`growth-evolution.mjs`）**：周度复盘把多日日记升华为阶段里程碑，同时按严格白名单把已内化的刻板旧规矩移出活跃 Prompt（归档保留历史），彻底避免 Prompt 越用越臃肿；支持每月沉淀 L3 月度自传。
3. **双时态知识图谱 + HippoRAG PPR（`memory-graph-v2.mjs`）**：当用户口味或习惯改变时保留历史脉络（`valid_at` / `invalid_at` 极性覆盖），支持 5 类记忆来源归因与多跳联想召回。
4. **物理时间轴截断 + 瞬时行为 TTL（`timeline-sync.mjs`）**：跨 `>= 60` 分钟未聊自动切出陈旧历史气泡压成 1 句过去时背景（直省 50%–80% Token），洗澡/吃饭/健身/通勤/表情包超期自动归档，并抑制闭源模型连续句尾反问习惯。
5. **3D PAD 连续情绪动力学 + 睡眠期做梦整理（`emotion-pad.mjs` / `sleep-dream.mjs`）**：愉悦度–唤醒度–支配度连续情绪惯性与稳态回落。
6. **反秒回拟人多气泡节律（`reply-pacing.mjs`）**：基于真实中文敲字速度（`215ms/字`）与 PAD 唤醒度调制的阅读停顿、微信体逗号自然断泡、`0.65s` 泡间呼吸间隙与 `2.2s` 连发防抢答合并窗。
7. **内生生活流 DMN + 6 层防打扰轻敲 + 惦记自动消号（`inner-life.mjs` / `ambient-presence.mjs`）**：绝不打断打字、活跃聊天与深夜睡眠，把未轻敲的日记惦记自然揉进问候，聊完后自动语义消号不翻旧账。
8. **16 题真实黄金回放评测 + 多模型 Gemini 4 网关（`eval-benchmark.mjs` / `gemini-gateway.cjs`）**：客观量化时间轴、去 AI 味、自主边界、记忆诚实性、句尾反问率与 RP 括号旁白；网关同时支持 Google AI Studio 与 Vertex AI ADC（绕过企业组织禁用静态 API Key 限制），动态路由 Neon/Hydrogen（4 档）与 Carbon/Argon（3 档）并按美元/人民币逐笔透明记账。

---

## 16 题真实黄金回放实测数据

使用 [`src/runtime/eval-runner.mjs`](./src/runtime/eval-runner.mjs) 实跑对比结果：

| 模型 / 档位 | 综合总分 | 通过(>=80) | 时间轴 | 去AI味 | 自主边界 | 记忆诚实 | **句尾反问率** | **RP括号旁白** | 平均耗时 | 16 题实耗 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`deepseek:deepseek-chat`** | **99.1** | 16/16 | 100 | 98.3 | 98.3 | 100 | 50.0% (8/16) | 2 次 | **650 ms** | **$0.0011 (¥0.008)** |
| **`gemini-4-hydrogen:low`** | **100.0** | 16/16 | 100 | 100 | 100 | 100 | **6.3% (1/16)** | **0 次** | 5,022 ms | $0.0695 (¥0.501) |

---

## 30 秒极速体验（零依赖、无需任何 API Key）

需要 **Node.js 20+**，无需 `npm install`：

```bash
git clone https://github.com/Booommmbom/nuomu-soul.git
cd nuomu-soul

# 1. 一秒离线跑通 8 大认知支柱完整生命周期演示（无需 Key）
npm run demo

# 2. 运行全部单元测试 + 零泄密与纯核心层安全审计
npm test
npm run audit:secrets
```

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。欢迎 Issue、PR 和新的跨模型评测样本！
