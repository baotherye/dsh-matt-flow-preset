# Bundled skills — upstream attribution

The `skills/` directory ships inside this package so that the Matt 工程流 preset
works the moment the plugin is installed, with no download step and no shared
directory involved.

Those skills are not ours. They come from **Matt Pocock's skills** repository:

- Source: https://github.com/mattpocock/skills
- License: MIT
- Vendored at version: snapshot taken 2026-11-20

The skill text is redistributed here under the terms of that MIT license. The
original MIT copyright notice is reproduced below, as the license requires.

Several skills have been edited so they match DeepSeek Harness instead of
Claude Code (see the differences listed after the notice). Those edits are
derivative work under the same MIT terms.

---

## Upstream MIT notice

```
MIT License

Copyright (c) Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Local changes from upstream

| Skill | Change |
| --- | --- |
| `handoff-agent` (was `claude-handoff`) | Renamed. Launches a DSH `subagent` seeded with the handoff file instead of `claude --bg`; explains `subagent_fork` for conversation inheritance and `send_message` for steering. |
| `git-guardrails` (was `git-guardrails-claude-code`) | Renamed. DSH has no `PreToolUse` hook, so the guardrail is written into `AGENTS.md` and paired with the `/permission` preset instead of `.claude/settings.json` hooks. The hook script was dropped. |
| all skills | `Skill tool` references rewritten to the DSH `skill` tool. |
| `ask-matt`, `ask-matt/PHASE-BOUNDARIES.md` | `/clear` replaced with "start a new session"; the fixed ~150k-token smart-zone heuristic replaced with DSH's live context usage and automatic compaction. |
| `research`, `ask-matt`, `chief-of-staff` | "background agent" replaced with the DSH `subagent` tool and its actual parameters. |
| all skills | `agents/openai.yaml` interface files removed (OpenAI-specific, unused by DSH). |
