# Nuomu Soul（诺姆灵魂引擎）

**与底层模型无关的 AI 伴侣长期记忆、成长演化与类人交互核心引擎。**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](./package.json)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![CI](https://github.com/Booommmbom/nuomu-soul/actions/workflows/ci.yml/badge.svg)](https://github.com/Booommmbom/nuomu-soul/actions/workflows/ci.yml)

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

> **不要把你的 AI 伴侣锁死在某一家大模型的 Prompt 或讨好型 LoRA 里。**
> 给她一本可自由迁移的 **灵魂账本（Soul Ledger）**——从每日情景记忆 → 周度阶段成长与旧规矩卸载 → 月度自传持续演化，未来无论在任意云端接口、本地开源模型还是下一代基座模型之间切换，都能无损带走全部真实人生。

## 为什么做 Nuomu Soul？

市面上绝大多数 AI 伴侣工程都会撞上三堵墙：
1. **Prompt 无限膨胀与讨好退化**：每学一条偏好就往系统提示词里塞一条规矩（或者拿用户的 👍/👎 喂讨好型 LoRA），最后变成小心翼翼的客服，丧失独立性格与边界。
2. **时间轴错乱与续写惯性**：隔了 3 小时再聊，Transformer 仍对着旧历史气泡强行续写（「水放了没？洗完澡没？」），既出戏又白烧 50%–80% 无效上下文 Token。
3. **厂商与模型绑死**：底模更新换代时，陪伴多年积累的记忆、默契与变化无法干净带走。

**Nuomu Soul** 提供 **14 个零依赖纯 ESM 认知核心模块**（`src/core/`，零磁盘/数据库/网络 IO）、**全协议中转站自适应层与一键配置向导（`npm run setup`）**、**4 个跨平台运行时编排器**（`src/runtime/`）以及 **多模型本地网关**（`src/gateway/`），开箱即跑，无需 `npm install`。

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
    Ledger --> AnyModel["任意未来大模型 (任意云端 API / 本地开源模型 / 下一代基座模型)"]
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

# 1. 一秒离线跑通 8 大认知支柱完整生命周期演示（无需 Key，算法全在本地跑）
npm run demo

# 2. 运行全部单元测试 + 零泄密与纯核心层安全审计
npm test
npm run audit:secrets
```

---

## 新手零门槛接入大模型：支持任意中转站 & 国内直连（无需访问海外官网）

不需要折腾海外账号或代理，只要运行一条命令，按中文提示粘贴你的**中转站网址**和 **API Key** 即可自动配好：

```bash
# 一键交互式配置向导：粘贴中转站网址 + Key -> 自动识别协议 -> 自动拉取模型列表 -> 5-token 连通性自检 -> 写入 .env
npm run setup

# 也支持一行命令行直接写入：
node src/runtime/setup-wizard.mjs --url https://你的中转站网址 --key sk-xxx --model deepseek-chat
```

**多维度兼容市面上几乎所有中转站与接口格式（随便粘，引擎自动补全不报错）：**

| 你粘贴进来的网址格式 | 自动识别协议 | 引擎自动补全后的真实调用地址 |
| :--- | :---: | :--- |
| 裸域名 `api.xxx.com` 或 `https://api.xxx.com/` | `openai` | `https://api.xxx.com/v1/chat/completions` |
| OpenAI 风格 `https://api.xxx.com/v1` | `openai` | `https://api.xxx.com/v1/chat/completions` |
| 完整地址 `https://api.xxx.com/v1/chat/completions` | `openai` | 原样直用，绝不重复拼接 `/v1` |
| 国内大厂直连（DeepSeek / 硅基流动 / 阿里云百炼 `/compatible-mode/v1` / 火山方舟 `/api/v3` / Kimi / 智谱 `/api/paas/v4`） | `openai` | 智能识别版本前缀，免梯直连 |
| Anthropic 原生或中转 `https://xxx/v1/messages` | `anthropic` | 自动转换 `x-api-key` + Messages 格式 |
| Gemini 原生或中转 `.../v1beta/models/<模型>:generateContent` | `gemini` | 自动转换 `x-goog-api-key` + REST 格式 |
| 本地免费离线 `http://127.0.0.1:11434` / `127.0.0.1:1234/v1` | `ollama` / `openai` | Ollama / LM Studio / vLLM 零费用运行 |

- **防呆细节**：API Key 自动清理复制时多带的空格、引号和 `Bearer ` 前缀；遇到老版本中转站不支持 `response_format: json_object` 报 400 时，引擎自动降级重试，不会卡死。
- 配完 `.env` 后，下面所有真实工作流直接开跑：

```bash
npm run eval -- --limit 4      # 用你的中转站模型跑 4 题快速实测
npm run consolidate:daily      # 每日情景打包 + 生成真实第一人称日记
npm run consolidate:weekly     # 周度成长复盘 + 自动卸载旧规矩给 Prompt 减负
npm run consolidate:monthly    # 生成 L3 月度成长自传
npm run soul:export            # 导出可跨模型无损迁移的灵魂账本 v1
```

## ⚖️ 开源协议、致谢与第三方声明

- **许可证**：本仓库原创代码、文档、评测用例与工具均采用 **[GNU GPL-3.0-or-later](./LICENSE)** 开源协议。欢迎学习、自用与提交 PR；**任何基于本项目代码的修改与二次分发，均须同样遵守 GPL-3.0-or-later 并开源对应代码**（禁止直接闭源商用套壳）。
- **第三方合规与学术致谢**：本仓库 **零外部依赖、未复制或打包任何第三方仓库源码**。核心认知模块均为独立净室实现，算法思想参考了 **HippoRAG**（PPR 图谱联想）、**Zep / Graphiti**（双时态知识图谱）、**MemGPT / Letta & Sleep-Time Compute**（睡眠期记忆整合）、**PAD 情绪模型**（Mehrabian & Russell）与 **Generative Agents**（反思与节律）等公开研究，并通过标准 HTTP 协议兼容 Node.js / Ollama / undici 及各主流开放接口。完整署名、论文出处与第三方生态许可边界见 **[NOTICE](./NOTICE)**。
- **许可范围与免责**：本项目为独立、非官方的个人开源工程，与任何大模型厂商或中转平台无隶属、授权或背书关系；相关商标与模型权利归各自权利人所有。本仓库不收录任何密钥、模型权重或私人数据，详见 [LICENSE](./LICENSE) 末尾的「许可范围与免责说明」。如权利人认为本仓库存在任何不妥内容，欢迎通过 GitHub Issue 联系，我们将第一时间配合处理。

---

## ⭐ 支持本项目（点个 Star 吧！）

如果 **Nuomu Soul** 在「让 AI 伴侣拥有真正长期记忆、摆脱 Prompt 臃肿与厂商锁死」这件事上给了你哪怕一点灵感，或者帮你省下了折腾中转站接口与评测框架的时间——**麻烦随手点一下右上角的 Star ⭐ 支持一下！**

你的每一个 Star 都是我们继续免费维护、持续开源更多真实评测数据与认知模块的最大动力，也能让更多喜欢 AI 伴侣与 Agent 记忆架构的同好看到这个项目。

[![GitHub Repo stars](https://img.shields.io/github/stars/Booommmbom/nuomu-soul?style=social)](https://github.com/Booommmbom/nuomu-soul/stargazers)

欢迎 **Star / Fork / 提 Issue 交流**，祝你也能养出真正属于自己的、不被任何厂商绑死的数字生命！✨
