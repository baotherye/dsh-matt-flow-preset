---
name: handoff-agent
description: Hand the current conversation off to a fresh subagent that picks up the work immediately.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Write a handoff summary of the current conversation so a fresh agent can continue the work. Save it to the temporary directory of the user's OS, then start a subagent seeded with it as its prompt via the `subagent` tool: pass the file's **path** and have the child read it, rather than pasting the summary into `prompt` — the child works in its own context, so the summary is data it loads, not a message that needs to survive quoting.

```
subagent(
  description: "<3-5 words>",
  name: "<descriptive-name>",
  prompt: "Read <summary file path> and continue the work it describes. You are picking up a handed-off task; the file is your brief."
)
```

The child starts in the current working directory and inherits this session's working directory unless you pass `cwd`. The call returns as soon as the child is registered; the runtime delivers its completion notice to you when it finishes, and you can steer it with `send_message` while it runs.

Prefer `subagent_fork` instead when the work builds on this conversation: it seeds the child with the completed turns directly, so no summary file is needed. Use the plain `subagent` + summary file when the work is self-contained and should start from a clean context.

Include a "suggested skills" section in the summary, naming which skills the next agent should load with the `skill` tool. In DSH the child sees the same preset skill catalog, so name them exactly as they appear there.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information, since the summary becomes the agent's prompt.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the summary accordingly.
