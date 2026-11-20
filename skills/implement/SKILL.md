---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Call the `skill` tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, call the `skill` tool with "code-review" to review the work.

Commit your work to the current branch.

## Stage handoff

Under the matt-flow preset, `flow_stage` owns the phase, not this skill. Call it with `action: "status"` before you write anything, so you know which stage the feature is actually in, and `action: "advance"` once this skill's exit criterion is true: it refuses a skipped stage, and it refuses an artifact that is not on disk. Work in `.scratch/<feature>/` — read `spec.md`, `decisions.md`, and the ticket you were given; that is the directory it reads. Do not report the phase as finished on your own authority: report what `flow_stage` returned.

