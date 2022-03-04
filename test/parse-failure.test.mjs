import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseFailureDetail } from '../src/index.mjs'

/**
 * A brief that cannot be parsed must not be republished by its own diagnostic.
 *
 * V8 reports a parse failure two ways, and one of them quotes the input back:
 * `Unexpected token 'A', "AKIAIOSFODNN7EXAMPLE" is not valid JSON`. The quoted
 * run is the first ten characters of the document, or the whole document when
 * it is shorter, so a brief short enough to be nothing but a credential is
 * reproduced in full by its own error message. `brief-unreadable` interpolated
 * that message whole, which put the contents of an unparseable file on stdout
 * -- on the error path, which is the path an untrusted file is guaranteed to
 * take.
 *
 * The canary is `AKIAIOSFODNN7EXAMPLE`, the access key id AWS publishes in its
 * own documentation. It is not a credential; it is the shape of one, and it is
 * the shape a scanner watching this tool's output would flag.
 */

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = resolve(projectDirectory, 'bin/content-brief-schema.mjs')

const CANARY = 'AKIAIOSFODNN7EXAMPLE'

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: projectDirectory, encoding: 'utf8' })
}

/** Write `content` to a temporary brief, run the real binary over it, clean up. */
async function withBrief(content, body) {
  const directory = await mkdtemp(join(tmpdir(), 'brief-canary-'))
  try {
    const path = join(directory, 'brief.json')
    await writeFile(path, content)
    return await body(path)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Assert the canary is absent from both streams, and so is every prefix of it
 * down to eight characters. The prefixes matter because V8 quotes only the
 * first ten characters once the document is long enough: a test looking for
 * the whole canary would pass against a message still leaking `AKIAIOSFOD`.
 */
function assertNoCanary(result, label) {
  for (let length = CANARY.length; length >= 8; length -= 1) {
    const prefix = CANARY.slice(0, length)
    assert.equal(result.stdout.includes(prefix), false, `${label}: stdout carries ${prefix}`)
    assert.equal(result.stderr.includes(prefix), false, `${label}: stderr carries ${prefix}`)
  }
}

test('a brief that is nothing but a credential is not echoed into the JSON report', async () => {
  await withBrief(CANARY, (path) => {
    const result = run([path, '--json'])
    const report = JSON.parse(result.stdout)

    assert.equal(result.status, 2)
    assert.equal(report.status, 'incomplete')
    assert.equal(report.findings[0].ruleId, 'brief-unreadable')
    assertNoCanary(result, 'json report')
  })
})

test('nor into the human summary', async () => {
  await withBrief(CANARY, (path) => {
    const result = run([path])

    assert.equal(result.status, 2)
    assert.match(result.stdout, /not valid JSON/)
    assertNoCanary(result, 'human summary')
  })
})

test('a credential inside a longer brief is not echoed either', async () => {
  await withBrief(`{"schemaVersion": "1", "title": ${CANARY}}`, (path) => {
    const result = run([path, '--json'])

    assert.equal(result.status, 2)
    assertNoCanary(result, 'embedded in a brief')
  })
})

test('the position, line and column survive -- a diagnostic that says nothing is a different defect', async () => {
  await withBrief('{"schemaVersion": "1" "title": "Launch"}', (path) => {
    const report = JSON.parse(run([path, '--json']).stdout)

    assert.equal(report.findings[0].ruleId, 'brief-unreadable')
    assert.match(report.findings[0].message, /at position \d+ \(line \d+ column \d+\)/)
  })
})

test('a filesystem failure still says what went wrong', () => {
  const report = JSON.parse(run(['examples/does-not-exist.json', '--json']).stdout)

  assert.equal(report.findings[0].ruleId, 'brief-unreadable')
  assert.match(report.findings[0].message, /Could not read brief: ENOENT/)
})

test('parseFailureDetail keeps the offset and drops the quoted document', () => {
  const detailFor = (text) => {
    try {
      JSON.parse(text)
    } catch (error) {
      return parseFailureDetail(error)
    }
    throw new Error('the fixture parsed, so it pins nothing')
  }

  assert.equal(detailFor(CANARY), "unexpected token 'A' at the start of the document")
  assert.equal(detailFor('ssn 123-45-6789'), "unexpected token 's' at the start of the document")
  assert.equal(detailFor('password=hunter2-correct-horse'), "unexpected token 'p' at the start of the document")
  assert.equal(detailFor(`{"a": 1, "b": ${CANARY}}`), "unexpected token 'A' inside the document")
  assert.equal(detailFor(''), 'Unexpected end of JSON input')
  assert.equal(detailFor('{"a": 1 "b": 2}'), "Expected ',' or '}' after property value in JSON at position 8 (line 1 column 9)")
  assert.equal(detailFor('{"a": 1} trailing'), 'Unexpected non-whitespace character after JSON at position 9 (line 1 column 10)')
})

test('parseFailureDetail refuses a wording it was not taught rather than guessing', () => {
  assert.equal(
    parseFailureDetail(new Error('Unexpected token \'A\', "AKIAIOSFODNN7EXAMPLE" is not valid JSON at position 0')),
    'the document could not be parsed as JSON',
    'a double quote surviving to the end means the snippet survived with it',
  )
  assert.equal(parseFailureDetail(undefined), 'the document could not be parsed as JSON')
})

/**
 * The order the two V8 spellings are recognised in is what keeps the rest true.
 *
 * `parseFailureDetail` looks for the quoting shape BEFORE it looks for the
 * offset, and the difference is not cosmetic: a brief whose own text reads `at
 * position 1` is quoted back by V8 as `Unexpected token 'a', "at position 1"
 * is not valid JSON`, so an offset-first search finds that phrase inside the
 * quoted span and the slice hands the brief straight back out. Nineteen tools
 * in this catalog shipped that ordering. These tests fail if this one adopts
 * it.
 */

const UNPARSEABLE = 'the document could not be parsed as JSON'

/** The detail for a document V8 actually refused -- never a hand-written message. */
function detailOf(document) {
  try {
    JSON.parse(document)
  } catch (error) {
    return parseFailureDetail(error)
  }
  throw new Error(`${JSON.stringify(document)} parsed, so it pins nothing`)
}

/** No run of four characters or more from the document survives into the detail. */
function assertNoRunOf(document, detail, label) {
  for (let length = 4; length <= document.length; length += 1) {
    const prefix = document.slice(0, length)
    assert.equal(detail.includes(prefix), false, `${label}: the detail carries ${JSON.stringify(prefix)}`)
  }
}

test('a brief whose own text reads "at position 1" is not sliced back out', () => {
  const document = 'at position 1'
  const detail = detailOf(document)

  assert.equal(detail.includes('"'), false, 'a double quote in the detail means a quoted span survived')
  assert.equal(detail.includes(document), false, 'the brief came back inside its own diagnostic')
  assert.equal(detail, "unexpected token 'a' at the start of the document")
})

test('a long brief is not quoted back by any run of its sensitive opening', () => {
  const document = `${CANARY} and a great deal of trailing content nobody should read back`
  const detail = detailOf(document)

  assertNoRunOf(document, detail, 'long brief')
  assert.equal(detail, "unexpected token 'A' at the start of the document")
})

test('a quoted span holding a newline is still recognised as a quoted span', () => {
  // Without the `s` flag the quoting shape does not match a span with a line
  // break in it, the offset branch is reached, and the generic sentence is all
  // that is left -- or worse, the span is sliced out.
  const detail = detailOf('}x\n')

  assert.equal(detail, "unexpected token '}' at the start of the document")
  assert.notEqual(detail, UNPARSEABLE, 'the newline case fell through to the generic sentence')
})

test('the safe positional spelling keeps its position, line and column', () => {
  // A helper that answered the generic sentence for everything would pass every
  // leak test above while destroying every diagnostic. This is the other half.
  const detail = detailOf('{"schemaVersion": "1" "title": "Launch"}')

  assert.match(detail, /at position \d+ \(line \d+ column \d+\)$/)
  assert.equal(detail, "Expected ',' or '}' after property value in JSON at position 22 (line 1 column 23)")
})
