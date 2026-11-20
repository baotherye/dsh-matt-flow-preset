// Isolation contract: the Matt skills ship inside this package and are declared
// as a skill root by the matt preset only. No other agent preset may see them,
// and nothing is downloaded at runtime.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const entry = join(root, 'index.js')
const bundled = join(root, 'skills')

const probe = `
import { apply } from ${JSON.stringify(entry)}
const defs = []
const ctx = {
  get: (k) => (k === 'tools' ? { register: (d) => { defs.push(d); return () => {} } } : undefined),
  effect: (fn) => fn(),
}
apply(ctx)
const tool = defs.find((d) => d.name === 'flow_skills')
console.log('RESULT:' + JSON.stringify(await tool.execute({ action: 'status' }, {})))
`
const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
  env: { ...process.env, DSH_MATT_FLOW_NO_INSTALL: '1' },
  encoding: 'utf8',
})
const line = (result.stdout || '').split('\n').find((l) => l.startsWith('RESULT:'))
assert.ok(line, `probe produced no result: ${result.stdout}${result.stderr}`)
const status = JSON.parse(line.slice('RESULT:'.length))

test('flow_skills reports the bundled suite as present', () => {
  assert.equal(status.state, 'present')
  assert.deepEqual(status.missing, [])
  assert.equal(status.directory, bundled)
})

test('flow_skills exposes no install command at all', () => {
  assert.equal(status.command, undefined)
  assert.doesNotMatch(JSON.stringify(status), /skills@latest|npx/)
})

test('index.js contains no download path', () => {
  const source = readFileSync(entry, 'utf8')
  assert.doesNotMatch(source, /skills@latest/)
  assert.doesNotMatch(source, /mattpocock\/skills/)
  assert.doesNotMatch(source, /child_process/)
  assert.doesNotMatch(source, /-a universal/)
})

test('every required skill is bundled in the package', () => {
  const source = readFileSync(entry, 'utf8')
  const block = source.slice(source.indexOf('REQUIRED_SKILLS'), source.indexOf(']', source.indexOf('REQUIRED_SKILLS')))
  const names = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
  assert.ok(names.length > 20, `expected a full skill list, got ${names.length}`)
  for (const name of names) {
    assert.ok(existsSync(join(bundled, name, 'SKILL.md')), `missing bundled skill: ${name}`)
  }
})

test('the bundle carries the upstream MIT attribution', () => {
  const notice = readFileSync(join(bundled, 'ATTRIBUTION.md'), 'utf8')
  assert.match(notice, /mattpocock\/skills/)
  assert.match(notice, /MIT/)
})

test('cordis.patch.yml points the matt preset at the package skills dir', () => {
  const yaml = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const lines = yaml.split('\n')
  const preset = lines.findIndex((l) => l.trim() === '- id: preset-matt')
  const block = lines.slice(preset, preset + 70).join('\n')
  assert.match(block, /id: skill-filesystem/)
  assert.match(block, /customSkillDirs:/)
  assert.match(block, /createRequire\(baseUrl\)\.resolve\('@baotherye\/dsh-matt-flow-preset\/package\.json'\)/)
  assert.match(block, /'skills'\)/)
})

test('the shared ~/.agents/skills is never referenced', () => {
  for (const file of ['index.js', 'cordis.patch.yml']) {
    const text = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(text, /\.agents\/skills/, `${file} still points at the shared dir`)
  }
})
