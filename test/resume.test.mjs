// Resume is the handoff path: work another session did leaves files behind, and
// the record is derived from those files instead of replaying the phases.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const agentsHome = await mkdtemp(join(tmpdir(), 'agents-'))
const skillNames = [
  'ask-matt', 'grilling', 'grill-me', 'grill-with-docs', 'domain-modeling',
  'triage', 'wayfinder', 'to-spec', 'to-tickets', 'implement', 'tdd',
  'code-review', 'codebase-design', 'improve-codebase-architecture',
  'diagnosing-bugs', 'prototype', 'research',
  'pr', 'handoff', 'migrate-to-shoehorn', 'retro', 'wait-what', 'setup-matt-pocock-skills',
  'setup-pre-commit',
]
for (const name of skillNames) {
  await mkdir(join(agentsHome, 'skills', name), { recursive: true })
  await writeFile(join(agentsHome, 'skills', name, 'SKILL.md'), `# ${name}\n`, 'utf8')
}
const setupDir = join(agentsHome, 'skills', 'setup-matt-pocock-skills')
await writeFile(join(setupDir, 'issue-tracker-local.md'),
  '# Issue tracker: Local Markdown\n\nIssues and specs live in `.scratch/`.\n\n## Conventions\n\n- one directory per feature\n', 'utf8')
await writeFile(join(setupDir, 'domain.md'), '# Domain Docs\n\nRead `CONTEXT.md` and `docs/adr/`.\n', 'utf8')
await writeFile(join(setupDir, 'triage-labels.md'), '# Triage Labels\n\n| role | label |\n|---|---|\n', 'utf8')
process.env.DSH_AGENTS_HOME = agentsHome
process.env.DSH_MATT_FLOW_NO_INSTALL = '1'

const { apply } = await import('../index.js')

const defs = []
const toolsService = { register: (d) => { defs.push(d); return () => {} } }
const approvalStub = { request: async () => 'allowed-once' }
const ctx = {
  get: (k) => (k === 'tools' ? toolsService : k === 'approval' ? approvalStub : undefined),
  effect: (fn) => fn(),
}
apply(ctx, {})
const tool = defs.find((d) => d.name === 'flow_stage')
const exec = { agent: { id: 'session-test' }, callId: 'call-test' }

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}
const call = (args) => tool.execute(args, exec)

const WORK = await mkdtemp(join(tmpdir(), 'matt-flow-resume-'))
await mkdir(WORK, { recursive: true })
process.chdir(WORK)

const feature = (slug) => join(WORK, '.scratch', slug)
const spec = (slug) => writeFile(join(feature(slug), 'spec.md'), '# Spec\n\n' + 'x'.repeat(220), 'utf8')
const ticket = (slug, name = '01-first.md') => writeFile(join(feature(slug), 'issues', name), '# ticket\n', 'utf8')
const decisions = (slug) => writeFile(join(feature(slug), 'decisions.md'), '- chosen: one\n', 'utf8')
const record = (slug) => readFile(join(feature(slug), 'flow.json'), 'utf8').then((t) => JSON.parse(t), () => null)

// An empty feature directory proves nothing, so resume leaves it at the start.
const empty = await call({ action: 'resume', feature: 'empty-one' })
ok('an empty feature resumes at grill', empty.stage === 'grill', empty.stage)
ok('resume reports itself', empty.resumed === true, String(empty.resumed))
ok('resume does not claim it moved', empty.moved === false, String(empty.moved))
ok('the provenance list is empty', Array.isArray(empty.found) && empty.found.length === 0, JSON.stringify(empty.found))
ok('resume still writes the record', (await record('empty-one'))?.stage === 'grill')

// One artifact at a time, oldest first.
await mkdir(feature('decided'), { recursive: true })
await decisions('decided')
const decided = await call({ action: 'resume', feature: 'decided' })
ok('decisions.md resumes at spec', decided.stage === 'spec', decided.stage)
ok('the decision file is named as evidence', decided.found.includes('decisions.md'), JSON.stringify(decided.found))

await mkdir(feature('specd'), { recursive: true })
await spec('specd')
const specd = await call({ action: 'resume', feature: 'specd' })
ok('spec.md resumes at tickets', specd.stage === 'tickets', specd.stage)
ok('the record says where it came from', (await record('specd'))?.history?.[0]?.evidence?.includes('spec.md'), JSON.stringify(await record('specd')))

await mkdir(join(feature('ticketed'), 'issues'), { recursive: true })
await spec('ticketed')
await ticket('ticketed')
const ticketed = await call({ action: 'resume', feature: 'ticketed' })
ok('issued tickets resume at implement', ticketed.stage === 'implement', ticketed.stage)
ok('both artifacts are reported', ticketed.found.includes('spec.md') && ticketed.found.some((f) => f.startsWith('issues')), JSON.stringify(ticketed.found))
ok('implement gate is ready once tickets exist', ticketed.gates.find((g) => g.stage === 'implement')?.ready === true)

// A short spec.md is not a spec.
await mkdir(feature('stub'), { recursive: true })
await writeFile(join(feature('stub'), 'spec.md'), '# Spec\n\nTODO\n', 'utf8')
const stub = await call({ action: 'resume', feature: 'stub' })
ok('a stub spec does not count', stub.stage === 'grill', stub.stage)

// Resuming a record that is already ahead never rolls it back.
await mkdir(join(feature('ahead'), 'issues'), { recursive: true })
await call({ action: 'resume', feature: 'ahead' })
await ticket('ahead')
const forward = await call({ action: 'resume', feature: 'ahead' })
ok('resume moves forward when files appear later', forward.stage === 'implement' && forward.moved === true, `${forward.stage}/${forward.moved}`)

const doneDir = feature('finished')
await mkdir(doneDir, { recursive: true })
await writeFile(join(doneDir, 'flow.json'),
  JSON.stringify({ feature: 'finished', stage: 'done', updatedAt: new Date().toISOString(), history: [] }), 'utf8')
const finished = await call({ action: 'resume', feature: 'finished' })
ok('resume never moves backwards', finished.stage === 'done', finished.stage)
ok('a no-op resume records no history', (await record('finished'))?.history?.length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
