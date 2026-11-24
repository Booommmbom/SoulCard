#!/usr/bin/env node
// Nuomu Soul — Native Zero-DSH OneBot v11 HTTP Webhook Bridge
// Connects NapCat / go-cqhttp / Lagrange or any OneBot v11 client directly to CompanionEngine
// with ZERO external dependencies and ZERO DSH runtime required.
//
// Usage:
//   ONEBOT_LISTEN_PORT=3461 ONEBOT_API_URL=http://127.0.0.1:3000 ONEBOT_OWNER_ID=<your_id> node src/runtime/onebot-bridge.mjs

import crypto from "node:crypto";
import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CompanionEngine } from "./companion-engine.mjs";
import { loadDotEnv } from "./llm-client.mjs";

loadDotEnv();

const MAX_ONEBOT_BODY_BYTES = 1 * 1024 * 1024;

function verifyOneBotSignature(rawBuf, headerSig, secret) {
  if (!secret) return true;
  const sig = String(headerSig || "").trim();
  if (!sig.startsWith("sha1=")) return false;
  const expected = "sha1=" + crypto.createHmac("sha1", secret).update(rawBuf).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)));
}

/**
 * Extract plain conversational text from a OneBot v11 message event (string or CQ segment array).
 */
export function extractOneBotText(event = {}) {
  if (typeof event.raw_message === "string" && event.raw_message.trim()) {
    return event.raw_message.replace(/\[CQ:[^\]]+\]/g, "").trim();
  }
  if (Array.isArray(event.message)) {
    return event.message
      .filter((seg) => seg && seg.type === "text" && typeof seg.data?.text === "string")
      .map((seg) => seg.data.text)
      .join("")
      .trim();
  }
  if (typeof event.message === "string") {
    return event.message.replace(/\[CQ:[^\]]+\]/g, "").trim();
  }
  return "";
}

/**
 * Create a standalone Zero-DSH OneBot v11 HTTP event server.
 */
export function createOneBotBridgeServer({
  engine = new CompanionEngine(),
  onebotApiUrl = process.env.ONEBOT_API_URL || "http://127.0.0.1:3000",
  onebotToken = process.env.ONEBOT_ACCESS_TOKEN || "",
  webhookSecret = process.env.ONEBOT_WEBHOOK_SECRET || "",
  ownerId = String(process.env.ONEBOT_OWNER_ID || "").trim(),
  fetchFn = globalThis.fetch,
  deliverDelay = true,
} = {}) {
  const cleanApiBase = String(onebotApiUrl || "").replace(/\/+$/, "");

  async function sendPrivateMsg(userId, message) {
    if (!cleanApiBase) return { ok: false, error: "ONEBOT_API_URL not configured" };
    const headers = { "content-type": "application/json" };
    if (onebotToken) headers.authorization = `Bearer ${onebotToken}`;
    const res = await fetchFn(`${cleanApiBase}/send_private_msg`, {
      method: "POST",
      headers,
      body: JSON.stringify({ user_id: Number(userId) || userId, message }),
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, status: res.status };
  }

  return http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (req.method === "GET" && req.url === "/health") {
      res.end(JSON.stringify({
        ok: true,
        bridge: "nuomu-onebot-v11-zero-dsh",
        ownerAllowlistEnabled: Boolean(ownerId),
        hmacVerificationEnabled: Boolean(webhookSecret),
      }));
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
      return;
    }

    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_ONEBOT_BODY_BYTES) {
        res.statusCode = 413;
        res.end(JSON.stringify({ ok: false, error: "payload too large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
    const rawBuf = Buffer.concat(chunks);

    if (webhookSecret && !verifyOneBotSignature(rawBuf, req.headers["x-signature"], webhookSecret)) {
      res.statusCode = 403;
      res.end(JSON.stringify({ ok: false, error: "invalid x-signature" }));
      return;
    }

    let event;
    try {
      event = JSON.parse(rawBuf.toString("utf8") || "{}");
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "invalid JSON" }));
      return;
    }

    // Only process private messages; enforce optional owner allowlist
    if (event.post_type !== "message" || event.message_type !== "private") {
      res.end(JSON.stringify({ ok: true, ignored: true, reason: "non_private_event" }));
      return;
    }
    const senderId = String(event.user_id ?? "").trim();
    if (ownerId && senderId !== ownerId) {
      res.end(JSON.stringify({ ok: true, ignored: true, reason: "not_in_owner_allowlist" }));
      return;
    }

    const text = extractOneBotText(event);
    if (!text) {
      res.end(JSON.stringify({ ok: true, ignored: true, reason: "empty_text" }));
      return;
    }

    const result = await engine.chat(text);
    if (!result.ok) {
      res.statusCode = 502;
      res.end(JSON.stringify({ ok: false, error: result.error }));
      return;
    }

    const bubbles = result.pacing?.bubbles || [{ text: result.reply, delayMs: 0 }];
    const deliveries = [];
    for (let i = 0; i < bubbles.length; i += 1) {
      if (deliverDelay && i > 0 && bubbles[i].delayMs > 0) {
        await sleep(Math.min(4500, bubbles[i].delayMs));
      }
      deliveries.push(await sendPrivateMsg(senderId, bubbles[i].text));
    }
    res.end(JSON.stringify({ ok: true, bubblesSent: bubbles.length, deliveries, reply: result.reply }));
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const port = Number(process.env.ONEBOT_LISTEN_PORT || 3461);
  const server = createOneBotBridgeServer();
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`✖ 端口 ${port} 已被占用，请通过环境变量 ONEBOT_LISTEN_PORT 指定空闲端口后重试。`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Nuomu Zero-DSH OneBot v11 Bridge listening on http://127.0.0.1:${port}`);
    if (!String(process.env.ONEBOT_OWNER_ID || "").trim()) {
      console.warn("⚠ 安全提示：未设置 ONEBOT_OWNER_ID，当前将响应所有私聊消息；建议在 .env 中设置你的专属账号 ID。");
    }
  });
}
