// Isolation contract: Matt skills must live only in a preset-private directory,
// never in the shared ~/.agents/skills that every agent preset scans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const entry = join(root, 'index.js')

const PRIVATE_DSH = '/nonexistent-dsh-home-for-isolation-test'
const PRIVATE_SKILLS = join(PRIVATE_DSH, 'dsh-matt-flow-preset', '.agents', 'skills')

// Ask flow_skills for the manual command on an unprovisioned private home.
const probe = `
import { apply } from ${JSON.stringify(entry)}
const defs = []
const ctx = {
  get: (k) => (k === 'tools' ? { register: (d) => { defs.push(d); return () => {} } } : undefined),
  effect: (fn) => fn(),
}
apply(ctx)
const tool = defs.find((d) => d.name === 'flow_skills')
const out = await tool.execute({ action: 'status' }, {})
console.log('RESULT:' + JSON.stringify(out))
`
const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
  env: { ...process.env, DSH_HOME: PRIVATE_DSH, DSH_MATT_FLOW_NO_INSTALL: '1' },
  encoding: 'utf8',
})
const line = (result.stdout || '').split('\n').find((l) => l.startsWith('RESULT:'))
assert.ok(line, `probe produced no result: ${result.stdout}${result.stderr}`)
const status = JSON.parse(line.slice('RESULT:'.length))

test('flow_skills returns a manual command when skills are missing', () => {
  assert.equal(status.state, 'missing')
  assert.match(status.command, /skills@latest add/)
})

test('the install command cds into the private home, not the shared one', () => {
  assert.match(status.command, new RegExp(`cd "${PRIVATE_DSH}/dsh-matt-flow-preset"`))
  assert.match(status.command, /-a universal/)
})

test('the install command is project-scope: it must NOT use -g', () => {
  // A global install would land in ~/.agents/skills, visible to every preset.
  assert.doesNotMatch(status.command, /(^|\s)-g(\s|$)/)
})

test('cordis.patch.yml mounts the same private dir as a custom skill root', () => {
  const yaml = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const preset = yaml.split('\n').findIndex((l) => l.trim() === '- id: preset-matt')
  const block = yaml.split('\n').slice(preset, preset + 45).join('\n')
  assert.match(block, /id: skill-filesystem/)
  assert.match(block, /customSkillDirs:/)
  assert.match(block, /dsh-matt-flow-preset.*\.agents.*skills/)
})
