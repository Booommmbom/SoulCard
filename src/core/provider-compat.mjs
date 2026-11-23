// Universal Multi-Protocol LLM & Relay (中转站) Compatibility Core
// Pure core module: ZERO fs / sqlite / path / http / network imports.
// Normalizes every real-world relay URL shape (bare domain, /v1, /v3, /compatible-mode/v1,
// /v1/chat/completions, /v1/messages, :generateContent, Azure OpenAI, local Ollama/LM Studio),
// sanitizes pasted API keys, translates OpenAI / Anthropic / Gemini / Ollama payloads,
// and provides beginner-friendly diagnostics.

export const PROVIDER_PRESETS = Object.freeze([
  {
    id: "relay",
    name: "Custom Relay / 任意中转站 (NewAPI · One-API · 各类聚合站)",
    baseUrl: "",
    protocol: "auto",
    defaultModel: "deepseek-chat",
    requiresKey: true,
    domesticFriendly: true,
    hint: "支持直接粘贴裸域名、/v1、/v1/chat/completions、/v1/messages 等任意格式，自动识别补全",
  },
  {
    id: "deepseek",
    name: "DeepSeek 官方直连 (国内免梯)",
    baseUrl: "https://api.deepseek.com",
    protocol: "openai",
    defaultModel: "deepseek-chat",
    requiresKey: true,
    domesticFriendly: true,
    hint: "性价比极高，国内直连稳定",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow 硅基流动 (国内免梯)",
    baseUrl: "https://api.siliconflow.cn/v1",
    protocol: "openai",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    requiresKey: true,
    domesticFriendly: true,
    hint: "国内聚合众多开源大模型，注册即用",
  },
  {
    id: "dashscope",
    name: "阿里云百炼 / 通义千问 DashScope (国内免梯)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openai",
    defaultModel: "qwen-plus",
    requiresKey: true,
    domesticFriendly: true,
    hint: "OpenAI 兼容接口，国内直连",
  },
  {
    id: "volcengine",
    name: "火山方舟 Volcengine Ark / 豆包 (国内免梯)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "openai",
    defaultModel: "doubao-1-5-pro-32k-250115",
    requiresKey: true,
    domesticFriendly: true,
    hint: "模型名填推理接入点 ID (ep-xxx) 或官方模型名",
  },
  {
    id: "moonshot",
    name: "Moonshot / Kimi 官方 (国内免梯)",
    baseUrl: "https://api.moonshot.cn/v1",
    protocol: "openai",
    defaultModel: "moonshot-v1-8k",
    requiresKey: true,
    domesticFriendly: true,
    hint: "国内直连，长上下文友好",
  },
  {
    id: "zhipu",
    name: "智谱 BigModel / GLM (国内免梯)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "openai",
    defaultModel: "glm-4-plus",
    requiresKey: true,
    domesticFriendly: true,
    hint: "注意使用 /api/paas/v4，适配器会自动不重复拼 /v1",
  },
  {
    id: "ollama",
    name: "本地 Ollama (100% 离线免费，无需 Key)",
    baseUrl: "http://127.0.0.1:11434",
    protocol: "ollama",
    defaultModel: "qwen2.5:7b-instruct",
    requiresKey: false,
    domesticFriendly: true,
    hint: "零费用完全本地运行",
  },
  {
    id: "lmstudio",
    name: "本地 LM Studio / vLLM / SGLang (离线免费)",
    baseUrl: "http://127.0.0.1:1234/v1",
    protocol: "openai",
    defaultModel: "local-model",
    requiresKey: false,
    domesticFriendly: true,
    hint: "兼容任意本地 OpenAI 接口推理服务",
  },
  {
    id: "openrouter",
    name: "OpenRouter (全球模型聚合)",
    baseUrl: "https://openrouter.ai/api/v1",
    protocol: "openai",
    defaultModel: "openai/gpt-4o-mini",
    requiresKey: true,
    domesticFriendly: false,
    hint: "一个 Key 调全球各家模型",
  },
  {
    id: "anthropic",
    name: "Anthropic 原生协议 (官方或中转)",
    baseUrl: "https://api.anthropic.com",
    protocol: "anthropic",
    defaultModel: "claude-sonnet-4-5",
    requiresKey: true,
    domesticFriendly: false,
    hint: "自动使用 x-api-key + /v1/messages 协议",
  },
  {
    id: "gemini",
    name: "Google Gemini 原生协议 (官方或中转)",
    baseUrl: "https://generativelanguage.googleapis.com",
    protocol: "gemini",
    defaultModel: "gemini-2.5-flash",
    requiresKey: true,
    domesticFriendly: false,
    hint: "自动使用 x-goog-api-key + :generateContent 协议",
  },
]);

const LOCAL_HOST_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\])(?::\d+)?(?:\/|$)/i;
const VERSIONED_PREFIX_RE = /(?:\/v\d+(?:alpha\d*|beta\d*)?(?:\/openai)?|\/compatible-mode\/v\d+|\/api\/paas\/v\d+|\/openai\/v\d+|\/api\/v\d+)$/i;

/**
 * Clean a pasted API key: removes surrounding quotes, accidental "Bearer " prefix, and whitespace/newlines.
 */
export function normalizeApiKey(rawKey = "") {
  let s = String(rawKey ?? "").trim();
  if (!s) return "";
  s = s.replace(/^['"`]+|['"`]+$/g, "").trim();
  s = s.replace(/^authorization\s*:\s*/i, "").trim();
  s = s.replace(/^bearer\s+/i, "").trim();
  s = s.replace(/[\r\n\t]+/g, "").trim();
  return s;
}

/**
 * Mask an API key safely for logs or terminal output (never prints the full secret).
 */
export function maskApiKey(rawKey = "") {
  const k = normalizeApiKey(rawKey);
  if (!k) return "(empty)";
  if (k.length <= 8) return `${k.slice(0, 2)}***`;
  return `${k.slice(0, 4)}...${k.slice(-4)} (${k.length} chars)`;
}

/**
 * Clean a pasted base URL: strips quotes/spaces, auto-adds http:// (local) or https:// (remote),
 * removes trailing slashes and accidental hash fragments.
 */
export function normalizeBaseUrl(rawUrl = "") {
  let s = String(rawUrl ?? "").trim();
  if (!s) return "";
  s = s.replace(/^['"`]+|['"`]+$/g, "").trim();
  s = s.replace(/\s+/g, "");
  // Strip accidental trailing '#' or hash fragment (common when copying from browser docs)
  const hashIdx = s.indexOf("#");
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  if (!/^https?:\/\//i.test(s)) {
    const scheme = LOCAL_HOST_RE.test(s) ? "http://" : "https://";
    s = `${scheme}${s.replace(/^\/+/, "")}`;
  }
  // Remove trailing slashes except if query string present
  const qIdx = s.indexOf("?");
  if (qIdx >= 0) {
    const base = s.slice(0, qIdx).replace(/\/+$/, "");
    return `${base}${s.slice(qIdx)}`;
  }
  return s.replace(/\/+$/, "");
}

/**
 * Auto-detect wire protocol from URL + explicit hint.
 * Returns one of: "openai" | "anthropic" | "gemini" | "ollama".
 */
export function detectProtocol({ baseUrl = "", protocol = "auto" } = {}) {
  const explicit = String(protocol ?? "auto").trim().toLowerCase();
  if (explicit && explicit !== "auto") {
    if (explicit === "claude") return "anthropic";
    if (explicit === "google" || explicit === "google-gemini" || explicit === "aistudio") return "gemini";
    if (explicit === "openai-compatible" || explicit === "oneapi" || explicit === "newapi" || explicit === "relay") return "openai";
    if (["openai", "anthropic", "gemini", "ollama"].includes(explicit)) return explicit;
  }

  const norm = normalizeBaseUrl(baseUrl).toLowerCase();
  if (!norm) return "openai";
  if (/\/messages(?:\?|$)/.test(norm) || norm.includes("api.anthropic.com")) return "anthropic";
  if (norm.includes(":generatecontent") || (norm.includes("generativelanguage.googleapis.com") && !norm.includes("/openai"))) {
    return "gemini";
  }
  if (/\/v1beta\/models(?:\/|$)/.test(norm) && !norm.includes("/openai")) return "gemini";
  if (/\/api\/chat(?:\?|$)/.test(norm) || (/:11434(?:\/|$)/.test(norm) && !/\/v1(?:\/|$)/.test(norm))) {
    return "ollama";
  }
  return "openai";
}

/**
 * Resolve ANY pasted baseUrl shape into the exact chat completion endpoint URL.
 * Handles bare domains, /v1, /api/v3, /api/paas/v4, /compatible-mode/v1, full /chat/completions,
 * Azure OpenAI deployments URLs, Anthropic /v1/messages, Gemini :generateContent, and Ollama /api/chat.
 */
export function resolveChatEndpoint({ baseUrl = "", protocol = "auto", model = "" } = {}) {
  const norm = normalizeBaseUrl(baseUrl);
  const proto = detectProtocol({ baseUrl: norm, protocol });
  if (!norm) return { url: "", protocol: proto };

  const qIdx = norm.indexOf("?");
  const pathPart = qIdx >= 0 ? norm.slice(0, qIdx) : norm;
  const queryPart = qIdx >= 0 ? norm.slice(qIdx) : "";

  if (proto === "anthropic") {
    if (/\/messages$/i.test(pathPart)) return { url: `${pathPart}${queryPart}`, protocol: proto };
    if (/\/v\d+$/i.test(pathPart)) return { url: `${pathPart}/messages${queryPart}`, protocol: proto };
    return { url: `${pathPart}/v1/messages${queryPart}`, protocol: proto };
  }

  if (proto === "gemini") {
    if (/:generatecontent$/i.test(pathPart)) return { url: `${pathPart}${queryPart}`, protocol: proto };
    const safeModel = encodeURIComponent(String(model || "gemini-2.5-flash").replace(/^models\//i, ""));
    if (/\/models\/[^/]+$/i.test(pathPart)) return { url: `${pathPart}:generateContent${queryPart}`, protocol: proto };
    if (/\/v\d+(?:beta\d*)?$/i.test(pathPart)) {
      return { url: `${pathPart}/models/${safeModel}:generateContent${queryPart}`, protocol: proto };
    }
    return { url: `${pathPart}/v1beta/models/${safeModel}:generateContent${queryPart}`, protocol: proto };
  }

  if (proto === "ollama") {
    if (/\/api\/chat$/i.test(pathPart)) return { url: `${pathPart}${queryPart}`, protocol: proto };
    if (/\/api$/i.test(pathPart)) return { url: `${pathPart}/chat${queryPart}`, protocol: proto };
    return { url: `${pathPart}/api/chat${queryPart}`, protocol: proto };
  }

  // OpenAI-compatible (covers NewAPI, One-API, DeepSeek, SiliconFlow, DashScope, Volcengine, Zhipu, OpenRouter, Azure, LM Studio, vLLM)
  if (/\/chat\/completions$/i.test(pathPart)) {
    return { url: `${pathPart}${queryPart}`, protocol: proto };
  }
  if (/\.openai\.azure\.com/i.test(pathPart) && /\/deployments\/[^/]+/i.test(pathPart)) {
    return { url: `${pathPart}/chat/completions${queryPart}`, protocol: proto };
  }
  if (VERSIONED_PREFIX_RE.test(pathPart)) {
    return { url: `${pathPart}/chat/completions${queryPart}`, protocol: proto };
  }
  // Common bare relay domain or custom prefix like https://relay.example.com or https://relay.example.com/proxy
  return { url: `${pathPart}/v1/chat/completions${queryPart}`, protocol: proto };
}

/**
 * Resolve the model-listing endpoint for automatic model discovery during setup.
 */
export function resolveModelsEndpoint({ baseUrl = "", protocol = "auto" } = {}) {
  const norm = normalizeBaseUrl(baseUrl);
  const proto = detectProtocol({ baseUrl: norm, protocol });
  if (!norm) return { url: "", protocol: proto };

  const qIdx = norm.indexOf("?");
  const pathPart = (qIdx >= 0 ? norm.slice(0, qIdx) : norm)
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/messages$/i, "")
    .replace(/\/api\/chat$/i, "")
    .replace(/\/models\/[^/]+:generateContent$/i, "")
    .replace(/\/+$/, "");

  if (proto === "ollama") {
    return { url: `${pathPart}/api/tags`, protocol: proto };
  }
  if (proto === "gemini") {
    if (/\/v\d+(?:beta\d*)?$/i.test(pathPart)) return { url: `${pathPart}/models`, protocol: proto };
    return { url: `${pathPart}/v1beta/models`, protocol: proto };
  }
  if (proto === "anthropic") {
    if (/\/v\d+$/i.test(pathPart)) return { url: `${pathPart}/models`, protocol: proto };
    return { url: `${pathPart}/v1/models`, protocol: proto };
  }
  if (VERSIONED_PREFIX_RE.test(pathPart)) {
    return { url: `${pathPart}/models`, protocol: proto };
  }
  return { url: `${pathPart}/v1/models`, protocol: proto };
}

/**
 * Parse a models-list JSON response from OpenAI/NewAPI, Ollama (/api/tags), or Gemini (/v1beta/models).
 */
export function parseModelsListResponse(data, protocol = "openai") {
  if (!data || typeof data !== "object") return [];
  if (protocol === "ollama" && Array.isArray(data.models)) {
    return data.models.map((m) => String(m?.name || m?.model || "").trim()).filter(Boolean);
  }
  if (protocol === "gemini" && Array.isArray(data.models)) {
    return data.models.map((m) => String(m?.name || "").replace(/^models\//i, "").trim()).filter(Boolean);
  }
  if (Array.isArray(data.data)) {
    return data.data.map((m) => String(m?.id || m?.name || "").trim()).filter(Boolean);
  }
  if (Array.isArray(data.models)) {
    return data.models.map((m) => String(typeof m === "string" ? m : (m?.id || m?.name || "")).trim()).filter(Boolean);
  }
  return [];
}

/**
 * Build a wire-ready HTTP request ({ url, headers, body, protocol }) for ANY supported provider/relay.
 */
export function buildUnifiedChatRequest({
  baseUrl = "",
  apiKey = "",
  model = "",
  protocol = "auto",
  messages = [],
  temperature = 0.6,
  maxTokens = 2048,
  jsonMode = false,
  reasoningEffort = "",
  extraHeaders = {},
} = {}) {
  const key = normalizeApiKey(apiKey);
  const { url, protocol: proto } = resolveChatEndpoint({ baseUrl, protocol, model });
  const cleanMessages = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m.content !== "undefined")
    .map((m) => ({ role: String(m.role || "user"), content: String(m.content ?? "") }));

  const headers = {
    "content-type": "application/json",
    ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
  };

  if (proto === "anthropic") {
    if (key) headers["x-api-key"] = key;
    headers["anthropic-version"] = headers["anthropic-version"] || "2023-06-01";
    const systemText = cleanMessages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
      .trim();
    const nonSystem = cleanMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const body = {
      model: model || "claude-sonnet-4-5",
      max_tokens: Number(maxTokens) || 2048,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.6,
      messages: nonSystem.length > 0 ? nonSystem : [{ role: "user", content: "hi" }],
    };
    if (systemText) body.system = systemText;
    return { url, headers, body, protocol: proto };
  }

  if (proto === "gemini") {
    if (key) headers["x-goog-api-key"] = key;
    const systemText = cleanMessages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
      .trim();
    const contents = cleanMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const generationConfig = {
      maxOutputTokens: Number(maxTokens) || 2048,
    };
    if (Number.isFinite(Number(temperature))) generationConfig.temperature = Number(temperature);
    if (jsonMode) generationConfig.responseMimeType = "application/json";
    const body = {
      contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig,
    };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    return { url, headers, body, protocol: proto };
  }

  if (proto === "ollama") {
    const body = {
      model: String(model || "qwen2.5:7b-instruct").replace(/^ollama:/i, ""),
      stream: false,
      messages: cleanMessages,
      options: {
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.6,
        num_predict: Number(maxTokens) || 2048,
      },
    };
    if (jsonMode) body.format = "json";
    return { url, headers, body, protocol: proto };
  }

  // OpenAI-compatible (default — covers 95%+ of relays & domestic APIs)
  if (key) {
    if (/\.openai\.azure\.com/i.test(url)) {
      headers["api-key"] = key;
    } else {
      headers.authorization = `Bearer ${key}`;
    }
  }
  const body = {
    model: model || "gpt-4o-mini",
    messages: cleanMessages,
    stream: false,
    max_tokens: Number(maxTokens) || 2048,
  };
  if (Number.isFinite(Number(temperature))) body.temperature = Number(temperature);
  if (jsonMode) body.response_format = { type: "json_object" };
  if (reasoningEffort && String(reasoningEffort).trim()) {
    body.reasoning_effort = String(reasoningEffort).trim();
  }
  return { url, headers, body, protocol: proto };
}

function flattenContentField(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string" && !part.thought) return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Parse chat completion JSON response across OpenAI / NewAPI / One-API / Anthropic / Gemini / Ollama.
 */
export function parseUnifiedChatResponse(data, protocol = "openai") {
  const empty = {
    text: "",
    reasoning: "",
    model: "",
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  if (!data || typeof data !== "object") return empty;

  // Auto-detect actual payload shape even if relay returned a different dialect
  if (protocol === "anthropic" || (Array.isArray(data.content) && data.type === "message")) {
    const text = data.content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("")
      .trim();
    const reasoning = data.content
      .filter((b) => b && b.type === "thinking" && typeof b.thinking === "string")
      .map((b) => b.thinking)
      .join("")
      .trim();
    const pt = Number(data?.usage?.input_tokens ?? 0);
    const ct = Number(data?.usage?.output_tokens ?? 0);
    return {
      text,
      reasoning,
      model: String(data.model || ""),
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
    };
  }

  if (protocol === "gemini" || Array.isArray(data.candidates)) {
    const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
    const text = parts.filter((p) => p && !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
    const reasoning = parts.filter((p) => p && p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
    const um = data.usageMetadata || {};
    const pt = Number(um.promptTokenCount ?? 0);
    const ct = Number(um.candidatesTokenCount ?? 0) + Number(um.thoughtsTokenCount ?? 0);
    const tt = Number(um.totalTokenCount ?? (pt + ct));
    return {
      text,
      reasoning,
      model: String(data.modelVersion || ""),
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt },
    };
  }

  if (protocol === "ollama" || (data.message && typeof data.message.content === "string" && !Array.isArray(data.choices))) {
    const pt = Number(data.prompt_eval_count ?? 0);
    const ct = Number(data.eval_count ?? 0);
    return {
      text: String(data?.message?.content ?? data?.response ?? "").trim(),
      reasoning: "",
      model: String(data.model || ""),
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
    };
  }

  // OpenAI-compatible (including quirky relay responses)
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const msg = choice?.message || {};
  const text = (flattenContentField(msg.content) || String(choice?.text ?? "")).trim();
  const reasoning = String(msg.reasoning_content ?? msg.reasoning ?? "").trim();
  const u = data.usage || {};
  const pt = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  const ct = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  const tt = Number(u.total_tokens ?? (pt + ct));
  return {
    text,
    reasoning,
    model: String(data.model || ""),
    usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt },
  };
}

/**
 * Beginner-friendly bilingual error diagnostics for common relay / API failures.
 */
export function diagnoseConnectionError({ status = 0, bodyText = "", errorMessage = "", url = "", protocol = "openai" } = {}) {
  const body = String(bodyText || "").slice(0, 260);
  if (status === 401) {
    return "HTTP 401 鉴权失败：请检查 API Key 是否复制完整、是否已过期或在中转站被禁用（本工具会自动清理多余的 Bearer 前缀与空格）。";
  }
  if (status === 402) {
    return "HTTP 402 余额不足：当前中转站或官网账号额度已用完，请充值或更换可用 Key。";
  }
  if (status === 403) {
    return "HTTP 403 权限被拒：可能是当前 Key 无权调用该模型，或目标接口限制了地区（建议改用国内直连或中转站网址）。";
  }
  if (status === 404) {
    return `HTTP 404 接口或模型不存在（当前请求地址: ${url}，协议: ${protocol}）：请核对中转站后台给的 Base URL 是否需要带特定子路径，以及模型名称是否拼写正确。`;
  }
  if (status === 429) {
    return "HTTP 429 触发限流或额度不足：请稍等几秒重试，或在对应中转站检查并发限制/余额。";
  }
  if (status >= 500) {
    return `HTTP ${status} 上游中转站暂时异常：这是中转站服务器端故障，可稍后重试或换用其他模型渠道。`;
  }
  if (/timeout|aborted|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(String(errorMessage || ""))) {
    return `网络连接失败（${errorMessage}）：如果直连海外官网不通，请直接填入国内可访问的中转站网址（NewAPI / One-API）或 DeepSeek / 硅基流动 / 阿里云百炼 / 本地 Ollama。`;
  }
  return `请求失败${status ? ` (HTTP ${status})` : ""}${body ? `: ${body}` : errorMessage ? `: ${errorMessage}` : ""}`;
}
