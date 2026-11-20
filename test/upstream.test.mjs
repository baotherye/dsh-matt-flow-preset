import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BASELINE = join(ROOT, '.upstream', 'baseline.json')
const SKILLS = join(ROOT, 'skills')
const SCRIPT = join(ROOT, 'scripts', 'sync-upstream.mjs')

const readBaseline = async () => JSON.parse(await readFile(BASELINE, 'utf8'))

/** Upstream path `engineering/ask-matt/SKILL.md` → `ask-matt/SKILL.md`, modulo renames. */
function toBundled(upstreamPath, baseline) {
  const parts = upstreamPath.split('/')
  if (parts.length < 3) return null
  const [, skill, ...rest] = parts
  if (!rest.length) return null
  if ((baseline.dropSkills ?? []).includes(skill)) return null
  if ((baseline.dropFiles ?? []).includes(upstreamPath)) return null
  const renamed = (baseline.renames ?? {})[skill] ?? skill
  return `${renamed}/${rest.join('/')}`
}

test('the upstream baseline is a manifest, so a sync can tell theirs from ours', async () => {
  const baseline = await readBaseline()
  assert.match(baseline.upstream.repo, /^[\w.-]+\/[\w.-]+$/)
  assert.ok(baseline.upstream.ref, 'the baseline records which ref it tracks')
  assert.match(baseline.upstream.version, /^\d+\.\d+\.\d+$/, 'the upstream version is the detection key')
  assert.match(baseline.upstream.tarballSha, /^[0-9a-f]{64}$/, 'the tarball hash pins exactly what was diffed')
  assert.ok(baseline.upstream.syncedAt, 'the baseline records when it was taken')

  const paths = Object.keys(baseline.files)
  assert.ok(paths.length > 50, `the manifest holds the upstream suite, found ${paths.length}`)
  for (const p of paths) {
    assert.match(baseline.files[p], /^[0-9a-f]{64}$/, `${p} carries a content hash`)
    assert.match(p, /^[\w.-]+\/[\w.-]+\/./, `${p} is keyed by its UPSTREAM path, so renames cannot invalidate it`)
  }
})

test('every bundled skill traces back to an upstream skill, modulo the renames', async () => {
  const baseline = await readBaseline()
  const dropped = new Set(baseline.dropSkills ?? [])

  const bundledSkills = (await readdir(SKILLS, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  // Every upstream skill we do not drop must be present under its bundled name.
  const upstreamSkills = new Set()
  for (const p of Object.keys(baseline.files)) {
    const [, skill] = p.split('/')
    if (skill) upstreamSkills.add(skill)
  }
  for (const skill of upstreamSkills) {
    if (dropped.has(skill)) continue
    const bundledName = (baseline.renames ?? {})[skill] ?? skill
    assert.ok(
      bundledSkills.includes(bundledName),
      `upstream ships ${skill} but skills/${bundledName} is missing — bundle it, or add ${skill} to DROP_SKILLS`,
    )
  }

  for (const name of dropped) {
    assert.ok(!bundledSkills.includes(name), `skills/${name} is in dropSkills but still bundled`)
  }

  // Every rename must name a real upstream skill and a real bundled one.
  for (const [from, to] of Object.entries(baseline.renames ?? {})) {
    assert.ok(upstreamSkills.has(from), `the rename map names ${from}, which upstream no longer ships`)
    assert.ok(bundledSkills.includes(to), `the rename map names ${to}, which is not in the bundle`)
  }
})

test('every adapted file the manifest knows about still exists in the bundle', async () => {
  const baseline = await readBaseline()
  const missing = []
  for (const rel of Object.keys(baseline.files)) {
    const bundled = toBundled(rel, baseline)
    if (!bundled) continue
    try {
      await readFile(join(SKILLS, bundled))
    } catch {
      missing.push(bundled)
    }
  }
  assert.deepEqual(
    missing,
    [],
    'the manifest lists these upstream files, but the bundle does not ship them:\n  ' + missing.join('\n  '),
  )
})

test('no conflict sidecar is left behind for a release', async () => {
  const strays = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.upstream-new')) strays.push(full.slice(ROOT.length + 1))
    }
  }
  await walk(SKILLS)
  assert.deepEqual(
    strays,
    [],
    'these files are upstream drafts awaiting re-adaptation; merge or delete them before releasing:\n  ' + strays.join('\n  '),
  )
})

test('the manifest and the sync script agree on the rename and drop lists', async () => {
  const baseline = await readBaseline()
  const script = await readFile(SCRIPT, 'utf8')
  for (const name of baseline.dropSkills ?? []) {
    assert.ok(script.includes(`'${name}'`), `${name} is in the manifest's drop list but not in the script`)
  }
  for (const [from, to] of Object.entries(baseline.renames ?? {})) {
    assert.ok(script.includes(`'${from}': '${to}'`), `the rename ${from} → ${to} is in the manifest but not the script`)
  }
  for (const glob of baseline.dropFileGlobs ?? []) {
    assert.ok(script.includes(`'${glob}'`), `the dropped-file glob ${glob} is in the manifest but not the script`)
  }
  for (const file of baseline.dropFiles ?? []) {
    assert.ok(script.includes(`'${file}'`), `the dropped file ${file} is in the manifest but not the script`)
    assert.ok(
      !baseline.files[file],
      `${file} is dropped, so it must not also be tracked in the manifest`,
    )
  }
})
