#!/usr/bin/env node
// Nuomu Soul — Zero-Friction Interactive Setup Wizard (中转站 / 国内直连 / 本地模型 一键配置向导)
// Guides beginners to paste ANY relay URL & API key in any format, auto-detects wire protocol,
// discovers available models via /v1/models, runs a live 5-token connectivity check, and writes `.env`.
//
// Interactive usage:
//   npm run setup
// Non-interactive CLI usage:
//   node src/runtime/setup-wizard.mjs --url https://your-relay.com --key sk-xxx --model deepseek-chat [--protocol auto] [--no-test]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_PRESETS,
  detectProtocol,
  maskApiKey,
  normalizeApiKey,
  normalizeBaseUrl,
  resolveChatEndpoint,
} from "../core/provider-compat.mjs";
import { listRemoteModels, testLlmConnection } from "./llm-client.mjs";

/**
 * Safely write or update key=value pairs in a `.env` file while preserving unrelated lines & comments.
 */
export function upsertDotEnvFile(envPath, updates = {}) {
  const target = resolve(envPath);
  mkdirSync(dirname(target), { recursive: true });
  const existingLines = existsSync(target) ? readFileSync(target, "utf8").split(/\r?\n/) : [];
  const entries = Object.entries(updates).filter(([k]) => Boolean(k));
  const remaining = new Map(entries);
  const nextLines = [];

  for (const line of existingLines) {
    const trimmed = line.trim();
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed);
    if (m && remaining.has(m[1])) {
      nextLines.push(`${m[1]}=${remaining.get(m[1])}`);
      remaining.delete(m[1]);
    } else {
      nextLines.push(line);
    }
  }

  if (remaining.size > 0) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== "") {
      nextLines.push("");
    }
    nextLines.push("# Configured by `npm run setup` (Universal Relay / Multi-Protocol Adapter)");
    for (const [k, v] of remaining.entries()) {
      nextLines.push(`${k}=${v}`);
    }
  }

  const finalText = nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  writeFileSync(target, finalText, "utf8");
  return target;
}

/**
 * Apply and optionally test a relay/provider configuration programmatically.
 */
export async function applySetupConfig({
  baseUrl,
  apiKey = "",
  model = "",
  protocol = "auto",
  envPath = join(process.cwd(), ".env"),
  runTest = true,
  fetchFn = globalThis.fetch,
} = {}) {
  const cleanUrl = normalizeBaseUrl(baseUrl);
  if (!cleanUrl) return { ok: false, error: "baseUrl is required" };
  const cleanKey = normalizeApiKey(apiKey);
  const detectedProto = detectProtocol({ baseUrl: cleanUrl, protocol });
  const effectiveModel = String(model || "").trim() || (detectedProto === "ollama" ? "qwen2.5:7b-instruct" : "deepseek-chat");
  const endpoint = resolveChatEndpoint({ baseUrl: cleanUrl, protocol: detectedProto, model: effectiveModel });

  let testResult = null;
  if (runTest) {
    testResult = await testLlmConnection({
      baseUrl: cleanUrl,
      apiKey: cleanKey,
      model: effectiveModel,
      protocol: detectedProto,
      fetchFn,
    });
  }

  const savedPath = upsertDotEnvFile(envPath, {
    LLM_BASE_URL: cleanUrl,
    LLM_API_KEY: cleanKey,
    LLM_MODEL: effectiveModel,
    LLM_PROTOCOL: detectedProto,
  });

  return {
    ok: true,
    savedPath,
    config: {
      baseUrl: cleanUrl,
      chatEndpoint: endpoint.url,
      protocol: detectedProto,
      model: effectiveModel,
      maskedKey: maskApiKey(cleanKey),
    },
    testResult,
  };
}

function parseCliArgs(argv) {
  const opts = {
    url: "",
    key: "",
    model: "",
    protocol: "auto",
    out: join(process.cwd(), ".env"),
    noTest: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--url" || a === "--base-url") opts.url = argv[++i] || "";
    else if (a === "--key" || a === "--api-key") opts.key = argv[++i] || "";
    else if (a === "--model") opts.model = argv[++i] || "";
    else if (a === "--protocol") opts.protocol = argv[++i] || "auto";
    else if (a === "--out" || a === "--env") opts.out = argv[++i] || opts.out;
    else if (a === "--no-test") opts.noTest = true;
    else if (a === "-h" || a === "--help") opts.help = true;
  }
  return opts;
}

async function runInteractiveWizard(envPath) {
  const rl = createInterface({ input, output });
  try {
    console.log("\n==============================================================");
    console.log("  Nuomu Soul 一键配置向导 / Universal Relay Setup Wizard");
    console.log("  无需访问海外官网：支持任意中转站、国内直连 API 与本地模型");
    console.log("==============================================================\n");

    console.log("请选择你的模型接入方式（直接回车默认选 1 · 任意中转站）：\n");
    PROVIDER_PRESETS.forEach((p, idx) => {
      const tag = p.domesticFriendly ? "[国内免梯/离线]" : "[海外/中转]";
      console.log(`  ${String(idx + 1).padStart(2, " ")}. ${p.name}  ${tag}`);
    });
    console.log("");

    const choiceRaw = (await rl.question("请输入序号 [1]: ")).trim();
    const idx = Math.max(0, Math.min(PROVIDER_PRESETS.length - 1, (Number(choiceRaw) || 1) - 1));
    const preset = PROVIDER_PRESETS[idx];
    console.log(`\n-> 已选: ${preset.name}`);
    console.log(`   说明: ${preset.hint}\n`);

    // Step 1: Base URL (supports ANY pasted shape)
    let rawUrl = preset.baseUrl;
    if (!rawUrl || preset.id === "relay" || preset.id === "anthropic" || preset.id === "gemini" || preset.id === "ollama" || preset.id === "lmstudio") {
      const promptHint = rawUrl
        ? `请输入接口网址 / 中转站链接（直接回车使用 ${rawUrl}）: `
        : "请粘贴你的中转站网址（裸域名、带 /v1、带 /v1/chat/completions 或 /v1/messages 都行）: ";
      const typed = (await rl.question(promptHint)).trim();
      if (typed) rawUrl = typed;
    } else {
      const typed = (await rl.question(`接口网址 [${rawUrl}]（直接回车确认，或粘贴自定义中转站网址）: `)).trim();
      if (typed) rawUrl = typed;
    }

    const cleanUrl = normalizeBaseUrl(rawUrl);
    if (!cleanUrl) {
      console.error("\n✖ 未输入有效网址，已退出配置。");
      process.exitCode = 1;
      return;
    }

    // Protocol auto-detection with optional override
    let detectedProto = detectProtocol({ baseUrl: cleanUrl, protocol: preset.protocol });
    const previewEndpoint = resolveChatEndpoint({ baseUrl: cleanUrl, protocol: detectedProto, model: preset.defaultModel });
    console.log(`   ✔ 自动识别协议: ${detectedProto}`);
    console.log(`   ✔ 自动补全对话接口: ${previewEndpoint.url}`);

    const overrideProto = (await rl.question(`协议确认 [${detectedProto}]（直接回车确认，或输入 openai / anthropic / gemini / ollama）: `)).trim();
    if (overrideProto) {
      detectedProto = detectProtocol({ baseUrl: cleanUrl, protocol: overrideProto });
    }

    // Step 2: API Key
    let cleanKey = "";
    if (preset.requiresKey || detectedProto !== "ollama") {
      const rawKey = await rl.question("\n请粘贴你的 API Key（支持自动清理多余空格、引号或 Bearer 前缀；本地模型可直接回车留空）: ");
      cleanKey = normalizeApiKey(rawKey);
      console.log(`   ✔ 已读取 Key: ${maskApiKey(cleanKey)}`);
    }

    // Step 3: Auto-discover available models from relay if supported
    console.log("\n正在尝试向中转站自动拉取可用模型列表...");
    const discovered = await listRemoteModels({ baseUrl: cleanUrl, apiKey: cleanKey, protocol: detectedProto });
    let chosenModel = preset.defaultModel;
    if (discovered.ok && discovered.models.length > 0) {
      const shown = discovered.models.slice(0, 15);
      console.log(`   ✔ 成功拉取到 ${discovered.models.length} 个可用模型（展示前 ${shown.length} 个）：`);
      shown.forEach((m, i) => {
        console.log(`      ${String(i + 1).padStart(2, " ")}. ${m}`);
      });
      const defaultHint = shown.includes(preset.defaultModel) ? preset.defaultModel : shown[0];
      const mInput = (await rl.question(`\n请输入上方序号，或直接手填任意模型名 [${defaultHint}]: `)).trim();
      if (!mInput) {
        chosenModel = defaultHint;
      } else if (/^\d+$/.test(mInput) && Number(mInput) >= 1 && Number(mInput) <= shown.length) {
        chosenModel = shown[Number(mInput) - 1];
      } else {
        chosenModel = mInput;
      }
    } else {
      console.log("   (该接口未开放模型列表查询，直接手动输入模型名即可)");
      const mInput = (await rl.question(`请输入模型名称 [${preset.defaultModel}]: `)).trim();
      if (mInput) chosenModel = mInput;
    }

    // Step 4: Live connectivity test
    const doTestAns = (await rl.question("\n是否立即发一条 5-token 测试消息验证连通性？[Y/n]: ")).trim().toLowerCase();
    const shouldTest = doTestAns !== "n" && doTestAns !== "no";

    if (shouldTest) {
      console.log(`\n正在连通性测试 -> ${chosenModel} (${detectedProto}) ...`);
    }

    const result = await applySetupConfig({
      baseUrl: cleanUrl,
      apiKey: cleanKey,
      model: chosenModel,
      protocol: detectedProto,
      envPath,
      runTest: shouldTest,
    });

    if (shouldTest && result.testResult) {
      if (result.testResult.ok) {
        console.log(`   ✔ 连通成功！耗时 ${result.testResult.latencyMs}ms，模型回复: "${result.testResult.content.slice(0, 80)}"`);
      } else {
        console.log(`   ⚠ 连通测试未通过：${result.testResult.error}`);
        console.log("   （配置仍已保存到 .env，你可随时重跑 `npm run setup` 或手动编辑 .env 修改）");
      }
    }

    console.log(`\n✔ 配置已安全写入: ${result.savedPath}（已在 .gitignore 保护列表内，不会被提交到 Git）`);
    console.log("\n接下来你可以直接运行：");
    console.log("  npm run demo                # 1 秒体验 8 大认知核心（离线）");
    console.log("  npm run eval -- --limit 4   # 用刚配好的中转站跑 4 题快速实测");
    console.log("  npm run consolidate:daily   # 运行每日情景打包与第一人称日记");
    console.log("  npm run soul:export         # 导出模型无关的灵魂账本 v1\n");
  } finally {
    rl.close();
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log([
      "Nuomu Soul Setup Wizard (Universal Relay & Multi-Protocol Configurator)",
      "",
      "Interactive mode (recommended for beginners):",
      "  npm run setup",
      "",
      "Non-interactive CLI mode:",
      "  node src/runtime/setup-wizard.mjs --url <relay_url> --key <api_key> --model <model_id> [--protocol auto|openai|anthropic|gemini|ollama] [--no-test]",
    ].join("\n"));
    process.exit(0);
  }
  if (args.url) {
    applySetupConfig({
      baseUrl: args.url,
      apiKey: args.key,
      model: args.model,
      protocol: args.protocol,
      envPath: args.out,
      runTest: !args.noTest,
    }).then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    });
  } else {
    runInteractiveWizard(args.out).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
