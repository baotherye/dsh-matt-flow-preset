---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Start every subagent with a fresh context window.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.


## Stage handoff

Under the matt-flow preset, `flow_stage` owns the phase, not this skill. Call it with `action: "status"` before you write anything, so you know which stage the feature is actually in, and `action: "advance"` once this skill's exit criterion is true: it refuses a skipped stage, and it refuses an artifact that is not on disk. Work in `.scratch/<feature>/` — read `spec.md`, `decisions.md`, and every ticket under `issues/`; that is the directory it reads. Do not report the phase as finished on your own authority: report what `flow_stage` returned.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use a fresh **implementer subagent** for each ticket, each on its own branch in its own checkout. Use `create_worktree` (it creates the branch and directory and leaves them in place); if it isn't in your tool set, `git worktree add .worktrees/<slug> -b <slug> <integration-branch>` does the same thing. Pass the directory as the child's `cwd`. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - calls the `skill` tool with `tdd` to build the ticket;
   - merges the integration branch tip into its own branch before reporting done

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency. When the frontier is wide (three or more tickets ready at once), reach for the `workflow` tool instead of hand-rolling the loop: write the dispatch as a script and fan the implementers out in phases.

7. Once all tickets are complete, call the `skill` tool with `code-review` on the integration branch. Fix all issues raised by the code review in a single fresh **implementer subagent**.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

9. Clean up all **implementer subagent** worktrees. `create_worktree` leaves the checkout and branch in place by design, so remove them with `git worktree remove <path>` once the integration branch holds their work.
