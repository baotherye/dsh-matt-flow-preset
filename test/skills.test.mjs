// DSH fit contract: every bundled skill must parse under the DSH skill loader,
// and the system prompt's catalog must agree with what the files actually
// declare. A skill that lists itself as model-invocable in prose but sets
// `disable-model-invocation: true` is a silent dead command, so the two are
// checked against each other rather than trusted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const skillsRoot = join(root, 'skills')
const source = readFileSync(join(root, 'index.js'), 'utf8')

// Mirrors @deepseek-ai/dsh-skill-filesystem: parseSkillFile requires `name`
// (matching SKILL_NAME) and `description`; parseInvocationPolicy rejects the
// legacy camelCase keys outright.
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LEGACY_KEYS = ['disableModelInvocation', 'modelInvocable', 'userInvocable']

function readSkill(dir) {
  const text = readFileSync(join(skillsRoot, dir, 'SKILL.md'), 'utf8')
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!block) return null
  const fm = {}
  for (const line of block[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return {
    fm,
    modelInvocable: fm['disable-model-invocation'] !== 'true',
    userInvocable: fm['user-invocable'] !== 'false',
  }
}

const dirs = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(skillsRoot, d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort()

test('every bundled skill has DSH-legal frontmatter', () => {
  assert.ok(dirs.length >= 39, `expected the full suite, found ${dirs.length}`)
  for (const dir of dirs) {
    const skill = readSkill(dir)
    assert.ok(skill, `${dir}: no YAML frontmatter`)
    assert.ok(skill.fm.name, `${dir}: frontmatter requires name`)
    assert.match(skill.fm.name, SKILL_NAME, `${dir}: illegal skill name "${skill.fm.name}"`)
    assert.equal(skill.fm.name, dir, `${dir}: name must match the directory`)
    assert.ok(skill.fm.description, `${dir}: frontmatter requires description`)
    for (const legacy of LEGACY_KEYS) {
      assert.ok(!(legacy in skill.fm), `${dir}: legacy key ${legacy} is rejected by DSH`)
    }
  }
})

test('no skill ships an OpenAI interface file', () => {
  for (const dir of dirs) {
    assert.ok(!existsSync(join(skillsRoot, dir, 'agents', 'openai.yaml')), `${dir}: agents/openai.yaml is dead weight in DSH`)
  }
})

test('no skill still targets Claude Code', () => {
  // These are the concrete mechanisms DSH does not have. Product names in a
  // survey list are fine; a skill telling the agent to use one of these is not.
  const forbidden = [
    [/PreToolUse/, 'Claude Code hook'],
    [/CLAUDE_PROJECT_DIR/, 'Claude Code project env var'],
    [/\.claude\/settings\.json/, 'Claude Code settings'],
    [/claude --bg/, 'Claude Code background agent launch'],
    [/\bSkill tool\b/, 'the Claude Code tool name (DSH calls it `skill`)'],
    [/\/clear\b/, 'the /clear command, which DSH does not have'],
  ]
  for (const dir of dirs) {
    const files = readdirSync(join(skillsRoot, dir), { recursive: true })
      .filter((f) => String(f).endsWith('.md') || String(f).endsWith('.sh'))
    for (const file of files) {
      const rel = join(dir, String(file))
      if (rel === join('software-factory', 'OBSERVABILITY-PLATFORMS.md')) continue // survey content
      if (rel === join('software-factory', 'RUNNERS.md')) continue
      if (rel === join('software-factory', 'TICKET-TRACKERS.md')) continue
      // Explaining WHY DSH needs a different mechanism is the point of this
      // skill; what matters is that it does not tell the agent to use one.
      if (rel === join('git-guardrails', 'SKILL.md')) continue
      const text = readFileSync(join(skillsRoot, rel), 'utf8')
      for (const [pattern, what] of forbidden) {
        assert.doesNotMatch(text, pattern, `${rel}: still references ${what}`)
      }
    }
  }
})

test('the prompt catalog matches the frontmatter, both ways', () => {
  const section = source.slice(source.indexOf('const FLOW_SECTION'), source.indexOf('## Route'))
  const modelLine = section.match(/Model-invocable[^\n]*\n/)[0]
  const userLine = section.match(/User-only[^\n]*\n/)[0]

  const modelClaimed = [...modelLine.matchAll(/\\`([a-z0-9-]+)\\`/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'skill')
    .sort()
  const userClaimed = [...userLine.matchAll(/\\`\/([a-z0-9-]+)\\`/g)].map((m) => m[1]).sort()

  const actualModel = dirs.filter((d) => readSkill(d).modelInvocable).sort()
  const actualUser = dirs.filter((d) => !readSkill(d).modelInvocable).sort()

  assert.deepEqual(modelClaimed, actualModel, 'model-invocable list in the prompt must equal the bundle')
  assert.deepEqual(userClaimed, actualUser, 'user-only list in the prompt must equal the bundle')
})

test('every skill the prompt tells the model to load exists', () => {
  const section = source.slice(source.indexOf('const FLOW_SECTION'), source.indexOf('const STAGES'))
  const named = new Set([...section.matchAll(/\\`([a-z0-9]+(?:-[a-z0-9]+)*)\\`/g)].map((m) => m[1]))
  // Only tokens that look like skill names are checked: stage ids and file names
  // are not skills, so a miss here is filtered by the bundle membership test.
  for (const name of named) {
    if (!/^(grill|tdd|code|codebase|domain|diagnosing|prototype|research|pr|git|migrate|setup|wizard|writing|ask|implement|to-|triage|wayfinder|improve|handoff|retro|wait|teach|loop|chief)/.test(name)) continue
    assert.ok(dirs.includes(name), `prompt names \`${name}\`, which is not in the bundle`)
  }
})
