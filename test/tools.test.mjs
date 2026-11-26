import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'

// The flow refuses to run without its skills, so the suite is faked here rather
// than required on the machine: tests must not depend on what the user installed.
const dshHome = await mkdtemp(join(tmpdir(), 'dshhome-'))
const skillsDir = join(dshHome, 'dsh-matt-flow-preset', '.agents', 'skills')
const skillNames = [
  'ask-matt', 'grilling', 'grill-me', 'grill-with-docs', 'domain-modeling',
  'triage', 'wayfinder', 'to-spec', 'to-tickets', 'implement', 'tdd',
  'code-review', 'codebase-design', 'improve-codebase-architecture',
  'diagnosing-bugs', 'prototype', 'research',
  'pr', 'handoff', 'migrate-to-shoehorn', 'retro', 'wait-what', 'setup-matt-pocock-skills',
  'setup-pre-commit',
]
for (const name of skillNames) {
  await mkdir(join(skillsDir, name), { recursive: true })
  await writeFile(join(skillsDir, name, 'SKILL.md'), `# ${name}\n`, 'utf8')
}
// The initialiser copies these three templates out of the skill package, so the
// fake package has to carry stand-ins with the same shape.
const setupDir = join(skillsDir, 'setup-matt-pocock-skills')
await writeFile(join(setupDir, 'issue-tracker-local.md'),
  '# Issue tracker: Local Markdown\n\nIssues and specs live in `.scratch/`.\n\n## Conventions\n\n- one directory per feature\n', 'utf8')
await writeFile(join(setupDir, 'domain.md'),
  '# Domain Docs\n\nRead `CONTEXT.md` and `docs/adr/`.\n', 'utf8')
await writeFile(join(setupDir, 'triage-labels.md'),
  '# Triage Labels\n\n| role | label |\n|---|---|\n', 'utf8')
process.env.DSH_HOME = dshHome
// Installs are always disabled in tests: the CLI would otherwise use network
// and write into the private tree.
process.env.DSH_MATT_FLOW_NO_INSTALL = '1'

const { apply } = await import('../index.js')

const defs = []
const toolsService = { register: (d) => { defs.push(d); return () => {} } }
// The plugin asks this seam before any host write; a stub that grants once keeps
// the ordinary path testable without a live session.
const approvalStub = { request: async () => 'allowed-once' }
// The prompt section is captured so a test can check what the model is told.
const promptSections = []
const promptService = { section: (entry) => { promptSections.push(entry); return () => {} } }
const ctx = {
  get: (k) => (k === 'tools' ? toolsService : k === 'approval' ? approvalStub : k === 'systemPrompt' ? promptService : undefined),
  effect: (fn) => fn(),
}
apply(ctx, {})
const tool = defs.find((d) => d.name === 'flow_stage')
const skillsTool = defs.find((d) => d.name === 'flow_skills')
const exec = { agent: { id: 'session-test' }, callId: 'call-test' }

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}
async function rejects(name, fn, needle) {
  try { await fn(); ok(name, false, 'did not throw') }
  catch (e) { ok(name, String(e.message).includes(needle), e.message) }
}
const call = (args) => tool.execute(args, exec)

const WORK = await mkdtemp(join(tmpdir(), 'matt-flow-test-'))
await mkdir(WORK, { recursive: true })
process.chdir(WORK)
const F = 'checkout-retry'
const featureDir = join(WORK, '.scratch', F)

const s0 = await call({ action: 'status', feature: F })
ok('fresh status starts at grill', s0.stage === 'grill', s0.stage)
const created = await readFile(join(featureDir, 'flow.json'), 'utf8').then((t) => JSON.parse(t), () => null)
ok('first status creates the record', created !== null && created.stage === 'grill', JSON.stringify(created))
ok('first status initialises the repo', s0.repoReady === true, String(s0.repoReady))
const tracker = await readFile(join(WORK, 'docs', 'agents', 'issue-tracker.md'), 'utf8').then((t) => t, () => '')
ok('the tracker doc is written, not asked for', tracker.includes('Local Markdown') && tracker.includes('.scratch/'), String(tracker.length))
ok('no next-action field is needed once initialised', s0.nextAction === undefined, String(s0.nextAction))
ok('fresh next is spec', s0.next === 'spec', s0.next)
ok('spec gate blocked without tracker doc', s0.gates.find(g => g.stage === 'spec')?.ready === false)

await rejects('cannot skip grill->tickets', () => call({ action: 'advance', feature: F, to: 'tickets', evidence: 'x' }), 'cannot skip')
await rejects('grill->spec blocked without evidence', () => call({ action: 'advance', feature: F, to: 'spec', evidence: '  ' }), 'precondition')

await mkdir(join(WORK, 'docs', 'agents'), { recursive: true })
await writeFile(join(WORK, 'docs', 'agents', 'issue-tracker.md'), '# Issue tracker\n\nLocal markdown under .scratch/<feature>/issues, one file per ticket.\n', 'utf8')
const a2 = await call({ action: 'advance', feature: F, to: 'spec', evidence: 'seams: one seam at the retry policy boundary' })
ok('grill->spec ok with tracker doc and evidence', a2.stage === 'spec')
ok('repo reads as initialised once the tracker doc exists', a2.repoReady === true, String(a2.repoReady))
ok('initialised status drops the next action', a2.nextAction === undefined, String(a2.nextAction))
ok('tickets gate blocked on spec.md', a2.gates.find(g => g.stage === 'tickets')?.ready === false)

await rejects('spec->tickets without spec.md', () => call({ action: 'advance', feature: F, to: 'tickets', evidence: 'plan ready' }), 'spec.md')
await mkdir(featureDir, { recursive: true })
await writeFile(join(featureDir, 'spec.md'), '# Spec\n\n' + 'decision '.repeat(40) + '\n', 'utf8')
const a3 = await call({ action: 'advance', feature: F, to: 'tickets', evidence: 'spec written' })
ok('spec->tickets ok once spec.md exists', a3.stage === 'tickets')

await rejects('tickets->implement without issues', () => call({ action: 'advance', feature: F, to: 'implement', evidence: 'go' }), 'issues/')
await mkdir(join(featureDir, 'issues'), { recursive: true })
await writeFile(join(featureDir, 'issues', '01-retry-policy.md'), 'blocked-by: none\n', 'utf8')
const a4 = await call({ action: 'advance', feature: F, to: 'implement', evidence: 'fly' })
ok('tickets->implement ok with one ticket', a4.stage === 'implement')

await rejects('implement->done needs evidence', () => call({ action: 'advance', feature: F, to: 'done', evidence: '' }), 'precondition')
const a6 = await call({ action: 'advance', feature: F, to: 'done', evidence: 'implemented, reviewed, committed' })
ok('implement->done ok', a6.stage === 'done' && !('next' in a6))
await rejects('review is no longer a stage', () => call({ action: 'advance', feature: F, to: 'review', evidence: 'x' }), 'unknown target')

const state = JSON.parse(await readFile(join(featureDir, 'flow.json'), 'utf8'))
ok('history recorded 4 moves', state.history.length === 4, String(state.history.length))
ok('history keeps evidence', state.history[3].evidence.includes('reviewed'))

const back = await call({ action: 'advance', feature: F, to: 'implement', evidence: 'review found a gap' })
ok('rework move allowed', back.stage === 'implement' && back.moved === false)

await rejects('bad slug rejected', () => call({ action: 'status', feature: 'Bad Slug' }), 'slug')
await rejects('unknown stage rejected', () => call({ action: 'advance', feature: F, to: 'deploy', evidence: 'x' }), 'unknown target')
await rejects('same stage rejected', () => call({ action: 'advance', feature: F, to: 'implement', evidence: 'x' }), 'already')

const other = await call({ action: 'status', feature: 'brand-new' })
ok('a new feature starts at grill', other.stage === 'grill' && other.next === 'spec')

// --- questions -------------------------------------------------------------
// Decisions go through DSH's own ask_user_question card; the plugin must not
// register a second, competing ask tool.
ok('flow_ask is gone', defs.find((d) => d.name === 'flow_ask') === undefined,
  defs.map((d) => d.name).join(','))
const promptText = promptSections.map((entry) => entry.text).join('\n')
ok('prompt names ask_user_question', /ask_user_question/.test(promptText), 'prompt does not name ask_user_question')
ok('prompt no longer names flow_ask', !/flow_ask/.test(promptText), 'prompt still mentions flow_ask')

// --- flow_skills -----------------------------------------------------------
ok('flow_skills registered', skillsTool !== undefined)
const sk = await skillsTool.execute({ action: 'status' }, exec)
ok('flow_skills reports present on this machine', sk.state === 'present' && sk.missing.length === 0, JSON.stringify(sk.state))
ok('flow_skills lists the required skills', sk.present.includes('grilling') && sk.present.includes('to-spec'), sk.present.join(','))

console.log(`\n${pass} passed, ${fail} failed`)

process.exit(fail ? 1 : 0)
