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
    left.location.pointer.localeCompare(right.location.pointer)
    || left.ruleId.localeCompare(right.ruleId)
    || left.message.localeCompare(right.message))
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
    String(left.location.file ?? '').localeCompare(String(right.location.file ?? ''))
    || String(left.location.pointer ?? '').localeCompare(String(right.location.pointer ?? ''))
    || left.ruleId.localeCompare(right.ruleId))

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
