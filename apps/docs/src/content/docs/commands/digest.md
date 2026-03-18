---
title: "swarm digest"
description: Show a concise highlights summary of a completed run.
---

View a human-readable overview of what a run accomplished, without reading through raw agent output.

## Usage

```bash
swarm digest                           # Digest the latest run
swarm digest --run <runId>             # Digest a specific run
swarm digest --session <id>            # Digest latest run in a session
```

## Output Example

```
─────────────────────────────────────────────────
📋 Run Digest — 2026-03-01T07-00-00-000Z
─────────────────────────────────────────────────

## What was done
Implemented OAuth2 PKCE flow with token rotation,
added database index, updated environment docs.

## Key decisions
- PKCE stores code verifier in httpOnly cookie
- Token rotation uses sliding window expiry

## Files changed
- src/auth/oauth2-pkce.ts (new)
- src/auth/token-rotation.ts (new)
- migrations/003_add_email_index.sql (new)

## Status
✅ Build passed  ✅ Tests passed (3 new, 247 total)

─────────────────────────────────────────────────
```

The digest reads the run's artifacts (checkpoint, summary, role files) and uses the fast model to produce the overview.
