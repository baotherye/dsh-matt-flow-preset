#!/usr/bin/env node
/**
 * Sync the bundled skill suite with upstream mattpocock/skills.
 *
 * The bundle in `skills/` is not a copy — every skill has been adapted for
 * DeepSeek Harness (tool names, no `/clear`, schedules, AGENTS.md, stage
 * handoff…). So this script never blind-copies upstream over the bundle. It
 * keeps a hash manifest of the pristine upstream it last synced against and
 * does a three-way comparison per file:
 *
 *   upstream unchanged since baseline → leave the bundle alone
 *   upstream changed, we did not     → safe to take upstream verbatim
 *   both sides changed               → CONFLICT: write `<file>.upstream-new`
 *                                      next to ours and list it for manual
 *                                      re-adaptation
 *
 * `skills/` also drops upstream files we chose not to ship (see RENAMES and
 * DROP_*), so a vanished file is not treated as an error.
 *
 * Usage:
 *   node scripts/sync-upstream.mjs            # check only, no writes
 *   node scripts/sync-upstream.mjs --apply    # take the safe updates, rewrite manifest
 *   node scripts/sync-upstream.mjs --force    # re-download even if the version matches
 *   node scripts/sync-upstream.mjs --seed     # record CURRENT upstream as the
 *                                             # baseline and touch nothing in skills/
 *                                             # (first-time setup / re-baselining only)
 *
 * Exit codes: 0 in sync or applied cleanly, 1 conflicts need a human, 2 failure.
 * Requires `tar` on PATH (macOS, Linux, Windows 10+).
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS_DIR = join(ROOT, 'skills')
const UPSTREAM_DIR = join(ROOT, '.upstream')
const BASELINE_FILE = join(UPSTREAM_DIR, 'baseline.json')

const UPSTREAM_REPO = 'mattpocock/skills'
const UPSTREAM_REF = 'main'
const TARBALL_URL = `https://codeload.github.com/${UPSTREAM_REPO}/tar.gz/refs/heads/${UPSTREAM_REF}`
// raw.githubusercontent.com is reset by some proxies; the contents API is not.
const VERSION_URLS = [
  `https://api.github.com/repos/${UPSTREAM_REPO}/contents/package.json?ref=${UPSTREAM_REF}`,
  `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_REF}/package.json`,
]

/** Upstream skill dir name → bundled dir name. */
const RENAMES = {
  'claude-handoff': 'handoff-agent',
  'git-guardrails-claude-code': 'git-guardrails',
}

/** Upstream skills we deliberately do not ship. */
const DROP_SKILLS = ['software-factory']

/** Upstream files we deliberately drop, as globs relative to a skill dir. */
const DROP_FILE_GLOBS = ['agents/**']

/**
 * Individual upstream files we dropped on purpose, by upstream path. Unlike the
 * globs above, these are decisions with a reason — keep the reason next to it.
 */
const DROP_FILES = [
  // git-guardrails was rewritten around DSH permission presets; a Claude Code
  // PreToolUse shell hook has no equivalent here, so the script goes with it.
  'misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh',
]

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const FORCE = args.has('--force')
const SEED = args.has('--seed')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const posix = (p) => p.split(sep).join('/')

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** Every file under `dir`, as posix-style relative paths. */
async function walk(dir, base = dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, base)))
    else if (entry.isFile()) out.push(posix(relative(base, full)))
  }
  return out.sort()
}

/** Hash every file under `dir` into `{ relPath: sha256 }`. */
async function hashTree(dir) {
  const map = {}
  for (const rel of await walk(dir)) map[rel] = sha256(await readFile(join(dir, rel)))
  return map
}

function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`)
}

const DROP_FILE_RES = DROP_FILE_GLOBS.map(globToRegExp)

/** `engineering/ask-matt/SKILL.md` → { skill: 'ask-matt', rest: 'SKILL.md' }, else null. */
function parseUpstreamPath(rel) {
  const parts = rel.split('/')
  if (parts.length < 3) return null
  const [, skill, ...rest] = parts
  if (!rest.length) return null
  return { skill, rest: rest.join('/') }
}

/** Upstream skill dir name → bundled dir name, or null when it is dropped. */
function bundleNameFor(skill) {
  if (DROP_SKILLS.includes(skill)) return null
  return RENAMES[skill] ?? skill
}

const isDroppedFile = (rest) => DROP_FILE_RES.some((re) => re.test(rest))

/** `engineering/ask-matt/SKILL.md` → `handoff-agent/SKILL.md` (post-rename, post-drop). */
function bundledPathFor(upstreamRel) {
  if (DROP_FILES.includes(upstreamRel)) return null
  const parsed = parseUpstreamPath(upstreamRel)
  if (!parsed) return null
  const bundleName = bundleNameFor(parsed.skill)
  if (!bundleName) return null
  if (isDroppedFile(parsed.rest)) return null
  return `${bundleName}/${parsed.rest}`
}

function log(line = '') {
  process.stdout.write(line + '\n')
}

async function fetchUpstreamVersion() {
  const failures = []
  for (const url of VERSION_URLS) {
    const headers = {
      'user-agent': 'dsh-matt-flow-sync',
      accept: url.includes('api.github.com') ? 'application/vnd.github.raw' : 'text/plain',
    }
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) {
        failures.push(`${url} → HTTP ${res.status}`)
        continue
      }
      return JSON.parse(await res.text()).version
    } catch (error) {
      failures.push(`${url} → ${error.cause?.code ?? error.message}`)
    }
  }
  throw new Error(`could not read the upstream version:\n  ${failures.join('\n  ')}`)
}

async function downloadUpstream() {
  const work = await mkdtemp(join(tmpdir(), 'upstream-skills-'))
  log(`downloading ${TARBALL_URL}`)
  const res = await fetch(TARBALL_URL, { headers: { 'user-agent': 'dsh-matt-flow-sync' } })
  if (!res.ok) throw new Error(`GET ${TARBALL_URL} → HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const tgz = join(work, 'upstream.tgz')
  await writeFile(tgz, buf)

  const untar = spawnSync('tar', ['-xzf', tgz, '-C', work], { stdio: 'inherit' })
  if (untar.error) throw new Error(`tar is required: ${untar.error.message}`)
  if (untar.status !== 0) throw new Error(`tar exited ${untar.status}`)

  const [root] = (await readdir(work, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  if (!root) throw new Error('the tarball did not contain a directory')
  return {
    dir: join(work, root),
    cleanup: () => rm(work, { recursive: true, force: true }),
    tarballSha: sha256(buf),
    skills: join(work, root, 'skills'),
  }
}

async function readBaseline() {
  if (!(await exists(BASELINE_FILE))) {
    return {
      upstream: { repo: UPSTREAM_REPO, ref: UPSTREAM_REF, version: null, tarballSha: null, syncedAt: null },
      renames: RENAMES,
      dropSkills: DROP_SKILLS,
      dropFileGlobs: DROP_FILE_GLOBS,
      dropFiles: DROP_FILES,
      files: {},
    }
  }
  return JSON.parse(await readFile(BASELINE_FILE, 'utf8'))
}

function baselineFor(version, tarballSha, files) {
  return JSON.stringify(
    {
      $comment:
        'Manifest of the pristine upstream suite this bundle was last synced against. '
        + 'Files are keyed by their UPSTREAM path (skills/<group>/<skill>/<file>), so a '
        + 'rename or drop in scripts/sync-upstream.mjs never invalidates them. '
        + 'Regenerate with: node scripts/sync-upstream.mjs --seed --force',
      upstream: {
        repo: UPSTREAM_REPO,
        ref: UPSTREAM_REF,
        version,
        tarballSha,
        syncedAt: new Date().toISOString(),
      },
      renames: RENAMES,
      dropSkills: DROP_SKILLS,
      dropFileGlobs: DROP_FILE_GLOBS,
      dropFiles: DROP_FILES,
      files,
    },
    null,
    2,
  ) + '\n'
}

/** Classify every upstream file (post-baseline) against the bundle. */
async function analyse(upstreamSkills, baseline) {
  const upstream = await hashTree(upstreamSkills)
  const local = await hashTree(SKILLS_DIR)

  const records = []
  const seenBundled = new Set()

  for (const [rel, upHash] of Object.entries(upstream)) {
    const bundledRel = bundledPathFor(rel)
    if (!bundledRel) continue
    seenBundled.add(bundledRel)

    const baseHash = baseline.files[rel]
    const localHash = local[bundledRel]

    if (baseHash === undefined) {
      records.push({ kind: 'added-upstream', rel, bundledRel })
      continue
    }
    // We are still on the baseline, so whatever upstream did is safe to take.
    if (localHash === baseHash) {
      records.push({ kind: baseHash === upHash ? 'in-sync' : 'auto-updatable', rel, bundledRel })
      continue
    }
    // We diverged from the baseline (we adapted the file).
    if (localHash === undefined) records.push({ kind: 'local-removed', rel, bundledRel })
    else if (baseHash === upHash) records.push({ kind: 'adapted', rel, bundledRel })
    else records.push({ kind: 'conflict', rel, bundledRel })
  }

  for (const [rel] of Object.entries(baseline.files)) {
    if (upstream[rel] !== undefined) continue
    const bundledRel = bundledPathFor(rel)
    if (!bundledRel) continue
    records.push({ kind: 'upstream-removed', rel, bundledRel })
  }

  for (const [rel] of Object.entries(local)) {
    if (!seenBundled.has(rel)) records.push({ kind: 'local-only', bundledRel: rel })
  }

  return { records, upstream }
}

const LABELS = {
  conflict: 'CONFLICT — upstream changed, and so did our adaptation',
  'upstream-removed': 'REMOVED UPSTREAM — decide whether to drop it here',
  'added-upstream': 'NEW UPSTREAM FILE — copied, needs DSH adaptation',
  'auto-updatable': 'upstream changed, we had not — safe to take',
  adapted: 'we adapted it, upstream unchanged',
  'in-sync': 'in sync',
  'local-removed': 'removed locally, upstream unchanged',
  'local-only': 'local only (not from upstream)',
}

const KIND_ORDER = [
  'conflict', 'upstream-removed', 'added-upstream', 'auto-updatable',
  'adapted', 'in-sync', 'local-removed', 'local-only',
]

function report(records, { version, baseVersion }) {
  log()
  log(`upstream ${UPSTREAM_REPO}@${UPSTREAM_REF}  version ${version}`)
  log(`baseline version ${baseVersion ?? '(none — run --seed)'}`)
  log()

  const groups = new Map()
  for (const r of records) {
    if (!groups.has(r.kind)) groups.set(r.kind, [])
    groups.get(r.kind).push(r)
  }

  for (const kind of KIND_ORDER) {
    const items = groups.get(kind)
    if (!items?.length) continue
    log(`${LABELS[kind]} (${items.length})`)
    // The quiet groups are long; list them compactly.
    for (const item of items) log(`  ${item.bundledRel ?? item.rel}`)
    log()
  }

  const count = (kind) => groups.get(kind)?.length ?? 0
  const safe = count('auto-updatable') + count('added-upstream')
  const needsHuman = count('conflict') + count('upstream-removed') + count('added-upstream')
  return { safe, needsHuman, count }
}

async function apply(upstreamSkills, upstream, records, meta) {
  let copied = 0
  for (const r of records) {
    if (r.kind !== 'auto-updatable' && r.kind !== 'added-upstream') continue
    const to = join(SKILLS_DIR, r.bundledRel)
    await mkdir(dirname(to), { recursive: true })
    await writeFile(to, await readFile(join(upstreamSkills, r.rel)))
    copied += 1
  }

  const sidecars = []
  for (const r of records) {
    if (r.kind !== 'conflict') continue
    const to = join(SKILLS_DIR, `${r.bundledRel}.upstream-new`)
    await mkdir(dirname(to), { recursive: true })
    await writeFile(to, await readFile(join(upstreamSkills, r.rel)))
    sidecars.push(to)
  }

  // The new baseline is exactly what we just compared against, minus the
  // files that only exist because we renamed or dropped them.
  const files = {}
  for (const [rel, hash] of Object.entries(upstream)) {
    if (bundledPathFor(rel)) files[rel] = hash
  }

  await mkdir(UPSTREAM_DIR, { recursive: true })
  await writeFile(BASELINE_FILE, baselineFor(meta.version, meta.tarballSha, files))
  return { copied, sidecars }
}

async function main() {
  const baseline = await readBaseline()
  const baseVersion = baseline.upstream.version

  log(`bundle   ${SKILLS_DIR}`)
  log(`baseline ${BASELINE_FILE}`)

  const version = await fetchUpstreamVersion()
  log(`baseline tracks ${baseVersion ?? '(none)'}, upstream is ${version}`)

  if (SEED) {
    if (baseVersion !== null && !FORCE) {
      log()
      log(`a baseline for ${baseVersion} exists; pass --seed --force to re-baseline onto ${version}.`)
      return 2
    }
    const up = await downloadUpstream()
    try {
      const upstream = await hashTree(up.skills)
      const files = {}
      for (const [rel, hash] of Object.entries(upstream)) {
        if (bundledPathFor(rel)) files[rel] = hash
      }
      await mkdir(UPSTREAM_DIR, { recursive: true })
      await writeFile(BASELINE_FILE, baselineFor(version, up.tarballSha, files))
      log()
      log(`seeded the baseline from upstream ${version} (${Object.keys(files).length} files); skills/ untouched.`)
      return 0
    } finally {
      await up.cleanup()
    }
  }

  if (baseVersion === version && !FORCE) {
    log()
    log('already tracking the current upstream version — nothing to do.')
    log('  (pass --force to re-download and re-analyse anyway)')
    return 0
  }

  const up = await downloadUpstream()
  try {
    const { records, upstream } = await analyse(up.skills, baseline)
    const { safe, needsHuman } = report(records, { version, baseVersion })

    if (!APPLY) {
      log(`${safe} file(s) can be taken automatically; ${needsHuman} need a decision.`)
      log('re-run with --apply to take the safe ones and rewrite the baseline.')
      return needsHuman > 0 ? 1 : 0
    }

    const { copied, sidecars } = await apply(up.skills, upstream, records, {
      version,
      tarballSha: up.tarballSha,
    })
    log(`took ${copied} file(s) from upstream; baseline now tracks ${version}.`)
    if (sidecars.length) {
      log()
      log('re-adapt these, then delete the .upstream-new sidecar:')
      for (const p of sidecars) log(`  ${posix(relative(ROOT, p))}`)
      return 1
    }
    if (records.some((r) => r.kind === 'upstream-removed')) {
      log()
      log('upstream no longer ships the files listed as REMOVED UPSTREAM; decide per file.')
      return 1
    }
    log('bundle is in sync.')
    return 0
  } finally {
    await up.cleanup()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`sync-upstream failed: ${error.message}\n`)
    process.exit(2)
  })
