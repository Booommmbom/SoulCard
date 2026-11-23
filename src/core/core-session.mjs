// Core-owned conversation state. Pure: the store is injected; Core does not
// import SQLite or DSH. History is assistant-facing continuity, not a duplicate
// of the compact/full recent-turn snapshot.

export class CoreSession {
	constructor({ store, maxHistory = 6, maxHistoryChars = 4000 }) {
		if (store === null || typeof store !== "object") throw new TypeError("CoreSession: store is required");
		if (typeof store.getRecentAssistant !== "function") throw new TypeError("CoreSession: store.getRecentAssistant is required");
		if (typeof store.recordTurn !== "function") throw new TypeError("CoreSession: store.recordTurn is required");
		this.store = store;
		this.maxHistory = Math.max(0, Number(maxHistory) || 0);
		this.maxHistoryChars = Math.max(200, Number(maxHistoryChars) || 4000);
	}

	history(conversationId, limit = this.maxHistory, options = {}) {
		if (this.maxHistory === 0) return [];
		const since = Math.max(0, Number(options.since ?? 0) || 0);
		const fetchLimit = since > 0 ? Math.max(limit, 20) : limit;
		const rows = this.store.getRecentAssistant(String(conversationId ?? ""), Math.max(1, Math.min(20, Number(fetchLimit) || this.maxHistory)));
		if (!Array.isArray(rows)) return [];
		const filtered = since > 0 ? rows.filter((row) => Number(row?.ts ?? 0) >= since) : rows;
		const selected = [];
		let chars = 0;
		for (let index = filtered.length - 1; index >= 0; index -= 1) {
			const row = filtered[index];
			const size = String(row?.text ?? "").length;
			if (selected.length > 0 && chars + size > this.maxHistoryChars) break;
			selected.unshift(row);
			chars += size;
		}
		return selected;
	}

	toolNotes(conversationId, limit = 3, options = {}) {
		if (typeof this.store.getRecentTools !== "function") return "";
		const since = Math.max(0, Number(options.since ?? 0) || 0);
		const rows = this.store.getRecentTools(String(conversationId ?? ""), Math.max(1, Math.min(8, Number(limit) || 3)));
		const filtered = Array.isArray(rows) && since > 0 ? rows.filter((row) => Number(row?.ts ?? 0) >= since) : rows;
		if (!Array.isArray(filtered) || filtered.length === 0) return "";
		return "[最近工具结果，仅用于衔接，不要重复执行]\n" + filtered.map((row) => {
			const args = String(row.argsJson ?? "").slice(0, 240);
			const result = row.status === "ok" ? String(row.output ?? "") : String(row.error ?? row.status ?? "");
			return `- ${String(row.name ?? "")}(${args}) -> ${row.status}: ${result.slice(0, 240)}`;
		}).join("\n");
	}

	record({ conversationId, turnId, userText, replyText, toolCalls = [], toolResults = [], usage = null, stopReason = "" }) {
		const id = String(conversationId ?? "");
		const result = this.store.recordTurn({
			conversationId: id,
			turnId: String(turnId ?? ""),
			userText: String(userText ?? ""),
			replyText: String(replyText ?? ""),
			toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
			toolResults: Array.isArray(toolResults) ? toolResults : [],
			usage: usage ?? null,
			stopReason: String(stopReason ?? "")
		});
		if (typeof this.store.setSession === "function" && typeof this.store.getRecentAssistant === "function") {
			try {
				const existing = typeof this.store.getSession === "function" ? this.store.getSession(id) : null;
				if (existing?.summary === void 0 || existing.summary === "") {
					const rows = this.store.getRecentAssistant(id, 12);
					const summary = rows.map((row) => "- " + String(row.text ?? "")).join("\n").slice(-4000);
					this.store.setSession(id, {
						summary,
						checkpoint: {
							at: Date.now(),
							lastTurnId: String(turnId ?? ""),
							assistantCount: Array.isArray(rows) ? rows.length : 0,
							source: "deterministic"
						}
					});
				}
			} catch {}
		}
		return result;
	}

	needsCompaction(conversationId, threshold = 12) {
		if (typeof this.store.getRecentAssistant !== "function") return false;
		const id = String(conversationId ?? "");
		const rows = this.store.getRecentAssistant(id, 100);
		if (!Array.isArray(rows) || rows.length <= threshold) return false;
		if (typeof this.store.getSession === "function") {
			const checkpoint = this.store.getSession(id);
			try {
				const meta = JSON.parse(checkpoint?.checkpoint ?? "{}");
				if (meta?.source === "llm") {
					if (typeof meta.lastTurnId === "string" && meta.lastTurnId !== "") {
						let idx = -1;
						for (let i = rows.length - 1; i >= 0; i -= 1) {
							if (String(rows[i]?.turnId ?? "") === meta.lastTurnId) { idx = i; break; }
						}
						if (idx !== -1 && (rows.length - 1 - idx) < 6) return false;
					} else if (Number(meta.lastTs ?? 0) > 0) {
						const newer = rows.filter((row) => Number(row?.ts ?? 0) > Number(meta.lastTs)).length;
						if (newer < 6) return false;
					} else if (Number(meta?.assistantCount ?? 0) + 6 > rows.length) {
						return false;
					}
				}
			} catch {}
		}
		return true;
	}

	compactionInput(conversationId, limit = 40) {
		if (typeof this.store.getRecentAssistant !== "function") return "";
		const rows = this.store.getRecentAssistant(String(conversationId ?? ""), Math.max(this.maxHistory + 1, Math.min(100, limit)));
		if (!Array.isArray(rows) || rows.length <= this.maxHistory) return "";
		const replies = rows.slice(0, -this.maxHistory).map((row) => {
			const u = String(row.userText ?? "").trim();
			const a = String(row.text ?? "").trim();
			return u !== "" ? `- 对方: ${u} | 我: ${a}` : `- ${a}`;
		}).join("\n");
		const tools = this.toolNotes(conversationId, 8);
		return (replies + (tools === "" ? "" : "\n\n" + tools)).slice(-12000);
	}

	setCheckpoint(conversationId, summary) {
		if (typeof this.store.setSession !== "function") return false;
		const id = String(conversationId ?? "");
		const recent = this.store.getRecentAssistant(id, 100);
		const last = Array.isArray(recent) && recent.length > 0 ? recent[recent.length - 1] : null;
		this.store.setSession(id, {
			summary: String(summary ?? "").slice(0, 4000),
			checkpoint: {
				at: Date.now(),
				source: "llm",
				assistantCount: Array.isArray(recent) ? recent.length : 0,
				lastTurnId: String(last?.turnId ?? ""),
				lastTs: Number(last?.ts ?? Date.now())
			}
		});
		return true;
	}

	async compact(conversationId, summarize) {
		if (typeof summarize !== "function") throw new TypeError("CoreSession.compact: summarize is required");
		const input = this.compactionInput(conversationId, 40);
		if (input === "") return false;
		const summary = String(await summarize(input) ?? "").trim();
		if (summary === "") return false;
		return this.setCheckpoint(conversationId, summary);
	}

	checkpoint(conversationId) {
		if (typeof this.store.getSession !== "function") return null;
		return this.store.getSession(String(conversationId ?? "")) ?? null;
	}
}
