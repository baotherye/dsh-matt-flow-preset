/**
 * dsh-matt-flow — a thin orchestration layer over the user's Matt Pocock Agent Skills.
 *
 * It contributes two things and nothing else:
 *   1. a system-prompt section that makes the installed skill suite usable as a
 *      staged engineering workflow, and
 *   2. the `flow_stage` tool, which owns the phase of one feature and refuses
 *      skipped stages or missing artifacts.
 *
 * The skills themselves ship inside this package, in `skills/`, and only the
 * matt preset declares that directory as a skill root — no other agent preset
 * scans it, and nothing is downloaded at runtime.
 *
 * This module deliberately imports only Node builtins: it is installed as a
 * `link:` package outside the profile, where bare `@deepseek-ai/*` specifiers do
 * not resolve.
 *
 * @module dsh-matt-flow
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const name = 'matt-flow'

/** Bumped with package.json; the startup breadcrumbs carry it so a stale module is visible. */
const PLUGIN_VERSION = '0.10.0'

/** Startup breadcrumbs, so a "never started" report can be told apart from a silent no-op. */
const LOG_DIR = tmpdir()
const LOAD_LOG = join(LOG_DIR, 'dsh-matt-flow-load.log')
const APPLY_LOG = join(LOG_DIR, 'dsh-matt-flow-apply.log')

/** Skills the flow cannot run without; every one must exist under the bundled skills dir. */
/**
 * Only the skills this flow reaches for. Installing the whole package pulls in
 * writing and scaffolding skills nobody here uses, and every missing one is a
 * reason to refuse the session.
 */
const REQUIRED_SKILLS = [
  // The flow itself
  'ask-matt', 'grilling', 'grill-me', 'grill-with-docs',
  'domain-modeling', 'triage', 'wayfinder',
  'to-spec', 'to-tickets',
  'implement', 'tdd', 'code-review', 'codebase-design',
  'improve-codebase-architecture', 'diagnosing-bugs',
  'prototype', 'research',
  // `resolving-merge-conflicts` is deliberately absent: upstream removed it
  // (CHANGELOG, PR #1120) and asked for no replacement — the agent resolves a
  // merge inline. Listing it would report the bundle as incomplete.
  'pr', 'handoff', 'migrate-to-shoehorn',
  // User-invoked, named in the prompt: the corrective and the retrospective
  'retro', 'wait-what',
  // Non-negotiable: the initialisation templates live here
  'setup-matt-pocock-skills', 'setup-pre-commit',
]

/**
 * The skills ship inside this package, under `skills/`, so there is nothing to
 * install and no shared directory to leak into: the files are only readable by
 * a preset that scans this exact directory. The preset declares it as
 * `customSkillDirs` in cordis.patch.yml (evaluated with `!!js`), which no other
 * agent preset has, so the suite is invisible outside preset-matt.
 *
 * `import.meta.dirname` is the package root — this module's own directory —
 * which is the one path that stays correct whether the package is npm-installed
 * into a profile or linked from a checkout. Keep the patch formula identical.
 */
const PACKAGE_ROOT = import.meta.dirname
const BUNDLED_SKILLS_DIR = join(PACKAGE_ROOT, 'skills')

function mark(file, note) {
  try {
    appendFileSync(file, `${new Date().toISOString()} pid=${process.pid} ${note}\n`)
  } catch {
    // diagnostics must never break activation
  }
}

mark(LOAD_LOG, `module imported v${PLUGIN_VERSION}`)

const STAGES = ['grill', 'spec', 'tickets', 'implement', 'done']

/**
 * Retired stages, folded onto the current ladder: `setup`/`idea` predate the
 * real first stage, and `review` is now an activity inside `implement` — a
 * feature recorded at `review` had already finished implementing, so it lands
 * on `done`.
 */
const STAGE_ALIASES = { setup: 'grill', idea: 'grill', review: 'done' }

/**
 * Resolve a recorded stage name onto the current ladder.
 * @param {unknown} stage stage as stored or folded
 * @returns {string} a current stage, defaulting to the first one
 */
function normalizeStage(stage) {
  const name = typeof stage === 'string' ? (STAGE_ALIASES[stage] ?? stage) : ''
  return STAGES.includes(name) ? name : STAGES[0]
}

/**
 * Written to `docs/agents/issue-tracker.md` the first time a repo is used. The
 * local-markdown convention is self-contained, so initialisation needs no
 * question and no network: the file appears, and later stages simply find it.
 * Matches the layout `setup-matt-pocock-skills` documents for a local tracker.
 */
const TRACKER_TEMPLATE = `# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in \`.scratch/\`.

## Conventions

- One feature per directory: \`.scratch/<feature-slug>/\`
- The spec is \`.scratch/<feature-slug>/spec.md\`
- Implementation issues are one file per ticket at \`.scratch/<feature-slug>/issues/<NN>-<slug>.md\`, numbered from \`01\`, never a single combined tickets file
- Triage state is recorded as a \`Status:\` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a \`## Comments\` heading

## When a skill says "publish to the issue tracker"

Create a new file under \`.scratch/<feature-slug>/\` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.
`

const FEATURE_ROOT = '.scratch'
const TRACKER_DOC = 'docs/agents/issue-tracker.md'
const TRACKER_MIN_CHARS = 40
const SPEC_MIN_CHARS = 200
const EVIDENCE_MIN_CHARS = 8

const FLOW_SECTION = `# Development workflow (Matt Pocock skill suite)

This deployment carries the user's engineering skills bundled with the plugin, where only this preset can see them. Treat that suite as the default way to do feature work.

## This flow governs, not the repo's other processes

A repository often already documents its own process: a change directory, a plan template, an issue sequence, a homegrown checklist. Those are **inputs and output formats**, not a replacement for this flow. Unless the user says otherwise:

- The six stages and their preconditions still govern. \`flow_stage\` remains the phase owner; do not switch to another tool's phase model just because the repo mentions one.
- When the repo's tooling expects artifacts, write them **inside the stage that produces that content** — a change directory or proposal document belongs to the spec stage, a task list belongs to the tickets stage. Adapt the shape; keep the order.
- If the repo's documented process genuinely conflicts — a mandatory sequence, a required approval gate, a different definition of "done" — stop and ask the user which one governs. Do not silently follow the repo's process instead, and do not silently ignore it either.

Reading the repo's conventions is expected (\`AGENTS.md\`, \`docs/agents/*\`, an existing change directory); following them in place of this flow is not.

## What you can and cannot load

Model-invocable — load them with the \`skill\` tool: \`grilling\`, \`tdd\`, \`code-review\`, \`codebase-design\`, \`domain-modeling\`, \`diagnosing-bugs\`, \`prototype\`, \`research\`, \`pr\`, \`git-guardrails\`, \`migrate-to-shoehorn\`, \`scaffold-exercises\`, \`setup-pre-commit\`, \`wizard\`, \`writing-for-agents\`.

User-only — the model cannot load these; only the user can type them: \`/ask-matt\`, \`/grill-with-docs\`, \`/grill-me\`, \`/to-spec\`, \`/to-tickets\`, \`/implement\`, \`/implement-spec\`, \`/triage\`, \`/wayfinder\`, \`/improve-codebase-architecture\`, \`/handoff\`, \`/handoff-agent\`, \`/retro\`, \`/wait-what\`, \`/teach\`, \`/loop-me\`, \`/chief-of-staff\`, \`/writing-beats\`, \`/writing-fragments\`, \`/writing-shape\`, \`/to-questionnaire\`, \`/software-factory\`, \`/setup-matt-pocock-skills\`, \`/setup-ts-deep-modules\`.

Never claim to have run a user-only skill. Either do the equivalent work with the primitives, or name the command and ask the user to run it.

## When the suite is missing

The skills ship inside the plugin, so they are present the moment it is installed: nothing is downloaded, and there is no install step you could run. If the catalog above does not list them, the plugin package is installed partially — a broken installation, not a machine waiting to be provisioned. \`flow_stage\` refuses in that case rather than offering a repair, because no command would help. Report exactly what it says and ask the user to reinstall the plugin. Never substitute your own memory for a skill you could not load.

## Route

- New idea or feature request → the main flow below.
- A bug that survives a first look → load \`diagnosing-bugs\`. Do not theorise before you have one command that already goes red on this bug.
- Incoming issues to sort → ask the user to run \`/triage\`.
- Fog too thick for one session → ask the user to run \`/wayfinder\`.
- A design question that needs runnable code → load \`prototype\`.
- Codebase upkeep → propose \`/improve-codebase-architecture\`.

## Before anything else

Initialisation is **not** your decision and not a question you put to the user: \`flow_stage\` performs it on first use.

- Before it writes anything, the user gets an approval prompt that names the exact work: the files it will create. If they refuse, nothing is written and the call fails — say what stopped and wait for their instruction rather than retrying.
- It writes the per-repo configuration \`setup-matt-pocock-skills\` scaffolds: \`docs/agents/issue-tracker.md\`, \`docs/agents/domain.md\`, \`docs/agents/triage-labels.md\` when the triage skill is installed, and the \`## Agent skills\` block in \`AGENTS.md\` (or \`CLAUDE.md\` when the repo already uses it — DSH reads AGENTS.md first).
- The issue tracker is fixed to local markdown under \`.scratch/\`. That is the only place this flow departs from asking.

If the call comes back with an error, read it: it says whether the user refused, the plugin install is incomplete, or the templates are missing.

## Main flow

1. **grill** — load \`grilling\` and \`domain-modeling\`, which together are what the user-facing \`/grill-with-docs\` runs. Interview until the frontier is empty: facts are yours to find, decisions are the user's. No code and no spec yet. Write terms into \`GLOSSARY.md\` (the file \`domain-modeling\` maintains) and hard-to-reverse choices into \`docs/adr/\` as they settle, but create those files lazily — with no new term and no such decision, write neither.

When a decision can be answered by picking one of two to four options, put it on a card with \`flow_ask\` instead of writing it as prose: at most three questions per call, each option one short line, the recommended one first. The user's submission arrives as their next message; record the settled decisions in \`.scratch/<feature>/decisions.md\` before advancing to \`spec\`.

Prefer \`flow_ask\` over the built-in \`ask_user_question\` whenever an answer needs both a choice and a value — "pick a naming strategy, then give me the actual name", "choose the retry policy, then the count". The built-in card advances the moment a single choice is clicked, so the user never reaches the field; and in a single-select question its text answer clears the choice, so the two cannot be given together. \`flow_ask\` keeps them separate: the option and the note are submitted as one batch. Reserve \`ask_user_question\` for a plain choice with nothing to add.
2. **spec** — agree the test boundaries with the user first, then write \`.scratch/<feature>/spec.md\`: problem, solution, user stories, decisions, test boundaries, out of scope. Base it on the settled decisions; do not re-interview.
3. **tickets** — draft the breakdown, then put the granularity to the user before writing any file: how many tickets, and whether each one is small enough to finish in one fresh context window. Only after they agree, write \`.scratch/<feature>/issues/NN-slug.md\`. One vertical slice per ticket that leaves the product working, each declaring \`blocked-by:\`. When you write Chinese, name one ticket 任务单 and the stage 任务. Never write 拆票, 工单, or use 票 as shorthand — 工单 reads as a support ticket, and the other two are not words.
4. **implement** — one ticket per pass. Load \`tdd\`; work at the pre-agreed seams; typecheck and run that ticket's tests; no scope creep. Review is part of this stage, not a stage of its own: review a ticket (load \`code-review\` for both axes — Standards and Spec) and commit as you finish it, or let a subagent review while you start the next ticket. Move to \`done\` only when every ticket is implemented, reviewed and committed.
5. **done** — wrap up: confirm every ticket is closed, nothing is left uncommitted, and say what the round produced. This is a record of an ending, not more work.

## Gates

\`flow_stage\` owns the phase. Call it with \`action: "status"\` before starting a phase, and \`action: "advance"\` only when that phase's exit criterion is true; it refuses skipped stages and missing artifacts. When a session picks up work another one started — after \`handoff\`, or in a fresh context window — call \`action: "resume"\` instead of replaying the earlier phases: it reads the files on disk and records the stage they prove, and it never moves the record backwards. Stages: grill → spec → tickets → implement → done. Review is not a stage: a ticket is reviewed and committed as it is finished, and a subagent may review while the next ticket is already under way. There is no separate "idea" stage either: a feature enters at \`grill\`.

Leaving \`grill\` for \`spec\` needs both the settled decisions in your evidence and \`docs/agents/issue-tracker.md\`. Without that file the step is refused; write it, defaulting to local markdown.

Keep grill → spec → tickets in one context window. Start each implement pass from the ticket, not from the previous pass.`

/**
 * Read the flow file, tolerating absence and partial writes.
 * @param {string} file absolute path of flow.json
 * @returns {Promise<object | null>} the stored state, or null when absent
 */
async function readState(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    if (error instanceof SyntaxError) return null
    throw error
  }
}

/**
 * Resolve the session working directory, preferring the owning service.
 * @param {object} ctx plugin context
 * @param {object} exec tool run context
 * @returns {string} absolute directory the feature root is anchored to
 */
function resolveCwd(ctx, exec) {
  const session = exec.agent?.session
  if (session) {
    const service = ctx.get('workingDirectory')
    if (service) {
      try {
        const resolved = service.get(session)
        if (typeof resolved === 'string' && resolved.length > 0) return resolved
      } catch {
        // fall through to the session header
      }
    }
    if (typeof session.cwd === 'string' && session.cwd.length > 0) return session.cwd
  }
  return process.cwd()
}

/**
 * Count the ticket files a feature owns.
 * @param {string} issuesDir absolute issues directory
 * @returns {Promise<number>} number of markdown tickets
 */
async function countTickets(issuesDir) {
  try {
    const entries = await readdir(issuesDir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).length
  } catch (error) {
    if (error && error.code === 'ENOENT') return 0
    throw error
  }
}

/**
 * Whether a markdown artifact exists and carries real content.
 * @param {string} file absolute path
 * @param {number} minChars minimum trimmed length
 * @returns {Promise<boolean>} true when the file is substantive
 */
async function isFileReady(file, minChars) {
  try {
    const info = await stat(file)
    if (!info.isFile()) return false
    const text = await readFile(file, 'utf8')
    return text.trim().length >= minChars
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Infer the stage a feature has actually reached from the files it left behind.
 *
 * Only feature-level artifacts count. The repo configuration says the repo is
 * set up, not that this feature passed grill, so it is deliberately ignored.
 * @param {string} dir absolute feature directory
 * @returns {Promise<{stage: string, found: string[]}>} the proven stage and its evidence
 */
async function inferStage(dir) {
  const tickets = await countTickets(join(dir, 'issues'))
  const hasSpec = await isFileReady(join(dir, 'spec.md'), SPEC_MIN_CHARS)
  const hasDecisions = await isFileReady(join(dir, 'decisions.md'), 1)
  const found = []
  if (hasDecisions) found.push('decisions.md')
  if (hasSpec) found.push('spec.md')
  if (tickets > 0) found.push(`issues (${tickets})`)
  const stage = tickets > 0 ? 'implement' : hasSpec ? 'tickets' : hasDecisions ? 'spec' : 'grill'
  return { stage, found }
}

/**
 * Evaluate the exit criterion for entering a stage.
 * @param {string} target stage being entered
 * @param {string} cwd repository directory the session works in
 * @param {string} dir feature directory
 * @param {string} evidence model-supplied justification
 * @returns {Promise<{ready: boolean, requirement: string}>} whether the step is allowed, and what it needs
 */
async function checkGate(target, cwd, dir, evidence) {
  const said = evidence.trim()
  if (target === 'spec') {
    if (said.length < EVIDENCE_MIN_CHARS) {
      return { ready: false, requirement: '先拷问清楚：要做什么、不做什么、测试从哪一层切入' }
    }
    return (await isFileReady(join(cwd, TRACKER_DOC), TRACKER_MIN_CHARS))
      ? { ready: true, requirement: '决策已定，issue 记在哪也写进文档了' }
      : { ready: false, requirement: `先决定 issue 放在哪（本地 markdown 用 ${FEATURE_ROOT}/ 就行），写进 ${TRACKER_DOC}` }
  }
  if (target === 'tickets') {
    return (await isFileReady(join(dir, 'spec.md'), SPEC_MIN_CHARS))
      ? { ready: true, requirement: '规范已成文' }
      : { ready: false, requirement: `先把规范写进 ${join(dir, 'spec.md')}（至少 ${SPEC_MIN_CHARS} 字）` }
  }
  if (target === 'implement') {
    const count = await countTickets(join(dir, 'issues'))
    return count > 0
      ? { ready: true, requirement: '任务已拆成可独立完成的单子' }
      : { ready: false, requirement: `先把任务拆开，写进 ${join(dir, 'issues')}/` }
  }
  if (target === 'done') {
    return said.length >= EVIDENCE_MIN_CHARS
      ? { ready: true, requirement: '实现完成，评审通过，改动已提交' }
      : { ready: false, requirement: '先做完实现并评审（标准与规范两个维度），再提交' }
  }
  return { ready: true, requirement: '没有前置条件' }
}

/**
 * Present the conditions for the next stages.
 * @param {string} stage current stage
 * @param {string} cwd repository directory the session works in
 * @param {string} dir feature directory
 * @returns {Promise<Array<{stage: string, ready: boolean, requirement: string}>>} one row per stage
 */
async function describeGates(stage, cwd, dir) {
  const rows = []
  // Every stage, not just the next two: the dock lets the user inspect any of
  // them, so the client needs each one's condition.
  for (const target of STAGES) {
    const gate = await checkGate(target, cwd, dir, '')
    rows.push({ stage: target, ready: gate.ready, requirement: gate.requirement })
  }
  return rows
}

/** Plain JSON Schema, because `defineTool` is not importable from this location. */
const TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'feature'],
  properties: {
    action: {
      type: 'string',
      enum: ['status', 'advance', 'resume'],
      description: 'status reads the phase and the precondition for the next stages; advance moves it one stage (or back for rework); resume reads the artifacts on disk and records the stage they prove, for work a previous session did.'
    },
    feature: {
      type: 'string',
      description: 'Feature slug: lowercase letters, digits and single hyphens, e.g. "checkout-retry".'
    },
    to: {
      type: 'string',
      enum: STAGES,
      description: 'Target stage for advance. Required when action is "advance".'
    },
    evidence: {
      type: 'string',
      description: 'What makes the current phase finished, in one sentence: the decision that was taken, or the checks that ran. This is shown to the user and kept in the history, so write it for a human, not as a status code.'
    }
  }
}

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'stage', 'path', 'gates'],
  properties: {
    feature: { type: 'string' },
    stage: { type: 'string' },
    next: { type: 'string' },
    path: { type: 'string' },
    moved: { type: 'boolean' },
    resumed: { type: 'boolean' },
    found: { type: 'array', items: { type: 'string' } },
    repoReady: { type: 'boolean' },
    gates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stage', 'ready', 'requirement'],
        properties: {
          stage: { type: 'string' },
          ready: { type: 'boolean' },
          requirement: { type: 'string' }
        }
      }
    }
  }
}

/**
 * Build the flow_stage tool definition as a plain object.
 * @param {object} ctx plugin context
 * @returns {object} registry-ready tool definition
 */
function buildTool(ctx) {
  return {
    name: 'flow_stage',
    description:
      'Own the development phase of one feature and the precondition for each next stage. Call with action "status" before starting a phase, and action "advance" only once that phase is genuinely finished. Pick up work another session started with action "resume": it reads spec.md, decisions.md and issues/ and records the stage they prove. Forward moves are one stage at a time; moving back for rework is allowed. Artifacts live under .scratch/<feature>/ (spec.md, issues/NN-slug.md, flow.json).',
    parameters: TOOL_PARAMETERS,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `${value.feature}: ${value.stage}${value.next ? ` (next: ${value.next})` : ''}${value.moved ? ' — advanced' : ''}${value.repoReady === false ? ' · repo could not be initialised: write docs/agents/issue-tracker.md by hand' : ''}`
      }],
      // Carried into the tool result meta, where the `matt-flow` projection folds it
      // into the value the composer dock renders.
      presentationMeta: (_args, value) => ({
        tool: 'flow_stage',
        feature: value.feature,
        stage: value.stage,
        next: value.next ?? null,
        resumed: value.resumed === true,
        found: value.found ?? [],
        repoReady: value.repoReady !== false,
        gates: value.gates,
      }),
    },
    async execute(args, exec) {
      const feature = String(args.feature ?? '').trim()
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(feature)) {
        throw new Error('invalid feature slug: use lowercase letters, digits and single hyphens')
      }

      const cwd = resolveCwd(ctx, exec)
      const root = join(cwd, FEATURE_ROOT, feature)
      const stateFile = join(root, 'flow.json')
      const state = await readState(stateFile)
      // A repo is initialised once its issue-tracker decision is on disk. The
      // first feature of a repo starts here, so this is where the check lands —
      // and where a missing file is written, so no round-trip is spent asking.
      const trackerPath = join(cwd, TRACKER_DOC)
      // The skill suite needs no provisioning: those files ship inside this
      // package, so a missing one means a broken or partial install, and no
      // command the model could run would fix that. Refuse rather than offer a
      // repair path that cannot work.
      const bundled = skillPresence()
      if (bundled.missing.length > 0) {
        throw new Error(
          `the bundled skill suite is incomplete: missing ${bundled.missing.join(', ')} under ${skillsHome()}. `
          + 'The package was installed partially; reinstall the plugin. Do not try to fetch these skills.'
        )
      }
      // One gate left, and it is a refusal rather than advice: nothing may run
      // before the repo configuration exists. The write runs from the host,
      // which the tool sandbox does not cover, so the decision goes to the
      // approval seam DSH already owns: the user grants it once and it is
      // audited. The prompt is asked only when the write is actually needed.
      let repoReady = await isFileReady(join(cwd, TRACKER_DOC), TRACKER_MIN_CHARS)
      if (!repoReady) {
        await requireConsent(ctx, exec, consentText(repoReady))
      }

      if (!repoReady) {
        const init = initialiseRepo(cwd)
        if (!init.ready) {
          throw new Error(`could not initialise this repo: ${init.error || 'unknown reason'}`)
        }
        repoReady = true
        mark(APPLY_LOG, `initialised repo: ${init.written.join(', ')}`)
      }
      const stage = normalizeStage(state?.stage)

      if (args.action === 'resume') {
        // Handoff case: another session (or another machine) did the earlier
        // phases and left their files behind. The record is derived from what is
        // on disk instead of making the model replay stages that already
        // happened. It only ever moves forward: artifacts can lag behind the
        // record, never prove that work was undone.
        const inferred = await inferStage(root)
        const from = STAGES.indexOf(stage)
        const to = STAGES.indexOf(inferred.stage)
        const target = to > from ? inferred.stage : stage
        const moved = target !== stage
        const now = new Date().toISOString()
        const history = Array.isArray(state?.history) ? state.history : []
        if (moved || !state) {
          history.push({
            from: state ? stage : null,
            to: target,
            at: now,
            evidence: `resumed from ${inferred.found.join(', ') || 'an empty feature directory'}`,
          })
        }
        await mkdir(root, { recursive: true })
        await writeFile(
          stateFile,
          JSON.stringify({ feature, stage: target, updatedAt: now, history }, null, 2) + '\n',
          'utf8'
        )
        const next = STAGES[STAGES.indexOf(target) + 1]
        return {
          feature,
          stage: target,
          ...(next ? { next } : {}),
          path: stateFile,
          moved,
          resumed: true,
          found: inferred.found,
          repoReady,
          gates: await describeGates(target, cwd, root)
        }
      }

      if (args.action === 'status') {
        // First contact with a feature creates its record. The flow has no
        // separate "start" step, and a session that only ever asks for status
        // would otherwise leave no trace on disk at all.
        if (!state) {
          const now = new Date().toISOString()
          await mkdir(root, { recursive: true })
          await writeFile(
            stateFile,
            JSON.stringify({ feature, stage, updatedAt: now, history: [] }, null, 2) + '\n',
            'utf8'
          )
        }
        const next = STAGES[STAGES.indexOf(stage) + 1]
        return {
          feature,
          stage,
          ...(next ? { next } : {}),
          path: stateFile,
          repoReady,
          gates: await describeGates(stage, cwd, root)
        }
      }

      const target = String(args.to ?? '').trim()
      if (!STAGES.includes(target)) throw new Error(`unknown target stage: ${target || '(none)'}`)

      const from = STAGES.indexOf(stage)
      const to = STAGES.indexOf(target)
      if (to === from) throw new Error(`feature is already at stage ${stage}`)
      if (to > from + 1) {
        throw new Error(`cannot skip stages: ${stage} → ${target}. Advance at most one stage at a time.`)
      }

      const evidence = String(args.evidence ?? '')
      let moved = false

      if (to > from) {
        const verdict = await checkGate(target, cwd, root, evidence)
        if (!verdict.ready) {
          throw new Error(`the precondition for ${target} is not met: ${verdict.requirement}`)
        }
        moved = true
      }

      const now = new Date().toISOString()
      const history = Array.isArray(state?.history) ? state.history : []
      history.push({ from: stage, to: target, at: now, evidence: evidence.trim() })

      await mkdir(root, { recursive: true })
      await writeFile(
        stateFile,
        JSON.stringify({ feature, stage: target, updatedAt: now, history }, null, 2) + '\n',
        'utf8'
      )

      const next = STAGES[to + 1]
      return {
        feature,
        stage: target,
        ...(next ? { next } : {}),
        path: stateFile,
        moved,
        repoReady,
        gates: await describeGates(target, cwd, root)
      }
    }
  }
}

/** Options the decision card renders, one entry per choice. */
const ASK_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'questions'],
  properties: {
    feature: {
      type: 'string',
      description: 'Feature slug this decision belongs to, matching flow_stage.'
    },
    questions: {
      type: 'array',
      description: 'One to three decisions to settle, each with two to four labelled options.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'options'],
        properties: {
          id: { type: 'string', description: 'Stable id, used in the recorded answer.' },
          title: { type: 'string', description: 'The decision, phrased as the question the user answers.' },
          detail: { type: 'string', description: 'Optional one-line context under the title.' },
          allowText: { type: 'boolean', description: 'Whether the card offers a free-text field. Defaults to true.' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label'],
              properties: {
                label: { type: 'string', description: 'Short option name, e.g. "A) Vite + TS + 原生 DOM".' },
                description: { type: 'string', description: 'One line on the tradeoff or consequence.' }
              }
            }
          }
        }
      }
    }
  }
}

const ASK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'questions', 'state'],
  properties: {
    feature: { type: 'string' },
    questions: { type: 'integer' },
    state: { type: 'string' }
  }
}

/**
 * Build the flow_ask tool: it hands the decision to the card and ends the turn.
 * @returns {object} registry-ready tool definition
 */
function buildAskTool() {
  return {
    name: 'flow_ask',
    description:
      'Ask the user to settle up to three decisions. Renders an interactive card in the conversation with selectable options and a free-text field; the user submits one batch, which arrives as their next message. Use it in the grill phase instead of writing the questions as prose. This tool does not wait: end your turn after calling it. Chinese wording inside the card: one ticket is 任务单 and the stage is 任务; never write 拆票, 工单, or 票 as shorthand.',
    parameters: ASK_PARAMETERS,
    output: {
      schema: ASK_OUTPUT_SCHEMA,
      render: (_args, value) => [{
        type: 'text',
        text: `决策卡已显示：${value.feature}，${value.questions} 个问题待选择`
      }]
    },
    async execute(args) {
      const feature = String(args.feature ?? '').trim()
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(feature)) {
        throw new Error('invalid feature slug: use lowercase letters, digits and single hyphens')
      }
      const questions = Array.isArray(args.questions) ? args.questions : []
      if (questions.length === 0) throw new Error('flow_ask needs at least one question')
      if (questions.length > 3) throw new Error('ask at most three questions at a time')
      for (const question of questions) {
        const options = Array.isArray(question?.options) ? question.options : []
        if (options.length < 2) throw new Error(`question "${question?.title ?? ''}" needs at least two options`)
        if (options.length > 4) throw new Error(`question "${question?.title ?? ''}" allows at most four options`)
      }
      mark(APPLY_LOG, `flow_ask served ${feature} with ${questions.length} question(s)`)
      return {
        feature,
        questions: questions.length,
        state: 'card rendered in the conversation; wait for the user to submit their choices'
      }
    }
  }
}

/**
 * The skills directory that ships inside this package. There is no install step
 * and no shared fallback: the suite is these files, and only a preset that
 * scans `BUNDLED_SKILLS_DIR` can see them.
 */
function skillsHome() {
  return BUNDLED_SKILLS_DIR
}

/**
 * Which required skills are already on disk.
 * @returns {{present: string[], missing: string[]}} split by availability
 */
function skillPresence() {
  const dir = skillsHome()
  const present = []
  const missing = []
  for (const name of REQUIRED_SKILLS) {
    if (existsSync(join(dir, name, 'SKILL.md'))) present.push(name)
    else missing.push(name)
  }
  return { present, missing }
}

/**
 * Ask the user, through the harness's own approval seam, before the host writes.
 *
 * The plugin writes from the host process, which the tool sandbox does not
 * cover. Rather than re-deriving permission rules here, the decision is
 * handed to `ctx.approval`: it renders the prompt, records the audit pair, and
 * fails closed when no answerer is composed.
 * @param {object} ctx plugin context
 * @param {object} exec tool execution (carries the live agent and call id)
 * @param {{ en: string, zh: string }} text the localised description of that work
 * @returns {Promise<void>} resolves only on an explicit grant
 */
async function requireConsent(ctx, exec, text) {
  const service = ctx.get('approval')
  const agent = exec && exec.agent
  if (!service || typeof service.request !== 'function' || !agent) {
    // Without the seam there is no way to ask, and writing silently is worse
    // than refusing, so the caller gets a refusal instead of a guess.
    throw new Error(
      'this plugin needs the approval service to write from the host, and it is not available in this profile. '
      + 'Enable @deepseek-ai/dsh-user-approval, or run the initialisation by hand.'
    )
  }
  const outcome = await service.request({
    agent,
    toolName: 'flow_stage',
    callId: exec.callId,
    reason: text.en,
    displayReason: text,
  })
  if (outcome !== 'allowed-once') {
    throw new Error(
      `the user did not approve this (${outcome}), so nothing was written or installed. `
      + 'Do not retry on your own; ask them what they want to do.'
    )
  }
}

/**
 * The exact work the plugin is about to do, in both languages.
 *
 * The approval card is the only place a user learns that this plugin touches the
 * disk, so it names every file it will write rather than summarising the idea.
 * Provisioning the skill suite is deliberately absent: those files ship inside
 * this package and are never written at runtime.
 * @param {boolean} repoReady whether the repo configuration already exists
 * @returns {{ en: string, zh: string }} display text
 */
function consentText(repoReady) {
  const en = []
  const zh = []
  if (!repoReady) {
    en.push(`create the repository agent setup: ${TRACKER_DOC}, docs/agents/domain.md, triage-labels.md and the Agent skills block in AGENTS.md`)
    zh.push(`创建本仓库的 Agent 配置：${TRACKER_DOC}、docs/agents/domain.md、triage-labels.md，以及 AGENTS.md 里的技能说明`)
  }
  return {
    en: `matt-flow wants to ${en.join(' and ')}.`,
    zh: `matt-flow 想要${zh.join('，并')}。`,
  }
}

/**
 * Write the per-repo configuration `setup-matt-pocock-skills` scaffolds, copying
 * the templates that skill ships rather than restating them here.
 *
 * Synchronous on purpose: four small local files take milliseconds, and being
 * finished before the session's first turn is the whole point.
 * @param {string} cwd repository root
 * @returns {{ready: boolean, written: string[], error?: string}} outcome
 */
function initialiseRepo(cwd) {
  const skillDir = join(skillsHome(), 'setup-matt-pocock-skills')
  const written = []

  const readTemplate = (name) => {
    try {
      return readFileSync(join(skillDir, name), 'utf8')
    } catch {
      return null
    }
  }

  const tracker = readTemplate('issue-tracker-local.md')
  if (tracker === null) {
    return { ready: false, written, error: `template missing: ${join(skillDir, 'issue-tracker-local.md')}` }
  }
  const domain = readTemplate('domain.md')
  if (domain === null) {
    return { ready: false, written, error: `template missing: ${join(skillDir, 'domain.md')}` }
  }

  const agentsDir = join(cwd, 'docs', 'agents')
  mkdirSync(agentsDir, { recursive: true })

  const put = (file, text) => {
    const target = join(agentsDir, file)
    if (existsSync(target) && readFileSync(target, 'utf8').trim().length >= TRACKER_MIN_CHARS) return
    writeFileSync(target, text, 'utf8')
    written.push(join('docs', 'agents', file))
  }

  put('issue-tracker.md', tracker)
  put('domain.md', domain)

  if (existsSync(join(skillsHome(), 'triage', 'SKILL.md'))) {
    const labels = readTemplate('triage-labels.md')
    if (labels !== null) put('triage-labels.md', labels)
  }

  // DSH reads AGENTS.md first and CLAUDE.md as a fallback, so prefer the file
  // DSH itself would load; only fall back to CLAUDE.md in a repo that already
  // keeps its agent instructions there.
  const agents = join(cwd, 'AGENTS.md')
  const claude = join(cwd, 'CLAUDE.md')
  const host = existsSync(agents) ? agents : existsSync(claude) ? claude : agents
  const section = [
    '## Agent skills',
    '',
    '### Issue tracker',
    '',
    'Issues and specs live as local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.',
    '',
    ...(existsSync(join(agentsDir, 'triage-labels.md'))
      ? ['### Triage labels', '', 'Labels map to the five canonical triage roles. See `docs/agents/triage-labels.md`.', '']
      : []),
    '### Domain docs',
    '',
    'Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.',
    '',
  ].join('\n')

  let hostText = ''
  try {
    hostText = readFileSync(host, 'utf8')
  } catch {
    hostText = ''
  }
  if (!/^## Agent skills$/m.test(hostText)) {
    const glue = hostText.length === 0 ? '' : hostText.endsWith('\n') ? '\n' : '\n\n'
    writeFileSync(host, `${hostText}${glue}${section}`, 'utf8')
    written.push(host === claude ? 'CLAUDE.md' : 'AGENTS.md')
  }

  return { ready: true, written }
}

/**
 * The skills tool: report where the suite lives and that it needs no install.
 *
 * Read-only by construction. The suite ships inside the package, so there is no
 * install path, no download, and nothing for the model or the user to run.
 * @returns {object} the `flow_skills` tool definition
 */
function buildSkillsTool() {
  return {
    name: 'flow_skills',
    description:
      'Report the bundled skills this workflow runs on: where they live, which are present, and which are missing. Read-only; the suite ships with the plugin, so there is nothing to install.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['status'],
          description: 'status reads the current state. There is no install action: the suite is bundled.'
        }
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['state', 'present', 'missing', 'directory'],
        properties: {
          state: { type: 'string' },
          present: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
          directory: { type: 'string' },
          error: { type: 'string' }
        }
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.missing.length === 0
          ? `skills: all ${value.present.length} present in ${value.directory}`
          : `skills: missing ${value.missing.join(', ')} from the bundled directory ${value.directory} — the plugin package is incomplete, reinstall it`
      }]
    },
    async execute() {
      const { present, missing } = skillPresence()
      return {
        state: missing.length === 0 ? 'present' : 'incomplete',
        present,
        missing,
        directory: skillsHome(),
      }
    }
  }
}

/**
 * Schema surface the projection registry calls (`parse` only). The value is
 * produced by this plugin, so the check guards against corruption rather than
 * untrusted input.
 */
const FLOW_VIEW_SCHEMA = {
  parse(value) {
    if (value === null || value === undefined) return null
    if (typeof value !== 'object') throw new Error('matt-flow projection: expected an object or null')
    if (typeof value.feature !== 'string' || typeof value.stage !== 'string') {
      throw new Error('matt-flow projection: feature and stage must be strings')
    }
    return value
  }
}

/**
 * The first text block of a tool result message, or an empty string.
 * @param {object} message tool result message
 * @returns {string} its first text block
 */
function firstTextBlock(message) {
  const content = message && Array.isArray(message.content) ? message.content : []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') return block.text
  }
  return ''
}

/** Internal fold state: the last known flow plus the call awaiting its result. */
const FLOW_STATE_SCHEMA = {
  parse(value) {
    if (!value || typeof value !== 'object') throw new Error('matt-flow state: expected an object')
    const flow = value.flow ?? null
    if (flow !== null && (typeof flow.feature !== 'string' || typeof flow.stage !== 'string')) {
      throw new Error('matt-flow state: flow must carry feature and stage')
    }
    return { pendingCallId: typeof value.pendingCallId === 'string' ? value.pendingCallId : null, flow }
  }
}

/** Folds the latest flow_stage result into one client-readable value. */
const FLOW_PROJECTION = {
  key: 'matt-flow',
  stateSchema: FLOW_STATE_SCHEMA,
  stateVersion: 2,
  init: () => ({ pendingCallId: null, flow: null }),
  apply: (state, event) => {
    // Pair the call first: only a flow_stage callId may consume the next result,
    // so unrelated tool output can never be mistaken for workflow state.
    if (event.type === 'tool/call') {
      const data = event.data || {}
      if (data.name !== 'flow_stage' || typeof data.callId !== 'string') return state
      return { pendingCallId: data.callId, flow: state.flow }
    }
    if (event.type !== 'tool/result') return state

    const data = event.data || {}
    const message = data.message || {}
    if (state.pendingCallId === null || message.toolCallId !== state.pendingCallId) return state

    const meta = data.meta || {}
    let payload = meta.tool === 'flow_stage'
      ? meta
      : (meta.presentation && meta.presentation.tool === 'flow_stage' ? meta.presentation : null)

    // Results recorded before presentationMeta existed still carry
    // "<feature>: <stage>" as their rendered text; fold those too so an
    // upgraded profile lights the bar from history.
    if (!payload) {
      const match = /^([a-z0-9][a-z0-9-]{0,63}): ([a-z]+)\b/.exec(firstTextBlock(message))
      if (!match) return { pendingCallId: null, flow: state.flow }
      payload = { feature: match[1], stage: match[2], gates: [] }
    }

    const stage = normalizeStage(payload.stage)
    const index = STAGES.indexOf(stage)
    return {
      pendingCallId: null,
      flow: {
        feature: payload.feature,
        stage,
        next: payload.next ?? (STAGES[index + 1] ?? null),
        resumed: payload.resumed === true,
        found: Array.isArray(payload.found) ? payload.found : [],
        repoReady: payload.repoReady !== false,
        gates: Array.isArray(payload.gates) ? payload.gates : [],
      },
    }
  },
  wire: {
    viewSchema: FLOW_VIEW_SCHEMA,
    view: (state) => state.flow,
  },
}

export function apply(ctx, config) {
  mark(APPLY_LOG, `apply entered v${PLUGIN_VERSION}`)

  // The same package mounts twice: a top-level row exists only so the client
  // boot graph can compose `dsh.client`, and it must not touch session
  // behaviour; the preset row does the real work.
  if (config && config.uiOnly === true) {
    mark(APPLY_LOG, 'uiOnly row: host behaviour skipped')
    return
  }

  const tools = ctx.get('tools')
  if (!tools || typeof tools.register !== 'function') {
    mark(APPLY_LOG, 'no tools service; nothing registered')
    return
  }

  const projections = ctx.get('sessionProjections')
  if (projections && typeof projections.register === 'function') {
    try {
      ctx.effect(() => projections.register(FLOW_PROJECTION))
      mark(APPLY_LOG, 'matt-flow projection registered')
    } catch (error) {
      mark(APPLY_LOG, `projection registration failed: ${error && error.message}`)
    }
  } else {
    mark(APPLY_LOG, 'no sessionProjections service; dock state unavailable')
  }

  const prompt = ctx.get('systemPrompt')
  if (prompt && typeof prompt.section === 'function') {
    ctx.effect(() => prompt.section({ name: 'matt-flow', order: 100, text: FLOW_SECTION }))
    mark(APPLY_LOG, 'prompt section registered')
  } else {
    mark(APPLY_LOG, 'no systemPrompt service; prompt section skipped')
  }

  ctx.effect(() => tools.register(buildTool(ctx)))
  ctx.effect(() => tools.register(buildAskTool()))
  ctx.effect(() => tools.register(buildSkillsTool()))
  mark(APPLY_LOG, 'flow_stage, flow_ask and flow_skills registered')

  // A refusal, not a hint. Until the repo configuration exists, every tool but
  // the two that can fix that is denied — including reads, so the model cannot
  // start grilling off its own reading before setup has happened.
  // Initialise before the first turn, not when the model asks. A session is
  // created before it can read anything, so writing the repo configuration here
  // means no tool call ever runs against an uninitialised repo — no guard needed.
  // No write happens at session creation: an approval request needs an open
  // turn, and writing without one would be exactly the silent bypass this
  // plugin must not have. Initialisation runs on the first flow_stage call.
  mark(APPLY_LOG, typeof ctx.on === 'function'
    ? 'agent/created initialiser registered'
    : 'no ctx.on; initialisation waits for flow_stage')

  // Report, never install: provisioning the skill tree is the user's call, and
  // every path that used to install now refuses and hands over a command.
  try {
    const boot = skillPresence()
    mark(APPLY_LOG, boot.missing.length === 0
      ? `skills present: ${boot.present.length}`
      : `skills missing: ${boot.missing.join(', ')}`)
  } catch (error) {
    mark(APPLY_LOG, `skills check threw: ${error && error.message}`)
  }
}
