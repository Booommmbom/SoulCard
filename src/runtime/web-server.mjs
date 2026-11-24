#!/usr/bin/env node
// Nuomu Soul — Zero-Dependency Autonomous Local Web Studio (`npm run web`)
// Binds strictly to 127.0.0.1 (default port 3460). Zero DSH, zero external packages,
// works 100% offline for UI assets and connects seamlessly to ANY relay / domestic API / local Ollama.

import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_PRESETS,
  detectProtocol,
  maskApiKey,
  normalizeApiKey,
  normalizeBaseUrl,
  resolveChatEndpoint,
} from "../core/provider-compat.mjs";
import { CompanionEngine } from "./companion-engine.mjs";
import { listRemoteModels, loadDotEnv, testLlmConnection } from "./llm-client.mjs";
import { upsertDotEnvFile } from "./setup-wizard.mjs";

loadDotEnv();

const WEB_HTML_PATH = fileURLToPath(new URL("../web/index.html", import.meta.url));
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const LOCAL_HOST_HEADER_RE = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function setSecurityHeaders(res, { isHtml = false } = {}) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  if (isHtml) {
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
  }
}

function isAllowedLocalRequest(req) {
  const host = String(req.headers.host || "").trim();
  if (host && !LOCAL_HOST_HEADER_RE.test(host)) return false;
  const origin = String(req.headers.origin || "").trim();
  if (origin && !LOCAL_ORIGIN_RE.test(origin)) return false;
  const secFetchSite = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") return false;
  return true;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  setSecurityHeaders(res);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "request body too large (max 4MB)");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

/**
 * Create the standalone Nuomu Web Studio HTTP server.
 */
export function createWebStudioServer({
  engine = new CompanionEngine(),
  fetchFn = null,
} = {}) {
  const effectiveFetch = fetchFn || engine.fetchFn || globalThis.fetch;

  return http.createServer(async (req, res) => {
    try {
      // Protect localhost server from cross-origin CSRF & DNS-rebinding attacks
      if (!isAllowedLocalRequest(req)) {
        sendJson(res, 403, { ok: false, error: "forbidden: cross-origin or non-localhost Host header rejected" });
        return;
      }

      const urlObj = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = urlObj.pathname;

      // Static single-file Web Studio UI (works 100% offline, zero CDN links)
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        const html = existsSync(WEB_HTML_PATH) ? readFileSync(WEB_HTML_PATH, "utf8") : "<h1>Nuomu Soul Studio</h1>";
        res.statusCode = 200;
        setSecurityHeaders(res, { isHtml: true });
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(html);
        return;
      }

      if (req.method === "GET" && pathname === "/api/health") {
        const snap = engine.getSnapshot();
        sendJson(res, 200, {
          ok: true,
          engine: snap.engine,
          zeroDsh: true,
          configured: snap.llm.configured,
          model: snap.llm.model,
          protocol: snap.llm.protocol,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/state") {
        sendJson(res, 200, {
          ...engine.getSnapshot(),
          presets: PROVIDER_PRESETS,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/chat") {
        const body = await readJsonBody(req);
        const result = await engine.chat(String(body.message ?? body.text ?? ""), {
          pacingMode: String(body.pacingMode || ""),
        });
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }

      if (req.method === "GET" && pathname === "/api/ambient") {
        const force = urlObj.searchParams.get("force") === "1" || urlObj.searchParams.get("force") === "true";
        const isTyping = urlObj.searchParams.get("typing") === "1";
        sendJson(res, 200, engine.checkAmbient({ force, isTyping }));
        return;
      }

      if (req.method === "POST" && pathname === "/api/open-loops/resolve") {
        const body = await readJsonBody(req);
        const r = engine.resolveOpenLoopKey(body.key);
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }

      if (req.method === "POST" && pathname === "/api/consolidate/daily") {
        const body = await readJsonBody(req);
        const force = body.force !== false;
        const r = await engine.consolidateDaily({
          dateKey: body.dateKey || undefined,
          force,
          minMessages: body.minMessages ?? (force ? 2 : 6),
        });
        sendJson(res, 200, r);
        return;
      }

      if (req.method === "POST" && pathname === "/api/consolidate/weekly") {
        const body = await readJsonBody(req);
        const r = await engine.consolidateWeekly({
          weekKey: body.weekKey || undefined,
          force: body.force !== false,
        });
        sendJson(res, 200, r);
        return;
      }

      if (req.method === "POST" && pathname === "/api/consolidate/monthly") {
        const body = await readJsonBody(req);
        const r = await engine.consolidateMonthly({
          monthKey: body.monthKey || undefined,
          force: body.force !== false,
        });
        sendJson(res, 200, r);
        return;
      }

      if (req.method === "GET" && pathname === "/api/soul/export") {
        const exp = engine.exportSoul();
        const payload = JSON.parse(readFileSync(exp.exportPath, "utf8"));
        sendJson(res, 200, { ok: true, exportPath: exp.exportPath, stats: exp.stats, payload });
        return;
      }

      if (req.method === "POST" && pathname === "/api/soul/import") {
        const body = await readJsonBody(req);
        const ledgerPayload = body.payload && typeof body.payload === "object" ? body.payload : body;
        const mode = body.mode === "replace" ? "replace" : "merge";
        const tmpFile = join(engine.stateDir, `.import-tmp-${Date.now()}.json`);
        try {
          writeFileSync(tmpFile, JSON.stringify(ledgerPayload, null, 2), "utf8");
          const r = engine.importSoul(tmpFile, { mode });
          sendJson(res, r.ok ? 200 : 400, r);
        } finally {
          try { if (existsSync(tmpFile)) rmSync(tmpFile, { force: true }); } catch {}
        }
        return;
      }

      if (req.method === "POST" && pathname === "/api/persona") {
        const body = await readJsonBody(req);
        const allowed = {};
        for (const k of ["name", "partnerName", "role", "voiceStyle", "boundaries", "pacingMode"]) {
          if (typeof body[k] === "string" && body[k].trim()) allowed[k] = body[k].trim();
        }
        const saved = engine.savePersona(allowed);
        sendJson(res, 200, { ok: true, persona: saved });
        return;
      }

      if (req.method === "POST" && pathname === "/api/memory/reset") {
        const body = await readJsonBody(req);
        const r = engine.resetMemory({
          keepPersona: body.keepPersona !== false,
          keepCards: body.keepCards === true,
        });
        sendJson(res, 200, r);
        return;
      }

      // --- Portable Future-Companion Memory Cards API ---
      if (req.method === "GET" && pathname === "/api/cards") {
        const category = urlObj.searchParams.get("category") || "all";
        const query = urlObj.searchParams.get("q") || "";
        const pinnedOnly = urlObj.searchParams.get("pinned") === "1";
        const cards = engine.listMemoryCards({ category, query, pinnedOnly });
        sendJson(res, 200, { ok: true, cards, total: cards.length });
        return;
      }

      if (req.method === "POST" && pathname === "/api/cards") {
        const body = await readJsonBody(req);
        const r = engine.addMemoryCard(body);
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }

      if (req.method === "POST" && pathname === "/api/cards/update") {
        const body = await readJsonBody(req);
        const r = engine.updateMemoryCard(body.id, body.patch || body);
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }

      if (req.method === "POST" && pathname === "/api/cards/delete") {
        const body = await readJsonBody(req);
        const r = engine.deleteMemoryCard(body.id);
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }

      if (req.method === "POST" && pathname === "/api/cards/mint") {
        const body = await readJsonBody(req);
        const r = await engine.mintMemoryCardsFromChat({ maxTurns: Number(body.maxTurns) || 12 });
        sendJson(res, r.ok ? 200 : (r.skipped ? 200 : 502), r);
        return;
      }

      if (req.method === "GET" && pathname === "/api/cards/export") {
        const r = engine.exportMemoryCardPack();
        sendJson(res, 200, r);
        return;
      }

      if (req.method === "POST" && pathname === "/api/cards/import") {
        const body = await readJsonBody(req);
        const rawPack = body.pack && typeof body.pack === "object" ? body.pack : body;
        const r = engine.importMemoryCardPack(rawPack, {
          mode: body.mode === "replace" ? "replace" : "merge",
          restorePersona: body.restorePersona === true,
        });
        sendJson(res, r.ok ? 200 : 400, r);
        return;
      }

      // Live URL normalization preview (pure, zero network)
      if (req.method === "POST" && pathname === "/api/config/preview") {
        const body = await readJsonBody(req);
        const cleanUrl = normalizeBaseUrl(body.baseUrl || "");
        const proto = detectProtocol({ baseUrl: cleanUrl, protocol: body.protocol || "auto" });
        const ep = resolveChatEndpoint({ baseUrl: cleanUrl, protocol: proto, model: body.model || "deepseek-chat" });
        sendJson(res, 200, { ok: true, baseUrl: cleanUrl, protocol: proto, chatEndpoint: ep.url });
        return;
      }

      // Auto-discover available models from relay /v1/models
      if (req.method === "POST" && pathname === "/api/config/models") {
        const body = await readJsonBody(req);
        const cur = engine.getLlmConfig();
        const baseUrl = normalizeBaseUrl(body.baseUrl || cur.baseUrl);
        const apiKey = body.apiKey ? normalizeApiKey(body.apiKey) : cur.apiKey;
        const protocol = body.protocol || "auto";
        const r = await listRemoteModels({ baseUrl, apiKey, protocol, fetchFn: effectiveFetch });
        sendJson(res, 200, r);
        return;
      }

      // Test connection & save relay config to `.env` (takes effect immediately without server restart!)
      if (req.method === "POST" && (pathname === "/api/config" || pathname === "/api/config/test")) {
        const body = await readJsonBody(req);
        const cur = engine.getLlmConfig();
        const cleanUrl = normalizeBaseUrl(body.baseUrl || cur.baseUrl);
        if (!cleanUrl) {
          sendJson(res, 400, { ok: false, error: "请先输入中转站或模型接口网址" });
          return;
        }
        const cleanKey = body.apiKey !== undefined && String(body.apiKey).trim() !== ""
          ? normalizeApiKey(body.apiKey)
          : (body.clearKey ? "" : cur.apiKey);
        const detectedProto = detectProtocol({ baseUrl: cleanUrl, protocol: body.protocol || "auto" });
        const model = String(body.model || cur.model || (detectedProto === "ollama" ? "qwen2.5:7b-instruct" : "deepseek-chat")).trim();

        const testResult = body.skipTest
          ? null
          : await testLlmConnection({
            baseUrl: cleanUrl,
            apiKey: cleanKey,
            model,
            protocol: detectedProto,
            fetchFn: effectiveFetch,
          });

        if (pathname === "/api/config") {
          upsertDotEnvFile(engine.envPath, {
            LLM_BASE_URL: cleanUrl,
            LLM_API_KEY: cleanKey,
            LLM_MODEL: model,
            LLM_PROTOCOL: detectedProto,
          });
          process.env.LLM_BASE_URL = cleanUrl;
          process.env.LLM_API_KEY = cleanKey;
          process.env.LLM_MODEL = model;
          process.env.LLM_PROTOCOL = detectedProto;
          engine.llmOverrides = { baseUrl: cleanUrl, apiKey: cleanKey, model, protocol: detectedProto };
        }

        const ep = resolveChatEndpoint({ baseUrl: cleanUrl, protocol: detectedProto, model });
        sendJson(res, 200, {
          ok: true,
          saved: pathname === "/api/config",
          config: {
            baseUrl: cleanUrl,
            chatEndpoint: ep.url,
            protocol: detectedProto,
            model,
            maskedKey: maskApiKey(cleanKey),
          },
          testResult,
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
      sendJson(res, status, { ok: false, error: String(err?.message || err) });
    }
  });
}

function listenWithAutoFallback(server, startPort, maxAttempts = 10) {
  return new Promise((resolvePort, rejectErr) => {
    let attempt = 0;
    const tryPort = (port) => {
      const onError = (err) => {
        if (err.code === "EADDRINUSE" && attempt < maxAttempts - 1) {
          attempt += 1;
          tryPort(port + 1);
          return;
        }
        rejectErr(err);
      };
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        resolvePort(port);
      });
    };
    tryPort(startPort);
  });
}

function openInDefaultBrowser(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {}
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const requestedPort = Number(process.env.NUOMU_WEB_PORT || 3460);
  const autoOpen = process.argv.includes("--open") || process.env.NUOMU_AUTO_OPEN === "1";
  const engine = new CompanionEngine();
  const server = createWebStudioServer({ engine });
  listenWithAutoFallback(server, requestedPort).then((boundPort) => {
    const snap = engine.getSnapshot();
    const url = `http://127.0.0.1:${boundPort}`;
    console.log("\n==============================================================");
    console.log("  Nuomu Soul — Cloud-First Zero-GPU Companion Studio");
    if (boundPort !== requestedPort) {
      console.log(`  Notice         : Port ${requestedPort} is busy, auto-switched to ${boundPort}`);
    }
    console.log(`  Open in browser: ${url}`);
    console.log(`  Data directory : ${snap.dataDir}`);
    console.log(`  Active LLM     : ${snap.llm.model} (${snap.llm.source}:${snap.llm.protocol})`);
    console.log("==============================================================\n");
    if (autoOpen) openInDefaultBrowser(url);
  }).catch((err) => {
    console.error(`✖ 启动失败: ${err?.message || err}`);
    process.exit(1);
  });
}
