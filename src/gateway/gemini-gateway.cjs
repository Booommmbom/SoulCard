// Local OpenAI-compatible multi-model adapter for Gemini 4 (AI Studio & Vertex AI ADC).
// Binds strictly to 127.0.0.1; owns request translation, effort clamping, and per-call USD/CNY ledger tracking.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createVertexAuthProvider } = require("./gemini-auth.cjs");

// Auto-load `.env` without external dependencies (never overwrites already-set env vars)
(function loadGatewayDotEnv() {
  try {
    const envPath = path.resolve(process.env.NUOMU_ENV_FILE || path.join(process.cwd(), ".env"));
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env) || !String(process.env[k] || "").trim()) process.env[k] = v;
    }
  } catch {}
})();

// Optional outbound HTTP proxy support via undici ProxyAgent (falls back to native Node fetch when unset)
let ProxyAgent;
let undiciFetch = globalThis.fetch;
try {
  const u = require("undici");
  ProxyAgent = u.ProxyAgent;
  if (typeof u.fetch === "function") undiciFetch = u.fetch;
} catch {}

const ROOT = path.resolve(process.env.NUOMU_ROOT || process.cwd());
const DATA_DIR = path.resolve(process.env.NUOMU_DATA_DIR || path.join(ROOT, "data"));
const PORT = Number(process.env.NUOMU_VERTEX_PORT || 3478);
const HOST = "127.0.0.1";
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "your-gcp-project-id";
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";
const DEFAULT_MODEL = process.env.NUOMU_VERTEX_MODEL || "gemini-4-argon";
const GEMINI4_MODELS = {
  "gemini-4-neon": { tiers: ["LOW", "MEDIUM", "HIGH", "MAX"], maxOutputTokens: 65536, usdPerM: { input: 3.0, cached: 0.3, output: 15.0 } },
  "gemini-4-hydrogen": { tiers: ["LOW", "MEDIUM", "HIGH", "MAX"], maxOutputTokens: 65536, usdPerM: { input: 1.5, cached: 0.15, output: 7.5 } },
  "gemini-4-carbon": { tiers: ["LOW", "MEDIUM", "HIGH"], maxOutputTokens: 32768, usdPerM: { input: 2.0, cached: 0.2, output: 10.0 } },
  "gemini-4-argon": { tiers: ["LOW", "MEDIUM", "HIGH"], maxOutputTokens: 32768, usdPerM: { input: 2.0, cached: 0.2, output: 10.0 } },
};
const CNY_PER_USD = 7.2;
const GATEWAY_USAGE_PATH = path.join(DATA_DIR, "state", "gateway-usage.jsonl");
const MAX_BODY = 8 * 1024 * 1024;

function computeGatewayCost(modelId, usage) {
  const spec = GEMINI4_MODELS[modelId] || GEMINI4_MODELS["gemini-4-argon"];
  const prompt = Math.max(0, Number(usage?.prompt_tokens ?? 0));
  const cached = Math.min(prompt, Math.max(0, Number(usage?.cached_tokens ?? 0)));
  const newInput = Math.max(0, prompt - cached);
  const completion = Math.max(0, Number(usage?.completion_tokens ?? 0));
  const usd = (newInput * spec.usdPerM.input + cached * spec.usdPerM.cached + completion * spec.usdPerM.output) / 1_000_000;
  return {
    estimatedUsd: Math.round(usd * 1_000_000) / 1_000_000,
    estimatedCny: Math.round(usd * CNY_PER_USD * 1_000_000) / 1_000_000,
  };
}

function recordGatewayUsage({ model, thinking, caller, usage, endpoint }) {
  try {
    const now = Date.now();
    const d = new Date(now);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const cost = computeGatewayCost(model, usage);
    const row = {
      ts: now,
      dateKey,
      model,
      thinking,
      caller: String(caller || "chat").slice(0, 32),
      endpoint: String(endpoint || ""),
      prompt_tokens: Number(usage?.prompt_tokens ?? 0),
      cached_tokens: Number(usage?.cached_tokens ?? 0),
      completion_tokens: Number(usage?.completion_tokens ?? 0),
      total_tokens: Number(usage?.total_tokens ?? 0),
      estimatedUsd: cost.estimatedUsd,
      estimatedCny: cost.estimatedCny,
    };
    fs.mkdirSync(path.dirname(GATEWAY_USAGE_PATH), { recursive: true });
    fs.appendFileSync(GATEWAY_USAGE_PATH, JSON.stringify(row) + "\n", "utf8");
  } catch {}
}

function resolveModel(requested) {
  const cleaned = String(requested ?? "").trim().replace(/^(?:models\/|google\/|nuomu-vertex-gateway\/)/i, "");
  if (cleaned && Object.prototype.hasOwnProperty.call(GEMINI4_MODELS, cleaned)) return cleaned;
  return Object.prototype.hasOwnProperty.call(GEMINI4_MODELS, DEFAULT_MODEL) ? DEFAULT_MODEL : "gemini-4-argon";
}

function resolveThinkingLevel(requestedEffort, modelId) {
  const spec = GEMINI4_MODELS[modelId] || GEMINI4_MODELS["gemini-4-argon"];
  const raw = String(requestedEffort ?? "high").trim().toUpperCase();
  const normalized = raw === "XHIGH" ? "MAX" : raw;
  if (spec.tiers.includes(normalized)) return normalized;
  if (normalized === "MAX" && !spec.tiers.includes("MAX")) return "HIGH";
  return spec.tiers.includes("HIGH") ? "HIGH" : spec.tiers[spec.tiers.length - 1];
}
const TIMEOUT_MS = 300000;
const LOG_PATH = path.join(ROOT, "logs", "vertex-gateway.log");
const PID_PATH = path.join(DATA_DIR, "state", "vertex-gateway.pid");
const MAX_THOUGHT_SIGNATURES = 500;
const thoughtSignatures = new Map();

function rememberThoughtSignature(id, signature) {
  if (!id || !signature) return;
  if (thoughtSignatures.size >= MAX_THOUGHT_SIGNATURES) {
    const oldestKey = thoughtSignatures.keys().next().value;
    if (oldestKey !== undefined) thoughtSignatures.delete(oldestKey);
  }
  thoughtSignatures.set(id, String(signature));
}

function log(message) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {}
}

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
}
loadEnv(path.join(ROOT, ".env"));

const VERTEX_PROXY = process.env.NUOMU_VERTEX_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || "";
const vertexDispatcher = ProxyAgent && VERTEX_PROXY ? new ProxyAgent(VERTEX_PROXY) : undefined;
const authProvider = createVertexAuthProvider({
  env: process.env,
  dispatcher: vertexDispatcher,
  fetchFn: undiciFetch,
  defaultProject: PROJECT,
});

const LOCAL_ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;
const LOCAL_HOST_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

function cors(req, res) {
  const origin = String(req?.headers?.origin || "").trim();
  if (origin && LOCAL_ORIGIN_RE.test(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-headers", "content-type, authorization, x-nuomu-caller");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
}

function json(req, res, status, value) {
  cors(req, res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        const err = new Error("request body too large");
        err.status = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (error) {
        error.status = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" || part?.type === "input_text")
    .map((part) => String(part.text ?? "")).join("\n");
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value ?? "{}")); } catch { return {}; }
}

function dataImage(url) {
  if (typeof url !== "string") return null;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url);
  return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
}

function contentParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const part of content) {
    if (part?.type === "text" || part?.type === "input_text") parts.push({ text: String(part.text ?? "") });
    else if (part?.type === "image_url") {
      const url = part.image_url?.url ?? part.image_url;
      const image = dataImage(url);
      if (image) parts.push(image);
      else if (typeof url === "string" && /^https?:\/\//i.test(url)) parts.push({ fileData: { mimeType: "image/*", fileUri: url } });
    }
  }
  return parts;
}

function toGemini(body) {
  const system = [];
  const contents = [];
  const toolNames = new Map();
  let pendingFunctionResponses = [];
  const flushFunctionResponses = () => {
    if (pendingFunctionResponses.length > 0) {
      contents.push({ role: "user", parts: pendingFunctionResponses });
      pendingFunctionResponses = [];
    }
  };
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const role = String(message.role ?? "user");
    if (role === "system" || role === "developer") {
      flushFunctionResponses();
      const text = textOf(message.content);
      if (text) system.push({ text });
      continue;
    }
    if (role === "tool") {
      const callId = String(message.tool_call_id ?? "");
      const name = toolNames.get(callId) || String(message.name ?? "tool");
      pendingFunctionResponses.push({ functionResponse: { name, response: { result: textOf(message.content) } } });
      continue;
    }
    flushFunctionResponses();
    if (role === "assistant") {
      const parts = contentParts(message.content);
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        const id = String(call.id ?? `call_${crypto.randomUUID()}`);
        const name = String(call.function?.name ?? "");
        toolNames.set(id, name);
        const functionCall = { name, args: parseJson(call.function?.arguments) };
        const signature = thoughtSignatures.get(id);
        // Vertex expects thoughtSignature on the Part, alongside functionCall.
        // Putting it inside function_call makes the REST schema reject the
        // entire request once a prior tool call is replayed.
        const part = { functionCall };
        if (signature) part.thoughtSignature = signature;
        parts.push(part);
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }
    const parts = contentParts(message.content);
    if (parts.length > 0) contents.push({ role: "user", parts });
  }
  flushFunctionResponses();
  const declarations = (Array.isArray(body.tools) ? body.tools : [])
    .filter((tool) => tool?.type === "function" && tool.function)
    .map((tool) => ({
      name: String(tool.function.name),
      description: String(tool.function.description ?? ""),
      parameters: tool.function.parameters ?? { type: "object", properties: {} }
    }));
  const modelId = resolveModel(body.model);
  const spec = GEMINI4_MODELS[modelId] || GEMINI4_MODELS["gemini-4-argon"];
  const generationConfig = {
    maxOutputTokens: Math.min(Number(body.max_tokens ?? body.max_completion_tokens ?? 8192), spec.maxOutputTokens),
  };
  // DSH sends OpenAI-style reasoning_effort. Gemini 4 exposes thinkingConfig.thinkingLevel:
  // Neon & Hydrogen support 4 tiers (LOW/MEDIUM/HIGH/MAX); Carbon & Argon support 3 tiers (LOW/MEDIUM/HIGH).
  const thinkingLevel = resolveThinkingLevel(body.reasoning_effort ?? body.reasoningEffort ?? "high", modelId);
  generationConfig.thinkingConfig = { thinkingLevel };
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  if (typeof body.top_p === "number") generationConfig.topP = body.top_p;
  if (body.response_format?.type === "json_object") generationConfig.responseMimeType = "application/json";
  if (Array.isArray(body.stop) && body.stop.length > 0) generationConfig.stopSequences = body.stop.map(String);
  const request = { contents, generationConfig };
  if (system.length > 0) request.systemInstruction = { parts: system };
  if (declarations.length > 0) {
    request.tools = [{ functionDeclarations: declarations }];
    const choice = body.tool_choice;
    if (choice === "none") request.toolConfig = { functionCallingConfig: { mode: "NONE" } };
    else if (choice === "required") request.toolConfig = { functionCallingConfig: { mode: "ANY" } };
    else if (choice && typeof choice === "object" && choice.function?.name) request.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [String(choice.function.name)] } };
  }
  return { request, toolNames, modelId, thinkingLevel };
}

function usageOf(metadata) {
  if (!metadata) return undefined;
  const prompt = Number(metadata.promptTokenCount ?? 0);
  const cached = Number(metadata.cachedContentTokenCount ?? 0);
  const completion = Number(metadata.candidatesTokenCount ?? 0) + Number(metadata.thoughtsTokenCount ?? 0);
  return {
    prompt_tokens: prompt,
    cached_tokens: cached,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

function fromGemini(data, modelId = DEFAULT_MODEL) {
  const candidate = data?.candidates?.[0] ?? {};
  const text = [];
  const toolCalls = [];
  for (const part of candidate.content?.parts ?? []) {
    if (typeof part.text === "string" && part.thought !== true) text.push(part.text);
    if (part.functionCall) {
      const id = `call_gemini_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const name = String(part.functionCall.name ?? "");
      const signature = part.thoughtSignature || part.functionCall.thoughtSignature;
      if (signature) rememberThoughtSignature(id, signature);
      toolCalls.push({ id, type: "function", function: { name, arguments: JSON.stringify(part.functionCall.args ?? {}) } });
    }
  }
  const message = { role: "assistant", content: text.join("") };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  const finish = toolCalls.length > 0 ? "tool_calls" : (candidate.finishReason === "MAX_TOKENS" ? "length" : "stop");
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: usageOf(data?.usageMetadata),
  };
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function streamOpenAI(req, res, response) {
  cors(req, res);
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
  const choice = response.choices[0];
  const id = response.id;
  const modelId = response.model || DEFAULT_MODEL;
  sse(res, { id, object: "chat.completion.chunk", created: response.created, model: modelId, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  const msg = choice.message;
  if (msg.content) {
    for (const char of msg.content) sse(res, { id, object: "chat.completion.chunk", created: response.created, model: modelId, choices: [{ index: 0, delta: { content: char }, finish_reason: null }] });
  }
  for (let i = 0; i < (msg.tool_calls ?? []).length; i++) {
    const call = msg.tool_calls[i];
    sse(res, { id, object: "chat.completion.chunk", created: response.created, model: modelId, choices: [{ index: i, delta: { tool_calls: [{ index: i, id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } }] }, finish_reason: null }] });
  }
  sse(res, { id, object: "chat.completion.chunk", created: response.created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }], usage: response.usage });
  res.end("data: [DONE]\n\n");
}

async function callVertex(body) {
  const { request, modelId, thinkingLevel } = toGemini(body);
  const { url, headers } = await authProvider.buildVertexRequest({ location: LOCATION, model: modelId });
  const fetchOptions = { method: "POST", headers, body: JSON.stringify(request), signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (vertexDispatcher) fetchOptions.dispatcher = vertexDispatcher;
  const response = await undiciFetch(url, fetchOptions);
  const text = await response.text();
  if (!response.ok) throw new Error(`Vertex HTTP ${response.status}: ${text.slice(0, 600)}`);
  return { response: fromGemini(JSON.parse(text), modelId), modelId, thinkingLevel };
}

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || "").trim();
  const origin = String(req.headers.origin || "").trim();
  if ((host && !LOCAL_HOST_RE.test(host)) || (origin && !LOCAL_ORIGIN_RE.test(origin))) {
    return json(req, res, 403, { error: { message: "forbidden: non-localhost Host or Origin rejected", type: "forbidden" } });
  }
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const status = authProvider.detectStatus();
      return json(req, res, 200, { ok: true, provider: "nuomu-vertex-gateway", model: DEFAULT_MODEL, models: Object.keys(GEMINI4_MODELS), project: status.project, location: LOCATION, authMode: status.authMode, endpoint: status.endpoint, configured: status.configured });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      const now = Math.floor(Date.now() / 1000);
      return json(req, res, 200, { object: "list", data: Object.keys(GEMINI4_MODELS).map((id) => ({ id, object: "model", owned_by: "google-gemini", created: now })) });
    }
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") return json(req, res, 404, { error: { message: "not found" } });
    const body = await readBody(req);
    const reqModel = resolveModel(body.model);
    const reqThinking = resolveThinkingLevel(body.reasoning_effort ?? body.reasoningEffort ?? "high", reqModel);
    const caller = String(req.headers["x-nuomu-caller"] || (body.stream === true ? "chat" : "api")).trim();
    log(`request model=${reqModel} thinking=${reqThinking} caller=${caller} stream=${body.stream === true} messages=${Array.isArray(body.messages) ? body.messages.length : 0} tools=${Array.isArray(body.tools) ? body.tools.length : 0}`);
    const { response } = await callVertex(body);
    const st = authProvider.detectStatus();
    recordGatewayUsage({ model: reqModel, thinking: reqThinking, caller, usage: response.usage, endpoint: st.endpoint });
    log(`response model=${reqModel} status=200 finish=${response.choices?.[0]?.finish_reason ?? "unknown"} prompt=${response.usage?.prompt_tokens ?? 0} completion=${response.usage?.completion_tokens ?? 0}`);
    if (body.stream === true) return streamOpenAI(req, res, response);
    return json(req, res, 200, response);
  } catch (error) {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 502;
    const detail = error?.cause?.message ? `${error.message} (${error.cause.message})` : String(error?.message ?? error);
    log(`error ${detail}`);
    return json(req, res, status, { error: { message: detail, type: status === 502 ? "vertex_gateway_error" : "invalid_request" } });
  }
});

if (require.main === module) {
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`✖ Port ${PORT} is already in use. Set NUOMU_VERTEX_PORT to a free port.`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    fs.mkdirSync(path.dirname(PID_PATH), { recursive: true });
    fs.writeFileSync(PID_PATH, String(process.pid), "utf8");
    const st = authProvider.detectStatus();
    log(`listening ${HOST}:${PORT} models=${Object.keys(GEMINI4_MODELS).join(",")} project=${st.project} location=${LOCATION} auth=${st.authMode} endpoint=${st.endpoint}`);
    console.log(`vertex gateway: http://${HOST}:${PORT}/v1`);
  });
}

module.exports = {
  GEMINI4_MODELS,
  resolveModel,
  resolveThinkingLevel,
  computeGatewayCost,
  toGemini,
  fromGemini,
};
