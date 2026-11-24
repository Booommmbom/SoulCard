#!/usr/bin/env node
// Automated Zero-Leak Security, Privacy & Core-Purity Audit Gate.
// Fails with exit code 1 if ANY secret, private identifier, hardcoded local path,
// oversized binary, or forbidden IO import inside src/core/ is detected.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const IGNORE_DIRS = new Set([".git", "node_modules", "data", "logs", "backups"]);

const SECRET_PATTERNS = [
  { name: "openai_or_deepseek_sk_key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "anthropic_sk_ant_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: "github_pat_token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: "google_aistudio_aq_key", re: /\bAQ\.[A-Za-z0-9_-]{20,}\b/ },
  { name: "google_aiza_key", re: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
  { name: "xai_api_key", re: /\bxai-[A-Za-z0-9_-]{20,}\b/ },
  { name: "google_oauth_token", re: /\b(?:ya29\.|1\/\/0)[A-Za-z0-9_.-]{16,}\b/ },
  { name: "private_key_block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "hardcoded_windows_user_path", re: /[A-Za-z]:[\\/]+Users[\\/]+(?!YOUR_USER|<user>|runner)[A-Za-z0-9_.-]+/i },
  { name: "hardcoded_macos_user_path", re: /\/Users\/(?!YOUR_USER|<user>|runner)[A-Za-z0-9_.-]+\// },
  { name: "hardcoded_local_workspace_path", re: /[A-Za-z]:[\\/]+Nuomu\b/i },
  { name: "hardcoded_gcp_autogen_project", re: /\bgen-lang-client-\d{6,}\b/i },
];

// Optional caller-supplied private blocklist via env (never hardcoded into public source)
const extraBlocklist = String(process.env.NUOMU_AUDIT_BLOCKLIST ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length >= 4);

const FORBIDDEN_CORE_IMPORTS = /\bfrom\s+["'](?:node:)?(?:fs|sqlite|path|http|https|net|child_process|os|worker_threads)["']|\brequire\s*\(/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = walk(REPO_ROOT);
const findings = [];
let coreFilesChecked = 0;

for (const file of files) {
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  const size = statSync(file).size;
  if (size > 512 * 1024) {
    findings.push({ file: rel, kind: "oversized_file", detail: `${size} bytes > 512KB` });
    continue;
  }
  const text = readFileSync(file, "utf8");

  // Skip self-definition lines inside scripts/security-audit.mjs
  if (rel !== "scripts/security-audit.mjs") {
    for (const pat of SECRET_PATTERNS) {
      if (pat.re.test(text)) {
        findings.push({ file: rel, kind: pat.name, detail: "matched sensitive/private pattern" });
      }
    }
    for (const lit of extraBlocklist) {
      if (text.toLowerCase().includes(lit.toLowerCase())) {
        findings.push({ file: rel, kind: "custom_blocklist_match", detail: "matched NUOMU_AUDIT_BLOCKLIST entry" });
      }
    }
  }

  // Enforce 100% pure zero-IO invariant under src/core/
  if (rel.startsWith("src/core/") && rel.endsWith(".mjs")) {
    coreFilesChecked += 1;
    if (FORBIDDEN_CORE_IMPORTS.test(text)) {
      findings.push({ file: rel, kind: "core_purity_violation", detail: "src/core must not import IO or runtime modules" });
    }
  }
}

const ok = findings.length === 0 && coreFilesChecked >= 15;
console.log(JSON.stringify({ ok, filesScanned: files.length, coreFilesChecked, findings }, null, 2));
process.exit(ok ? 0 : 1);
