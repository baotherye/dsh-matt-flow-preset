import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The suite ships inside the package, so "skills are missing" is not a machine
// state this test can fake with an environment variable: it has to hand the
// plugin a package whose `skills/` directory is genuinely incomplete. Each case
// therefore runs against a throwaway copy of the plugin.
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const realEntry = join(root, 'index.js')

// The required skill list is part of the plugin's contract with this test: read
// it from the source so the fake package always matches what the code asks for.
const source = readFileSync(realEntry, 'utf8')
const required = [...source.match(/REQUIRED_SKILLS = \[([\s\S]*?)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
assert.ok(required.length > 20, `expected the full skill list, got ${required.length}`)

const TRACKER = 'docs/agents/issue-tracker.md'
const TRACKER_BODY = '# Issue tracker\n\nLocal markdown files under .scratch, one per feature.\n'
const DOMAIN_BODY = '# Domain\n\nGlossary and ADR pointers.\n'

/** A copy of the plugin whose skills/ directory holds exactly `skills`. */
function fakePackage(skills) {
  const dir = mkdtempSync(join(tmpdir(), 'matt-pkg-'))
  copyFileSync(realEntry, join(dir, 'index.js'))
  const skillRoot = join(dir, 'skills')
  mkdirSync(skillRoot, { recursive: true })
  for (const name of skills) {
    mkdirSync(join(skillRoot, name), { recursive: true })
    writeFileSync(join(skillRoot, name, 'SKILL.md'), `# ${name}\n`, 'utf8')
  }
  // The setup skill ships the templates the plugin copies into a repository.
  const setup = join(skillRoot, 'setup-matt-pocock-skills')
  if (skills.includes('setup-matt-pocock-skills')) {
    writeFileSync(join(setup, 'issue-tracker-local.md'), TRACKER_BODY, 'utf8')
    writeFileSync(join(setup, 'domain.md'), DOMAIN_BODY, 'utf8')
    writeFileSync(join(setup, 'triage-labels.md'), '# Labels\n', 'utf8')
  }
  return join(dir, 'index.js')
}

function fakeRepo(initialised) {
  const repo = mkdtempSync(join(tmpdir(), 'matt-repo-'))
  if (initialised) {
    mkdirSync(join(repo, dirname(TRACKER)), { recursive: true })
    writeFileSync(join(repo, TRACKER), TRACKER_BODY, 'utf8')
  }
  return repo
}

// The probe reports how many approval requests the tool made and what they said,
// which is the only way to observe a prompt that the model would merely see.
function run({ entry, repo }) {
  const probe = `
import { apply } from ${JSON.stringify(entry)}
const defs = []
const asked = []
const ctx = {
  get: (k) => {
    if (k === 'tools') return { register: (d) => { defs.push(d); return () => {} } }
    if (k === 'approval') return { request: async (req) => { asked.push(req.displayReason || { en: req.reason }); return 'allowed-once' } }
    return undefined
  },
  effect: (fn) => fn(),
}
apply(ctx)
const tool = defs.find((d) => d.name === 'flow_stage')
let result = null
let error = null
try {
  result = await tool.execute({ action: 'status', feature: 'probe' }, {
    agent: { id: 'probe', session: { cwd: ${JSON.stringify(repo)} } },
    callId: 'call-probe',
  })
} catch (e) {
  error = e.message
}
console.log('RESULT:' + JSON.stringify({ asked, stage: result && result.stage, error }))
`
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: repo,
    env: { ...process.env, DSH_MATT_FLOW_NO_INSTALL: '1' },
    encoding: 'utf8',
  })
  const line = out.stdout.split('\n').find((l) => l.startsWith('RESULT:'))
  assert.ok(line, `probe produced no result: ${out.stdout}${out.stderr}`)
  return JSON.parse(line.slice('RESULT:'.length))
}

test('a fully provisioned repo is never interrupted by an approval prompt', () => {
  const { asked, error } = run({ entry: fakePackage(required), repo: fakeRepo(true) })
  assert.equal(error, null)
  assert.deepEqual(asked, [], 'status must not ask for anything when nothing is missing')
})

test('an uninitialised repo asks once, naming the files it will write', () => {
  const { asked, error } = run({ entry: fakePackage(required), repo: fakeRepo(false) })
  assert.equal(error, null)
  assert.equal(asked.length, 1, 'exactly one prompt per call')
  assert.match(asked[0].en, /docs\/agents\/issue-tracker\.md/)
  assert.match(asked[0].zh, /docs\/agents\/issue-tracker\.md/)
  // Nothing to install, so no shell command belongs in the card.
  assert.doesNotMatch(asked[0].en, /^\$ |\n\$ /m)
})

test('a missing bundled skill is a broken install, not a prompt', () => {
  // The skills ship inside this package, so nothing the model could run would
  // fetch them back. That makes a gap a packaging fault: refuse, and never
  // dress the refusal up as an approval the user could grant.
  const { asked, error } = run({ entry: fakePackage(required.slice(1)), repo: fakeRepo(true) })
  assert.deepEqual(asked, [], 'a broken install must not become an approval prompt')
  assert.match(error, /bundled skill suite is incomplete/)
  assert.match(error, new RegExp(required[0]), 'the refusal names the missing skill')
})

test('a broken install points at the plugin, not at a download', () => {
  const { error } = run({ entry: fakePackage(required.slice(1)), repo: fakeRepo(true) })
  assert.match(error, /reinstall the plugin/)
  assert.doesNotMatch(error, /skills@latest|npx/, 'there is nothing to download')
})

test('refusing the prompt leaves the repo untouched', () => {
  const repo = fakeRepo(false)
  const entry = fakePackage(required)
  const probe = `
import { apply } from ${JSON.stringify(entry)}
import { existsSync } from 'node:fs'
const defs = []
const ctx = {
  get: (k) => {
    if (k === 'tools') return { register: (d) => { defs.push(d); return () => {} } }
    if (k === 'approval') return { request: async () => 'rejected' }
    return undefined
  },
  effect: (fn) => fn(),
}
apply(ctx)
const tool = defs.find((d) => d.name === 'flow_stage')
let error = null
try {
  await tool.execute({ action: 'status', feature: 'probe' }, {
    agent: { id: 'probe', session: { cwd: ${JSON.stringify(repo)} } },
    callId: 'call-probe',
  })
} catch (e) {
  error = e.message
}
console.log('RESULT:' + JSON.stringify({ error, tracker: existsSync(${JSON.stringify(join(repo, TRACKER))}) }))
`
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: repo,
    env: { ...process.env, DSH_MATT_FLOW_NO_INSTALL: '1' },
    encoding: 'utf8',
  })
  const line = out.stdout.split('\n').find((l) => l.startsWith('RESULT:'))
  assert.ok(line, `probe produced no result: ${out.stdout}${out.stderr}`)
  const { error, tracker } = JSON.parse(line.slice('RESULT:'.length))
  assert.match(error, /did not approve/)
  assert.equal(tracker, false, 'a refused prompt must not create files')
})
