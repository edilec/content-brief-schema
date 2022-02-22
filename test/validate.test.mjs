import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BRIEF_SCHEMA_VERSION,
  createReport,
  formatReport,
  validateBrief,
} from '../src/index.mjs'

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function example(name) {
  return JSON.parse(await readFile(resolve(projectDirectory, 'examples', name), 'utf8'))
}

function pointers(findings) {
  return findings.map((item) => item.location.pointer)
}

function rulesAt(findings, pointer) {
  return findings.filter((item) => item.location.pointer === pointer).map((item) => item.ruleId)
}

test('the minimal example is valid', async () => {
  const result = validateBrief(await example('minimal-brief.json'))

  assert.deepEqual(result.findings, [])
  assert.equal(result.valid, true)
})

test('the extended example is valid', async () => {
  const result = validateBrief(await example('extended-brief.json'))

  assert.deepEqual(result.findings, [])
  assert.equal(result.valid, true)
})

test('a missing evidence entry fails with its field path', async () => {
  const brief = await example('minimal-brief.json')
  brief.evidence = []

  const { findings, valid } = validateBrief(brief)

  assert.equal(valid, false)
  assert.ok(rulesAt(findings, '/evidence').includes('array-too-short'))
})

test('an omitted required property is reported at the property it belongs to', async () => {
  const brief = await example('minimal-brief.json')
  delete brief.evidence

  const { findings } = validateBrief(brief)

  assert.ok(rulesAt(findings, '/evidence').includes('required-missing'))
})

test('an invalid owner fails with field paths for each problem', async () => {
  const brief = await example('minimal-brief.json')
  brief.owner = { name: '  ', contact: 'not-an-email' }

  const { findings, valid } = validateBrief(brief)

  assert.equal(valid, false)
  assert.ok(pointers(findings).includes('/owner/name'))
  assert.ok(rulesAt(findings, '/owner/contact').includes('value-malformed'))
})

test('a missing owner property is located inside owner', async () => {
  const brief = await example('minimal-brief.json')
  brief.owner = { name: 'Someone' }

  assert.ok(rulesAt(validateBrief(brief).findings, '/owner/contact').includes('required-missing'))
})

test('nested array members carry their index in the pointer', async () => {
  const brief = await example('extended-brief.json')
  delete brief.evidence[1].source
  brief.structure[0].mustCover[1] = ''

  const { findings } = validateBrief(brief)

  assert.ok(rulesAt(findings, '/evidence/1/source').includes('required-missing'))
  assert.ok(rulesAt(findings, '/structure/0/mustCover/1').includes('string-too-short'))
})

test('enumerated fields list what is allowed', async () => {
  const brief = await example('minimal-brief.json')
  brief.intent = 'educational'

  const finding = validateBrief(brief).findings.find((item) => item.location.pointer === '/intent')

  assert.equal(finding.ruleId, 'value-not-allowed')
  assert.match(finding.message, /informational, comparison, implementation, commercial/)
})

test('a date that looks right but does not exist is rejected', async () => {
  const brief = await example('minimal-brief.json')
  brief.review.requiredBy = '2026-02-30'

  const finding = validateBrief(brief).findings.find((item) => item.location.pointer === '/review/requiredBy')

  assert.equal(finding.ruleId, 'value-malformed')
  assert.match(finding.message, /not a real calendar date/)
})

test('a malformed date shape is rejected before the calendar check', async () => {
  const brief = await example('minimal-brief.json')
  brief.review.requiredBy = '01/10/2026'

  const finding = validateBrief(brief).findings.find((item) => item.location.pointer === '/review/requiredBy')

  assert.match(finding.message, /YYYY-MM-DD/)
})

test('wrong types are reported as type mismatches, not crashes', async () => {
  const brief = await example('minimal-brief.json')
  brief.audience = 'engineers'
  brief.structure = { heading: 'not an array' }
  brief.keywords = [7]

  const { findings } = validateBrief(brief)

  assert.ok(rulesAt(findings, '/audience').includes('type-mismatch'))
  assert.ok(rulesAt(findings, '/structure').includes('type-mismatch'))
  assert.ok(rulesAt(findings, '/keywords/0').includes('type-mismatch'))
})

test('null is reported as null rather than object', () => {
  const finding = validateBrief(null).findings[0]

  assert.equal(finding.ruleId, 'type-mismatch')
  assert.match(finding.message, /found null/)
})

test('an unknown property is a warning, not an error', async () => {
  const brief = await example('minimal-brief.json')
  brief.unexpectedField = true

  const { findings, valid } = validateBrief(brief)
  const finding = findings.find((item) => item.location.pointer === '/unexpectedField')

  assert.equal(finding.severity, 'warning')
  assert.equal(valid, true)
})

test('a schemaVersion the tool does not implement is rejected', async () => {
  const brief = await example('minimal-brief.json')
  brief.schemaVersion = '2'

  assert.ok(rulesAt(validateBrief(brief).findings, '/schemaVersion').includes('value-not-allowed'))
  assert.equal(BRIEF_SCHEMA_VERSION, '1')
})

test('a URL that is not http(s) is rejected', async () => {
  const brief = await example('extended-brief.json')
  brief.evidence[1].url = 'javascript:alert(1)'

  assert.match(
    validateBrief(brief).findings.find((item) => item.location.pointer === '/evidence/1/url').message,
    /http or https/,
  )
})

test('pointer segments with slashes or tildes are escaped', () => {
  const brief = { 'a/b': 1, 'c~d': 2 }
  const found = pointers(validateBrief(brief).findings)

  assert.ok(found.includes('/a~1b'))
  assert.ok(found.includes('/c~0d'))
})

test('findings are deterministically ordered', async () => {
  const brief = await example('invalid-brief.json')

  assert.deepEqual(
    pointers(validateBrief(brief).findings),
    pointers(validateBrief(structuredClone(brief)).findings),
  )
  assert.deepEqual(pointers(validateBrief(brief).findings), [...pointers(validateBrief(brief).findings)].sort())
})

test('an unreadable brief makes the report incomplete, never a pass', () => {
  const report = createReport([{ file: 'gone.json', error: 'Could not read brief: ENOENT' }])

  assert.equal(report.status, 'incomplete')
  assert.equal(report.summary.unreadable, 1)
  assert.match(formatReport(report), /incomplete, not a pass/)
})

test('a clean set of briefs reports pass with the report envelope', async () => {
  const report = createReport([
    { file: 'a.json', brief: await example('minimal-brief.json') },
    { file: 'b.json', brief: await example('extended-brief.json') },
  ])

  assert.equal(report.schemaVersion, '1')
  assert.equal(report.tool, 'content-brief-schema')
  assert.equal(report.status, 'pass')
  assert.deepEqual(report.summary, { checked: 2, errors: 0, warnings: 0, unreadable: 0 })
  assert.deepEqual(report.findings, [])
})

test('report findings carry both the file and the pointer', async () => {
  const brief = await example('minimal-brief.json')
  delete brief.owner

  const report = createReport([{ file: 'b.json', brief }])

  assert.equal(report.status, 'fail')
  assert.equal(report.findings[0].location.file, 'b.json')
  assert.equal(report.findings[0].location.pointer, '/owner')
})

test('an over-long string is rejected with its actual length', async () => {
  const brief = await example('minimal-brief.json')
  brief.title = 'x'.repeat(201)

  const finding = validateBrief(brief).findings.find((item) => item.location.pointer === '/title')

  assert.equal(finding.ruleId, 'string-too-long')
  assert.match(finding.message, /at most 200 characters long; it is 201/)
})

test('an over-long array is rejected without checking every member', async () => {
  const brief = await example('minimal-brief.json')
  brief.keywords = Array.from({ length: 31 }, (_, index) => `k${index}`)

  const { findings } = validateBrief(brief)
  const atKeywords = findings.filter((item) => item.location.pointer === '/keywords')

  assert.deepEqual(atKeywords.map((item) => item.ruleId), ['array-too-long'])
  assert.equal(findings.some((item) => item.location.pointer.startsWith('/keywords/')), false)
})

test('untrimmed strings are reported before length rules', async () => {
  const brief = await example('minimal-brief.json')
  brief.title = '  Padded title  '

  const finding = validateBrief(brief).findings.find((item) => item.location.pointer === '/title')

  assert.equal(finding.ruleId, 'string-untrimmed')
})
