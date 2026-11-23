# Contributing to Nuomu Soul

Thank you for your interest in contributing to **Nuomu Soul**!

## Core Engineering Standards

1. **Pure Core Invariant (`src/core/`)**
   - Every file under `src/core/` MUST remain 100% pure JavaScript (ESM) with **zero** imports from `node:fs`, `node:sqlite`, `node:path`, `node:http`, `node:child_process`, or external packages.
   - All timestamps (`now`), random seeds, and storage adapters must be injected via function arguments so behavior is deterministic and testable.
2. **Zero-Leak Security Gate**
   - Never commit real API keys, tokens, credentials, private chat transcripts, or machine-specific local paths.
   - Always run `npm run audit:secrets` and `npm test` before opening a pull request.
3. **Honesty & Anti-Sycophancy Philosophy**
   - New prompts, eval scenarios, and growth rules must preserve companion autonomy and factual honesty (explicitly admitting unknown memories rather than fabricating details).

## Verification Commands

```bash
npm run audit:secrets
npm test
npm run demo
```
