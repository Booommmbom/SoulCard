#!/usr/bin/env node
// Nuomu Soul — Native Zero-DSH OneBot v11 HTTP Webhook Bridge
// Connects NapCat / go-cqhttp / Lagrange or any OneBot v11 client directly to CompanionEngine
// with ZERO external dependencies and ZERO DSH runtime required.
//
// Usage:
//   ONEBOT_LISTEN_PORT=3461 ONEBOT_API_URL=http://127.0.0.1:3000 ONEBOT_OWNER_ID=<your_id> node src/runtime/onebot-bridge.mjs

import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CompanionEngine } from "./companion-engine.mjs";
import { loadDotEnv } from "./llm-client.mjs";

loadDotEnv();

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
      res.end(JSON.stringify({ ok: true, bridge: "nuomu-onebot-v11-zero-dsh", ownerAllowlistEnabled: Boolean(ownerId) }));
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
      return;
    }

    let raw = "";
    for await (const chunk of req) raw += chunk;
    let event;
    try {
      event = JSON.parse(raw || "{}");
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
  server.listen(port, "127.0.0.1", () => {
    console.log(`Nuomu Zero-DSH OneBot v11 Bridge listening on http://127.0.0.1:${port}`);
  });
}
