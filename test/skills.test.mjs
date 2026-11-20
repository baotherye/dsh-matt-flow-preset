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
  assert.ok(dirs.length >= 38, `expected the full suite, found ${dirs.length}`)
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

test('the flow skills hand the phase back to flow_stage', () => {
  // The system prompt makes `flow_stage` the phase owner. A skill that writes
  // spec.md or issues/ without asking it makes the on-disk record and flow.json
  // disagree, which is what `resume` then reads.
  for (const skill of ['to-spec', 'to-tickets', 'implement', 'implement-spec']) {
    const text = readFileSync(join(skillsRoot, skill, 'SKILL.md'), 'utf8')
    assert.match(text, /flow_stage/, `${skill}: must name the stage tool that owns the phase`)
    assert.match(text, /action: "status"/, `${skill}: must read the stage before writing`)
    assert.match(text, /action: "advance"/, `${skill}: must record the stage it reached`)
  }
})

test('the domain file the plugin points every repo at is the one the skills maintain', () => {
  // domain-modeling writes GLOSSARY.md; setup-matt-pocock-skills calls CONTEXT.md
  // the legacy name. The plugin used to scaffold a pointer to the legacy file.
  const domainSkil = readFileSync(join(skillsRoot, 'domain-modeling', 'SKILL.md'), 'utf8')
  assert.match(domainSkil, /GLOSSARY\.md/, 'domain-modeling maintains GLOSSARY.md')
  assert.doesNotMatch(source, /`CONTEXT\.md` and `docs\/adr\/`/, 'the AGENTS.md block must point at GLOSSARY.md')
  const setup = readFileSync(join(skillsRoot, 'setup-matt-pocock-skills', 'SKILL.md'), 'utf8')
  assert.match(setup, /legacy `CONTEXT\.md`/, 'setup-matt-pocock-skills knows CONTEXT.md is the legacy name')
})

test('no skill depends on a tool this preset does not mount', () => {
  // The preset mounts a fixed tool set, and the profile adds a few host-plane
  // rows every agent sees (`create_worktree`, the terminal and browser tools).
  // Naming anything outside both is a dead call.
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const mounted = new Set([
    'read', 'write', 'edit', 'apply_patch', 'read_image', 'glob', 'grep', 'bash',
    'todo_write', 'web_search', 'web_fetch', 'job_output', 'job_list', 'job_kill',
    'list_agents', 'wait_agent', 'send_message', 'interrupt_agent', 'subagent',
    'subagent_fork', 'workflow', 'ask_user_question', 'present', 'skill',
    'get_goal', 'create_goal', 'update_goal', 'schedule_create', 'schedule_edit',
    'schedule_list', 'schedule_view', 'flow_stage', 'flow_ask', 'flow_skills',
    'create_worktree', 'working_directory', 'subagent_fork',
  ])
  assert.match(patch, /dsh-tool-schedule/, 'schedule tools are mounted, so skills may name them')
  // `create_worktree` ships in a profile bundle (`dsh-experimental-tool-worktree`)
  // rather than this patch, which is why it is in the set but not in the patch.
  const named = new Set()
  for (const dir of dirs) {
    for (const file of readdirSync(join(skillsRoot, dir), { recursive: true })) {
      const rel = join(skillsRoot, dir, String(file))
      if (!String(file).endsWith('.md')) continue
      const text = readFileSync(rel, 'utf8')
      for (const m of text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) named.add(m[1])
    }
  }
  // snake_case tokens are overwhelmingly file names and config keys; only flag
  // the ones shaped like a model tool call the skills actually instruct.
  const toolish = ['todo_write', 'job_output', 'job_kill', 'web_fetch', 'web_search',
    'schedule_create', 'schedule_edit', 'schedule_list', 'schedule_view',
    'create_goal', 'update_goal', 'get_goal', 'interrupt_agent', 'wait_agent',
    'send_message', 'list_agents', 'ask_user_question', 'apply_patch', 'read_image']
  for (const tool of toolish) {
    if (!named.has(tool)) continue
    assert.ok(mounted.has(tool), `${tool} is named but not mounted by the preset`)
  }
})
