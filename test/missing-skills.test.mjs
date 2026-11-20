import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The skills ship inside this package, so a partial install is the only way they
// can be absent. This probe builds such a package and asserts that the plugin
// refuses cleanly instead of offering a download that no longer exists.
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const realEntry = join(root, 'index.js')

const source = readFileSync(realEntry, 'utf8')
const required = [...source.match(/REQUIRED_SKILLS = \[([\s\S]*?)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])

// A package with every skill but the first, so exactly one name is missing.
const pkg = mkdtempSync(join(tmpdir(), 'matt-broken-'))
copyFileSync(realEntry, join(pkg, 'index.js'))
for (const name of required.slice(1)) {
  mkdirSync(join(pkg, 'skills', name), { recursive: true })
  writeFileSync(join(pkg, 'skills', name, 'SKILL.md'), `# ${name}\n`, 'utf8')
}
const entry = join(pkg, 'index.js')
// A throwaway repo: the probe must never fall back to this checkout as its cwd.
const repo = mkdtempSync(join(tmpdir(), 'matt-broken-repo-'))

const probe = `
import { apply } from ${JSON.stringify(entry)}
const defs = []
const asked = []
const ctx = {
  get: (k) => {
    if (k === 'tools') return { register: (d) => { defs.push(d); return () => {} } }
    if (k === 'approval') return { request: async (req) => { asked.push(1); return 'allowed-once' } }
    return undefined
  },
  effect: (fn) => fn(),
}
apply(ctx)
const stage = defs.find((d) => d.name === 'flow_stage')
let error = null
try {
  await stage.execute({ action: 'status', feature: 'probe' }, {
    agent: { id: 'probe', session: { cwd: ${JSON.stringify(repo)} } },
    callId: 'call-probe',
  })
} catch (e) {
  error = e.message.split(String.fromCharCode(10)).join(' | ')
}
const skills = defs.find((d) => d.name === 'flow_skills')
const status = await skills.execute({ action: 'status' }, {})
console.log('RESULT:' + JSON.stringify({ error, asked: asked.length, status }))
`

const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
  env: { ...process.env, DSH_MATT_FLOW_NO_INSTALL: '1' },
  encoding: 'utf8',
})
const out = `${result.stdout || ''}${result.stderr || ''}`.trim()
const line = (result.stdout || '').split('\n').find((l) => l.startsWith('RESULT:'))
const parsed = line ? JSON.parse(line.slice('RESULT:'.length)) : null

let pass = 0
let fail = 0
const ok = (name, condition, extra = '') => {
  if (condition) { pass++; console.log('  ok  ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) }
}

ok('flow_stage refuses a package with a missing skill', !!parsed && /bundled skill suite is incomplete/.test(parsed.error || ''), out.slice(0, 200))
ok('the refusal names the exact missing skill', !!parsed && new RegExp(required[0]).test(parsed.error || ''), out.slice(0, 200))
ok('a broken install never becomes an approval prompt', !!parsed && parsed.asked === 0, out.slice(0, 200))
ok('flow_skills reports the gap without a download command', !!parsed && parsed.status.state === 'incomplete' && parsed.status.command === undefined, out.slice(0, 240))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
