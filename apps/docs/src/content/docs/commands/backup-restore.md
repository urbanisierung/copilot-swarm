---
title: "swarm backup & restore"
description: Sync .swarm/ artifacts to and from the central store.
---

All `.swarm/` artifacts are automatically synced to a central store on every checkpoint save and session finish. Use these commands for manual control.

## Usage

```bash
# Manual sync to central store
swarm backup

# Restore from central store
swarm restore
```

## Central Store Location

```
~/.config/copilot-swarm/backups/
```

The store mirrors the full `.swarm/` directory structure per repository, keyed by the repo's absolute path.
