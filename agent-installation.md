# Agent Instruction Setup

Copy this package into the repository root.

Expected layout:

```text
AGENTS.md
.cursor/
  rules/
    rust-api.mdc
    web-pwa.mdc
    ml.mdc
    data-economy.mdc
    docs.mdc
.opencode/
  agents/
    reviewer.md
```

## OpenCode

OpenCode uses root `AGENTS.md` for persistent project instructions.

The included `.opencode/agents/reviewer.md` adds a read-only strict review subagent.

Example:

```text
Use the reviewer subagent to review my current changes.
```

Official docs:
- https://opencode.ai/v2/docs/instructions
- https://opencode.ai/v2/docs/agents

## Cursor

Cursor also reads root `AGENTS.md`.

The `.cursor/rules/*.mdc` files add file-scoped rules:
- Rust/API
- web/PWA
- ML
- data/economy/infrastructure
- documentation

Official docs:
- https://cursor.com/docs/rules

## Maintenance rule

Keep shared project-wide decisions in `AGENTS.md`.
Put only file/domain-specific additions in Cursor rules.
Avoid copying the full root instructions into each scoped rule.
