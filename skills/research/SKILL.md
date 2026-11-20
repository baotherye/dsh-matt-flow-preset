---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a subagent.
---

Delegate the reading to a **subagent** with the `subagent` tool, so you keep working while it reads. The child has its own context window, which is the point: the raw reading never lands in yours.

```
subagent(
  description: "Research <topic>",
  prompt: "<the question, the primary sources to start from, and where to write the findings>"
)
```

The call returns as soon as the child is registered, so you can keep working; its completion notice arrives on its own, and `send_message` steers it if the brief was wrong. Ask it to report back the file path and a short summary, not the whole document — the file is the artifact.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
