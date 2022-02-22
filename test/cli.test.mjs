import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = resolve(projectDirectory, 'bin/content-brief-schema.mjs')

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: projectDirectory,
    encoding: 'utf8',
  })
}

test('a valid minimal brief exits zero', () => {
  const result = run(['examples/minimal-brief.json'])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /status pass/)
})

test('a valid extended brief exits zero', () => {
  assert.equal(run(['examples/extended-brief.json']).status, 0)
})

test('the invalid example exits one and names the failing paths', () => {
  const result = run(['examples/invalid-brief.json'])

  assert.equal(result.status, 1)
  assert.match(result.stdout, /\/evidence/)
  assert.match(result.stdout, /\/owner\/contact/)
})

test('--json emits a parseable report on stdout', () => {
  const result = run(['examples/invalid-brief.json', '--json'])
  const report = JSON.parse(result.stdout)

  assert.equal(result.status, 1)
  assert.equal(report.tool, 'content-brief-schema')
  assert.equal(report.status, 'fail')
  assert.ok(report.findings.some((item) => item.location.pointer === '/owner/contact'))
})

test('repeated runs over the same input produce identical JSON', () => {
  const first = run(['examples/invalid-brief.json', '--json']).stdout
  const second = run(['examples/invalid-brief.json', '--json']).stdout

  assert.equal(first, second)
})

test('several briefs are checked in one run', () => {
  const result = run(['examples/minimal-brief.json', 'examples/extended-brief.json', '--json'])
  const report = JSON.parse(result.stdout)

  assert.equal(result.status, 0)
  assert.equal(report.summary.checked, 2)
})

test('a missing file is incomplete and exits two, not zero', () => {
  const result = run(['examples/does-not-exist.json', '--json'])
  const report = JSON.parse(result.stdout)

  assert.equal(result.status, 2)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.summary.unreadable, 1)
})

test('malformed JSON is incomplete rather than a schema failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brief-cli-'))
  try {
    const path = join(directory, 'broken.json')
    await writeFile(path, '{ "schemaVersion": ')

    const result = run([path, '--json'])
    const report = JSON.parse(result.stdout)

    assert.equal(result.status, 2)
    assert.equal(report.status, 'incomplete')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('no arguments is a usage error on stderr', () => {
  const result = run([])

  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /at least one brief file/)
})

test('an unknown option is a usage error', () => {
  const result = run(['examples/minimal-brief.json', '--strict'])

  assert.equal(result.status, 2)
  assert.match(result.stderr, /Unknown option "--strict"/)
})

test('--help exits zero and writes to stdout', () => {
  const result = run(['--help'])

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
  assert.equal(result.stderr, '')
})

test('diagnostics stay off stdout so --json can be piped', () => {
  const result = run(['examples/invalid-brief.json', '--json'])

  assert.doesNotThrow(() => JSON.parse(result.stdout))
  assert.equal(result.stderr, '')
})
