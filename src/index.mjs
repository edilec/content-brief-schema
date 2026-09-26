import { BRIEF_SCHEMA, BRIEF_SCHEMA_VERSION } from './schema.mjs'

export {
  BRIEF_SCHEMA,
  BRIEF_SCHEMA_VERSION,
  EXPERTISE_LEVELS,
  INTENTS,
  REVIEW_STATUSES,
  SOURCE_TYPES,
} from './schema.mjs'

export const TOOL_ID = 'content-brief-schema'
export const REPORT_SCHEMA_VERSION = '1'

/** Maximum bytes accepted for one brief document. */
export const MAX_BRIEF_BYTES = 1024 * 1024

/**
 * Order by UTF-16 code unit, deliberately not by locale.
 *
 * `localeCompare` depends on ICU data that varies between Node builds and
 * platforms, so it would let the same brief produce differently ordered
 * findings on two correct machines. Report output has to be byte-identical for
 * the same input.
 */
function byCodeUnit(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Say what a JSON parse failure was, without reproducing the document.
 *
 * V8 reports a parse failure two ways, and one of them quotes the input back:
 * `Unexpected token 'A', "AKIAIOSFODNN7EXAMPLE" is not valid JSON`. The quoted
 * run is the first ten characters of the document, or the whole document when
 * it is shorter than that -- so a brief short enough to be nothing but a
 * credential is reproduced in full by its own error message, and interpolating
 * that message into `brief-unreadable` walks the secret onto stdout. Slicing
 * the message does not help either: the snippet is at the front of it.
 *
 * Position, line and column are the useful half and say nothing about content,
 * so they are kept whole. The quoted half never leaves this function. The
 * closing guard is deliberate belt and braces: every parse message V8 emits
 * without a snippet quotes JSON punctuation with apostrophes and holds no
 * double quote at all, so a double quote surviving to the end means a wording
 * this function has not been taught, and the generic sentence is used instead.
 */
export function parseFailureDetail(error) {
  const message = String(error?.message ?? '')
  const detail = describeParseFailure(message)
  return detail.includes('"') ? UNPARSEABLE : detail
}

const UNPARSEABLE = 'the document could not be parsed as JSON'

/** Where V8 puts the offending offset. Safe: an offset says nothing about content. */
const POSITION = /at position \d+(?: \(line \d+ column \d+\))?/

/**
 * The shape that quotes the input. A leading `...` means the quoted run came
 * from the middle of the document rather than its start, which is the only
 * thing about the position this shape reveals.
 */
const QUOTES_THE_INPUT = /^Unexpected token (.+?), (\.\.\.)?".*"(?:\.\.\.)? is not valid JSON$/s

function describeParseFailure(message) {
  const quoting = QUOTES_THE_INPUT.exec(message)
  if (quoting !== null) {
    const where = quoting[2] === undefined ? 'at the start of the document' : 'inside the document'
    return `unexpected token ${quoting[1]} ${where}`
  }
  const position = POSITION.exec(message)
  if (position !== null) return message.slice(0, position.index + position[0].length)
  if (message === 'Unexpected end of JSON input') return message
  return UNPARSEABLE
}

function pointerSegment(key) {
  return String(key).replace(/~/g, '~0').replace(/\//g, '~1')
}

function join(pointer, key) {
  return `${pointer}/${pointerSegment(key)}`
}

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function finding(ruleId, message, pointer, extra = {}) {
  return {
    ruleId,
    severity: 'error',
    message,
    location: { pointer },
    ...extra,
  }
}

function checkString(value, schema, pointer, findings) {
  if (schema.trimmed && value !== value.trim()) {
    findings.push(finding('string-untrimmed', 'Value has leading or trailing whitespace.', pointer))
    return
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    findings.push(finding(
      'string-too-short',
      `Value must be at least ${schema.minLength} character${schema.minLength === 1 ? '' : 's'} long.`,
      pointer,
    ))
    return
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    findings.push(finding(
      'string-too-long',
      `Value must be at most ${schema.maxLength} characters long; it is ${value.length}.`,
      pointer,
    ))
    return
  }
  if (schema.enum && !schema.enum.includes(value)) {
    findings.push(finding(
      'value-not-allowed',
      `Value must be one of: ${schema.enum.join(', ')}.`,
      pointer,
      { evidence: value.slice(0, 80) },
    ))
    return
  }
  if (schema.pattern && !schema.pattern.test(value)) {
    findings.push(finding(
      'value-malformed',
      `Value must be ${schema.patternDescription ?? 'in the documented format'}.`,
      pointer,
      { evidence: value.slice(0, 80) },
    ))
    return
  }
  if (schema.format === 'http-url') {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      findings.push(finding('value-malformed', 'Value must be an absolute URL.', pointer))
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      findings.push(finding('value-malformed', 'URL must use http or https.', pointer))
      return
    }
  }
  const problem = schema.check?.(value)
  if (problem) findings.push(finding('value-malformed', `Value ${problem}.`, pointer, { evidence: value.slice(0, 80) }))
}

function validateNode(value, schema, pointer, findings) {
  const actual = typeOf(value)

  if (schema.type === 'object') {
    if (actual !== 'object') {
      findings.push(finding('type-mismatch', `Expected an object; found ${actual}.`, pointer))
      return
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        findings.push(finding('required-missing', `Required property "${key}" is missing.`, join(pointer, key)))
      }
    }
    for (const key of Object.keys(value)) {
      const child = schema.properties?.[key]
      if (!child) {
        findings.push({
          ...finding('property-unknown', `Property "${key}" is not part of the brief schema.`, join(pointer, key)),
          severity: 'warning',
        })
        continue
      }
      if (value[key] === undefined) continue
      validateNode(value[key], child, join(pointer, key), findings)
    }
    return
  }

  if (schema.type === 'array') {
    if (actual !== 'array') {
      findings.push(finding('type-mismatch', `Expected an array; found ${actual}.`, pointer))
      return
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      findings.push(finding(
        'array-too-short',
        `Expected at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}; found ${value.length}.`,
        pointer,
      ))
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      findings.push(finding(
        'array-too-long',
        `Expected at most ${schema.maxItems} items; found ${value.length}.`,
        pointer,
      ))
      return
    }
    value.forEach((item, index) => validateNode(item, schema.items, join(pointer, index), findings))
    return
  }

  if (actual !== 'string') {
    findings.push(finding('type-mismatch', `Expected a string; found ${actual}.`, pointer))
    return
  }
  checkString(value, schema, pointer, findings)
}

function sortFindings(findings) {
  return findings.sort((left, right) =>
    byCodeUnit(left.location.pointer, right.location.pointer)
    || byCodeUnit(left.ruleId, right.ruleId)
    || byCodeUnit(left.message, right.message))
}

/**
 * Validate one content brief.
 *
 * @returns {{ findings: Array<object>, valid: boolean }}
 */
export function validateBrief(brief) {
  const findings = []
  validateNode(brief, BRIEF_SCHEMA, '', findings)
  sortFindings(findings)
  return { findings, valid: findings.every((item) => item.severity !== 'error') }
}

/**
 * Build the report for a set of briefs.
 *
 * `status` is `incomplete` when a document could not be read or parsed at all:
 * an unreadable brief is not a passing brief.
 */
export function createReport(entries) {
  const findings = []
  let unreadable = 0

  for (const entry of entries) {
    if (entry.error) {
      unreadable += 1
      findings.push({
        ruleId: 'brief-unreadable',
        severity: 'error',
        message: entry.error,
        location: { file: entry.file },
      })
      continue
    }
    for (const item of validateBrief(entry.brief).findings) {
      findings.push({ ...item, location: { file: entry.file, ...item.location } })
    }
  }

  findings.sort((left, right) =>
    byCodeUnit(String(left.location.file ?? ''), String(right.location.file ?? ''))
    || byCodeUnit(String(left.location.pointer ?? ''), String(right.location.pointer ?? ''))
    || byCodeUnit(left.ruleId, right.ruleId))

  const errors = findings.filter((item) => item.severity === 'error').length
  const warnings = findings.filter((item) => item.severity === 'warning').length

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: TOOL_ID,
    status: unreadable > 0 ? 'incomplete' : errors > 0 ? 'fail' : 'pass',
    summary: { checked: entries.length, errors, warnings, unreadable },
    findings,
  }
}

/** Render a report as human-readable lines for a terminal. */
export function formatReport(report) {
  const lines = []
  for (const item of report.findings) {
    const where = [item.location.file, item.location.pointer || '/'].filter(Boolean).join(' ')
    lines.push(`${item.severity.toUpperCase().padEnd(7)} ${where} ${item.message}`)
  }
  lines.push('')
  lines.push(
    `${report.summary.checked} brief(s): ${report.summary.errors} error, `
    + `${report.summary.warnings} warning, status ${report.status}.`,
  )
  if (report.summary.unreadable > 0) {
    lines.push(`${report.summary.unreadable} brief(s) could not be read; the result is incomplete, not a pass.`)
  }
  return `${lines.join('\n')}\n`
}
