// Unified Zero-Dependency Runtime LLM Client (Universal Relay / Domestic / Global / Local Ollama).
// Automatically loads `.env`, normalizes any pasted relay URL + API Key, and gracefully retries
// if a third-party relay does not support `response_format: { type: "json_object" }`.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildUnifiedChatRequest,
  detectProtocol,
  diagnoseConnectionError,
  normalizeApiKey,
  normalizeBaseUrl,
  parseModelsListResponse,
  parseUnifiedChatResponse,
  resolveModelsEndpoint,
} from "../core/provider-compat.mjs";

/**
 * Lightweight zero-dependency `.env` parser.
 * Does NOT overwrite already-set process.env variables unless `override: true`.
 */
export function loadDotEnv(envPath = resolve(process.env.SOULCARD_ENV_FILE || join(process.cwd(), ".env")), { override = false } = {}) {
  const parsed = {};
  try {
    if (!envPath || !existsSync(envPath)) return parsed;
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      parsed[key] = val;
      if (override || !(key in process.env) || !String(process.env[key] ?? "").trim()) {
        process.env[key] = val;
      }
    }
  } catch {}
  return parsed;
}

function pickEnv(env, ...names) {
  for (const name of names) {
    const val = String(env?.[name] ?? "").trim();
    if (val) return val;
  }
  return "";
}

/**
 * Resolve active LLM endpoint configuration from explicit overrides -> `.env` -> process.env.
 * Priority:
 *   1. Universal Relay (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_PROTOCOL`)
 *   2. Standard OpenAI-compat (`OPENAI_BASE_URL` / `OPENAI_API_BASE` / `OPENAI_API_KEY` / `OPENAI_MODEL`)
 *   3. Direct provider keys (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`)
 *   4. Local gateway (`SOULCARD_GATEWAY_URL`) or free local Ollama (`OLLAMA_BASE_URL`)
 */
export function resolveLlmConfig({
  baseUrl = "",
  apiKey = "",
  model = "",
  protocol = "",
  envFile = "",
  env = null,
} = {}) {
  const fileVals = env ? {} : loadDotEnv(envFile || resolve(process.env.SOULCARD_ENV_FILE || join(process.cwd(), ".env")));
  const src = env || { ...fileVals, ...process.env };

  const explicitUrl = normalizeBaseUrl(baseUrl);
  const explicitKey = normalizeApiKey(apiKey);
  const explicitProto = String(protocol || "").trim();

  if (explicitUrl) {
    const proto = detectProtocol({ baseUrl: explicitUrl, protocol: explicitProto || "auto" });
    return {
      source: "explicit",
      baseUrl: explicitUrl,
      apiKey: explicitKey || normalizeApiKey(pickEnv(src, "LLM_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY")),
      model: model || pickEnv(src, "LLM_MODEL", "OPENAI_MODEL") || "deepseek-chat",
      protocol: proto,
    };
  }

  // 1. Universal Relay / Custom Endpoint (Recommended for beginners & domestic users)
  const llmBase = normalizeBaseUrl(pickEnv(src, "LLM_BASE_URL", "OPENAI_BASE_URL", "OPENAI_API_BASE"));
  const llmKey = normalizeApiKey(pickEnv(src, "LLM_API_KEY", "OPENAI_API_KEY"));
  if (llmBase) {
    const proto = detectProtocol({ baseUrl: llmBase, protocol: explicitProto || pickEnv(src, "LLM_PROTOCOL") || "auto" });
    return {
      source: "relay",
      baseUrl: llmBase,
      apiKey: explicitKey || llmKey,
      model: model || pickEnv(src, "LLM_MODEL", "OPENAI_MODEL") || (proto === "ollama" ? "qwen2.5:7b-instruct" : "deepseek-chat"),
      protocol: proto,
    };
  }

  // 2. Direct provider keys (DeepSeek / Anthropic / Gemini)
  const dsKey = normalizeApiKey(pickEnv(src, "DEEPSEEK_API_KEY"));
  if (dsKey) {
    return {
      source: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: explicitKey || dsKey,
      model: model || pickEnv(src, "LLM_MODEL") || "deepseek-chat",
      protocol: "openai",
    };
  }

  const antKey = normalizeApiKey(pickEnv(src, "ANTHROPIC_API_KEY"));
  if (antKey) {
    return {
      source: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: explicitKey || antKey,
      model: model || pickEnv(src, "LLM_MODEL") || "claude-sonnet-4-5",
      protocol: "anthropic",
    };
  }

  const gemKey = normalizeApiKey(pickEnv(src, "GEMINI_API_KEY"));
  if (gemKey && !pickEnv(src, "SOULCARD_GATEWAY_URL")) {
    return {
      source: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: explicitKey || gemKey,
      model: model || pickEnv(src, "LLM_MODEL") || "gemini-2.5-flash",
      protocol: "gemini",
    };
  }

  // 3. OpenAI default if OPENAI_API_KEY was set without custom base URL
  if (llmKey) {
    return {
      source: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: explicitKey || llmKey,
      model: model || pickEnv(src, "LLM_MODEL", "OPENAI_MODEL") || "gpt-4o-mini",
      protocol: "openai",
    };
  }

  // 4. Local gateway or free local Ollama
  const gwUrl = normalizeBaseUrl(pickEnv(src, "SOULCARD_GATEWAY_URL"));
  if (gwUrl) {
    return {
      source: "local-gateway",
      baseUrl: gwUrl,
      apiKey: "",
      model: model || pickEnv(src, "LLM_MODEL") || "gemini-4-hydrogen",
      protocol: "openai",
    };
  }

  const ollamaBase = normalizeBaseUrl(pickEnv(src, "OLLAMA_BASE_URL") || "http://127.0.0.1:11434");
  return {
    source: "ollama",
    baseUrl: ollamaBase,
    apiKey: "",
    model: model || pickEnv(src, "SOULCARD_LOCAL_MODEL") || "qwen2.5:7b-instruct",
    protocol: "ollama",
  };
}

/**
 * Call any configured LLM (custom relay, domestic API, Anthropic, Gemini, local gateway, or Ollama)
 * with automatic URL normalization and automatic fallback if `response_format` is unsupported.
 */
export async function callUnifiedLlm(messages, {
  baseUrl = "",
  apiKey = "",
  model = "",
  protocol = "auto",
  temperature = 0.6,
  maxTokens = 2048,
  jsonMode = false,
  reasoningEffort = "",
  timeoutMs = 90_000,
  extraHeaders = {},
  envFile = "",
  env = null,
  fetchFn = globalThis.fetch,
} = {}) {
  const cfg = resolveLlmConfig({ baseUrl, apiKey, model, protocol, envFile, env });
  const effectiveModel = model || cfg.model;

  const attempt = async (useJsonMode) => {
    const req = buildUnifiedChatRequest({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: effectiveModel,
      protocol: cfg.protocol,
      messages,
      temperature,
      maxTokens,
      jsonMode: useJsonMode,
      reasoningEffort,
      extraHeaders,
    });
    const res = await fetchFn(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return { ok: false, status: res.status, bodyText, req };
    }
    const data = await res.json();
    const parsed = parseUnifiedChatResponse(data, req.protocol);
    return { ok: true, parsed, req, raw: data };
  };

  try {
    let r = await attempt(jsonMode);
    // Automatic relay compatibility fallback: some relays reject response_format: json_object with HTTP 400/422
    if (!r.ok && jsonMode && (r.status === 400 || r.status === 422)) {
      r = await attempt(false);
    }
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        provider: cfg.source,
        protocol: r.req.protocol,
        url: r.req.url,
        model: effectiveModel,
        error: diagnoseConnectionError({ status: r.status, bodyText: r.bodyText, url: r.req.url, protocol: r.req.protocol }),
        content: "",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    }
    return {
      ok: Boolean(r.parsed.text),
      provider: cfg.source,
      protocol: r.req.protocol,
      url: r.req.url,
      model: r.parsed.model || effectiveModel,
      content: r.parsed.text,
      reasoning: r.parsed.reasoning,
      usage: r.parsed.usage,
      error: r.parsed.text ? "" : "empty model response",
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      provider: cfg.source,
      protocol: cfg.protocol,
      url: cfg.baseUrl,
      model: effectiveModel,
      error: diagnoseConnectionError({ errorMessage: err?.message || String(err), url: cfg.baseUrl, protocol: cfg.protocol }),
      content: "",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
}

/**
 * Fetch available model IDs from a relay/provider (`/v1/models`, `/api/tags`, or `/v1beta/models`).
 * Never throws; returns `{ ok, models, url }`.
 */
export async function listRemoteModels({ baseUrl = "", apiKey = "", protocol = "auto", timeoutMs = 12_000, fetchFn = globalThis.fetch } = {}) {
  const { url, protocol: proto } = resolveModelsEndpoint({ baseUrl, protocol });
  if (!url) return { ok: false, models: [], url: "" };
  const key = normalizeApiKey(apiKey);
  const headers = {};
  if (key) {
    if (proto === "anthropic") {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    } else if (proto === "gemini") {
      headers["x-goog-api-key"] = key;
    } else if (proto !== "ollama") {
      headers.authorization = `Bearer ${key}`;
    }
  }
  try {
    const res = await fetchFn(url, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, status: res.status, models: [], url };
    const data = await res.json();
    const models = parseModelsListResponse(data, proto);
    return { ok: models.length > 0, models, url, protocol: proto };
  } catch {
    return { ok: false, models: [], url, protocol: proto };
  }
}

/**
 * Send a tiny 5-token live ping to verify that URL + API Key + Model work end-to-end.
 */
export async function testLlmConnection({ baseUrl, apiKey, model, protocol = "auto", fetchFn = globalThis.fetch } = {}) {
  const t0 = Date.now();
  const res = await callUnifiedLlm(
    [{ role: "user", content: "Reply with OK only." }],
    { baseUrl, apiKey, model, protocol, temperature: 0, maxTokens: 32, jsonMode: false, timeoutMs: 25_000, fetchFn }
  );
  return {
    ...res,
    latencyMs: Date.now() - t0,
  };
}
