---
name: git-guardrails
description: Set up guardrails that block dangerous git commands (push, reset --hard, clean, branch -D, etc.) before they execute. Use when the user wants to prevent destructive git operations or block git push/reset in this project.
---

# Setup Git Guardrails

DSH has no `PreToolUse` hook, so the guardrail is installed where DSH **does** enforce policy: the permission preset plus an `AGENTS.md` rule. The result is the same — the agent cannot talk itself past it — without a hook process.

## What Gets Blocked

- `git push` (all variants including `--force`)
- `git reset --hard`
- `git clean -f` / `git clean -fd`
- `git branch -D`
- `git checkout .` / `git restore .`

## Steps

### 1. Ask scope

Ask the user: **this project only** (`AGENTS.md` at the repo root) or **all projects** (`<DSH_HOME>/AGENTS.md`)? Uppercase `AGENTS.md` is the file DSH reads for standing instructions; `CLAUDE.md` is read too when present, so edit whichever one already exists.

### 2. Ask what to do instead

A blanket block on `git push` stalls real work. Ask which applies:

- **Block outright** — the agent must ask, and must not run the command even after asking.
- **Require approval each time** — the agent asks, then runs it only after an explicit yes in the same turn.
- **Allow, but never force** — plain `git push` is fine; `--force` and `--force-with-lease` are not.

### 3. Write the rule

Append a section to the chosen `AGENTS.md`. Do not overwrite the file; merge into it.

```markdown
## Git guardrails

These commands are off-limits unless the user asks for them in this same turn:

- `git push` (any variant; `--force` and `--force-with-lease` always)
- `git reset --hard`
- `git clean -f` / `git clean -fd`
- `git branch -D`
- `git checkout .` / `git restore .`

If a task seems to need one, stop and ask. Do not work around the rule with
another command that has the same effect (`git push --force` via `git update-ref`,
removing the whole worktree instead of `git clean`, and so on).
```

Adjust that list to the choice made in step 2.

### 4. Consider the sandbox, not just the text

Text in `AGENTS.md` is guidance the model can misread; the sandbox is enforcement. Check the current permission preset with the `/permission` command and prefer `workspace-write` for normal work: writes stay inside the workspace, so a mistaken `git clean` cannot reach outside it. Reserve `danger-full-access` for work that genuinely needs it.

### 5. Verify

Start a fresh session in the repo (the standing instructions are read at session start) and ask the agent to run `git push` on a scratch branch. It should refuse and say why. If it runs the command, the rule did not land — check that the file is named `AGENTS.md` at the repo root and that the section heading is intact.
