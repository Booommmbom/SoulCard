// Zero-dependency Google Cloud Application Default Credentials (ADC) + API Key auth helper
// Supports:
//   1. authorized_user ADC (`gcloud auth application-default login` -> %APPDATA%\gcloud\application_default_credentials.json)
//   2. service_account JSON (`GOOGLE_APPLICATION_CREDENTIALS`)
//   3. fallback static GOOGLE_CLOUD_API_KEY (for personal projects without org key restriction)
// Never logs or exposes token/secret values.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function defaultAdcPath(env = process.env) {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return String(env.GOOGLE_APPLICATION_CREDENTIALS).trim();
  if (env.APPDATA) return path.join(env.APPDATA, "gcloud", "application_default_credentials.json");
  if (env.HOME || env.USERPROFILE) {
    return path.join(env.HOME || env.USERPROFILE, ".config", "gcloud", "application_default_credentials.json");
  }
  return "";
}

function readAdcJson(env = process.env) {
  const filePath = defaultAdcPath(env);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.type === "authorized_user" && parsed.client_id && parsed.client_secret && parsed.refresh_token) {
      return { filePath, kind: "adc-authorized_user", data: parsed };
    }
    if (parsed.type === "service_account" && parsed.client_email && parsed.private_key) {
      return { filePath, kind: "adc-service_account", data: parsed };
    }
    return null;
  } catch {
    return null;
  }
}

function base64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signServiceAccountJwt(sa, nowSec = Math.floor(Date.now() / 1000)) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: sa.client_email,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: sa.token_uri || OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const sig = base64Url(signer.sign(sa.private_key));
  return `${signingInput}.${sig}`;
}

function createVertexAuthProvider({ env = process.env, dispatcher = undefined, fetchFn = globalThis.fetch, defaultProject = "your-gcp-project-id" } = {}) {
  let tokenCache = { accessToken: "", expiresAt: 0, sourcePath: "" };

  function resolveProject(adc) {
    return String(env.NUOMU_VERTEX_PROJECT || "").trim()
      || String(adc?.data?.quota_project_id || adc?.data?.project_id || "").trim()
      || String(env.GOOGLE_CLOUD_PROJECT || "").trim()
      || defaultProject;
  }

  function resolveEndpointMode() {
    const raw = String(env.NUOMU_VERTEX_ENDPOINT_MODE || "").trim().toLowerCase();
    if (raw === "aistudio" || raw === "ai-studio" || raw === "studio" || raw === "gla") return "aistudio";
    if (raw === "vertex" || raw === "adc" || raw === "vertex-adc") return "vertex";
    if (String(env.GEMINI_API_KEY || env.GOOGLE_AI_STUDIO_API_KEY || "").trim()) return "aistudio";
    return "vertex";
  }

  function resolveAiStudioKey() {
    return String(env.GEMINI_API_KEY || env.GOOGLE_AI_STUDIO_API_KEY || env.GOOGLE_CLOUD_API_KEY || "").trim();
  }

  function detectStatus() {
    const mode = resolveEndpointMode();
    const adc = readAdcJson(env);
    const project = resolveProject(adc);
    if (mode === "aistudio") {
      const studioKey = resolveAiStudioKey();
      if (studioKey) {
        return { configured: true, authMode: "aistudio-api-key", endpoint: "generativelanguage.googleapis.com", project: "google-ai-studio", adcPath: "" };
      }
      return { configured: false, authMode: "unconfigured", endpoint: "generativelanguage.googleapis.com", project: "google-ai-studio", adcPath: "" };
    }
    if (adc) {
      return { configured: true, authMode: adc.kind, endpoint: "aiplatform.googleapis.com", project, adcPath: adc.filePath };
    }
    const apiKey = String(env.GOOGLE_CLOUD_API_KEY || "").trim();
    if (apiKey) {
      return { configured: true, authMode: "api-key", endpoint: "aiplatform.googleapis.com", project, adcPath: "" };
    }
    return { configured: false, authMode: "unconfigured", endpoint: "aiplatform.googleapis.com", project, adcPath: defaultAdcPath(env) };
  }

  async function refreshAdcToken(adc) {
    const now = Date.now();
    if (tokenCache.accessToken && tokenCache.sourcePath === adc.filePath && now < tokenCache.expiresAt - 60_000) {
      return tokenCache.accessToken;
    }

    let tokenUrl = OAUTH_TOKEN_URL;
    let bodyParams;
    if (adc.kind === "adc-authorized_user") {
      bodyParams = new URLSearchParams({
        client_id: String(adc.data.client_id),
        client_secret: String(adc.data.client_secret),
        refresh_token: String(adc.data.refresh_token),
        grant_type: "refresh_token",
      });
    } else if (adc.kind === "adc-service_account") {
      tokenUrl = String(adc.data.token_uri || OAUTH_TOKEN_URL);
      const assertion = signServiceAccountJwt(adc.data);
      bodyParams = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      });
    } else {
      throw new Error("Unsupported ADC credential type");
    }

    const opts = {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: bodyParams.toString(),
      signal: AbortSignal.timeout(20_000),
    };
    if (dispatcher) opts.dispatcher = dispatcher;
    const res = await fetchFn(tokenUrl, opts);
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`ADC token refresh failed (HTTP ${res.status}): ${raw.slice(0, 200)}`);
    }
    const payload = JSON.parse(raw);
    const accessToken = String(payload.access_token || "").trim();
    if (!accessToken) throw new Error("ADC token refresh returned empty access_token");
    const expiresInSec = Math.max(120, Number(payload.expires_in) || 3500);
    tokenCache = {
      accessToken,
      expiresAt: now + expiresInSec * 1000,
      sourcePath: adc.filePath,
    };
    return accessToken;
  }

  async function buildVertexRequest({ location = "global", model = "gemini-4-argon" } = {}) {
    const mode = resolveEndpointMode();
    if (mode === "aistudio") {
      const studioKey = resolveAiStudioKey();
      if (!studioKey) {
        throw new Error("未检测到 Google AI Studio API Key：请在 .env 配置 GOOGLE_CLOUD_API_KEY 或 GEMINI_API_KEY");
      }
      return {
        authMode: "aistudio-api-key",
        endpoint: "generativelanguage.googleapis.com",
        project: "google-ai-studio",
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": studioKey,
        },
      };
    }

    const adc = readAdcJson(env);
    const project = resolveProject(adc);
    const baseUrl = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

    if (adc) {
      const token = await refreshAdcToken(adc);
      return {
        authMode: adc.kind,
        endpoint: "aiplatform.googleapis.com",
        project,
        url: baseUrl,
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${token}`,
          "x-goog-user-project": project,
        },
      };
    }

    const apiKey = String(env.GOOGLE_CLOUD_API_KEY || "").trim();
    if (apiKey) {
      return {
        authMode: "api-key",
        endpoint: "aiplatform.googleapis.com",
        project,
        url: `${baseUrl}?key=${encodeURIComponent(apiKey)}`,
        headers: {
          "content-type": "application/json",
        },
      };
    }

    throw new Error("未检测到 Google Cloud ADC 凭证或 API Key：请先运行 gcloud auth application-default login");
  }

  return { detectStatus, buildVertexRequest };
}

module.exports = {
  defaultAdcPath,
  readAdcJson,
  signServiceAccountJwt,
  createVertexAuthProvider,
};
