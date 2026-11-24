#!/usr/bin/env node
// SoulCard — Zero-Dependency Interactive Terminal Companion Chat (`npm run chat`)
// Powered 100% by the standalone zero-dependency CompanionEngine.

import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CompanionEngine } from "./companion-engine.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)));
}

function createLineReader() {
  const rl = createInterface({ input, output: input.isTTY ? output : undefined, terminal: Boolean(input.isTTY) });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on("line", (line) => {
    if (waiters.length > 0) waiters.shift()(line);
    else queue.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length > 0) waiters.shift()(null);
  });
  return {
    async readLine(promptStr) {
      output.write(promptStr);
      if (queue.length > 0) {
        const v = queue.shift();
        if (!input.isTTY) output.write("\n");
        return v;
      }
      if (closed) return null;
      return await new Promise((res) => {
        waiters.push((v) => {
          if (!input.isTTY) output.write("\n");
          res(v);
        });
      });
    },
    close() { rl.close(); },
  };
}

export async function startCliChat({ dataDir = "", instant = false } = {}) {
  const engine = new CompanionEngine({ dataDir });
  const snap = engine.getSnapshot();
  const rl = createLineReader();

  console.log("\n==============================================================");
  console.log(`  SoulCard — Autonomous Companion Chat (${snap.persona.name})`);
  console.log(`  Engine: SoulCard Standalone v2 | Model: ${snap.llm.model} (${snap.llm.source}:${snap.llm.protocol})`);
  console.log(`  Mood: ${snap.pad.label} | Memory Facts: ${snap.stats.activeTripleCount} | Diaries: ${snap.stats.diaryCount}`);
  console.log("  Commands: /status  /diary  /weekly  /export  /reset  /quit");
  console.log("==============================================================\n");

  if (!snap.llm.configured) {
    console.log("提示：尚未配置中转站网址与 API Key，请先运行 `npm run setup` 或 `npm run web`。\n");
  }

  try {
    while (true) {
      const line = await rl.readLine("你 > ");
      if (line === null) break;
      const text = line.trim();
      if (!text) continue;

      if (text === "/quit" || text === "/exit") {
        console.log("\n下次见。\n");
        break;
      }
      if (text === "/help") {
        console.log("\n可用指令: /status(心智状态) /diary(生成今日日记) /weekly(周度成长复盘) /export(导出灵魂账本) /reset(彻底清空记忆) /quit(退出)\n");
        continue;
      }
      if (text === "/status") {
        const s = engine.getSnapshot();
        console.log(`\n[状态] 情绪=${s.pad.label}(P=${s.pad.pleasure}/A=${s.pad.arousal}/D=${s.pad.dominance}) | 生活流=${s.innerLife.activity}`);
        console.log(`[记忆] 对话轮次=${s.stats.turnCount} | 活跃事实=${s.stats.activeTripleCount} | 历史演变=${s.stats.historicalTripleCount} | 日记=${s.stats.diaryCount} | 惦记=${s.stats.activeOpenLoopCount}\n`);
        continue;
      }
      if (text === "/diary") {
        console.log("\n正在执行睡前情景打包与日记生成...");
        const r = await engine.consolidateDaily({ force: true, minMessages: 2 });
        console.log(r.skipped ? `跳过: ${r.reason}\n` : `✔ 日记已写入: ${r.markdownPath}\n${r.record?.diaryEntry || ""}\n`);
        continue;
      }
      if (text === "/weekly") {
        console.log("\n正在执行周度成长复盘与旧规矩减负...");
        const r = await engine.consolidateWeekly({ force: true });
        console.log(r.skipped ? `跳过: ${r.reason}\n` : `✔ 周里程碑已写入: ${r.markdownPath}\n${r.record?.milestone || ""}\n`);
        continue;
      }
      if (text === "/export") {
        const r = engine.exportSoul();
        console.log(`\n✔ 灵魂账本 v1 已导出: ${r.exportPath} (${JSON.stringify(r.stats)})\n`);
        continue;
      }
      if (text === "/reset") {
        engine.resetMemory({ keepPersona: true });
        console.log("\n✔ 已彻底清空记忆与对话历史（保留人设与 .env 配置，无任何黑盒残留）。\n");
        continue;
      }

      const res = await engine.chat(text, { pacingMode: instant ? "instant" : "" });
      if (!res.ok) {
        console.log(`\n[错误] ${res.error}\n`);
        continue;
      }

      const bubbles = res.pacing?.bubbles || [{ text: res.reply, delayMs: 0 }];
      for (let i = 0; i < bubbles.length; i += 1) {
        if (!instant && i > 0 && bubbles[i].delayMs > 0) {
          await sleep(Math.min(1800, bubbles[i].delayMs));
        }
        console.log(`${snap.persona.name} > ${bubbles[i].text}`);
      }
      if (res.resolvedOpenLoops?.length > 0) {
        console.log(`   [自动消号惦记: ${res.resolvedOpenLoops.map((x) => x.text).join(" / ")}]`);
      }
      console.log("");
    }
  } finally {
    rl.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const instant = process.argv.includes("--instant");
  startCliChat({ instant }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
