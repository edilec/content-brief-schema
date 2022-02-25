#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import { MAX_BRIEF_BYTES, createReport, formatReport, parseFailureDetail } from '../src/index.mjs'

const HELP = `content-brief-schema

Validate structured content briefs against the versioned Edilec brief schema.

Usage:
  content-brief-schema <BRIEF.json> [<BRIEF.json> ...] [--json]

Options:
  --json        Emit the machine-readable report on stdout instead of a summary
  -h, --help    Show this help

Exit codes:
  0  every brief satisfied the schema
  1  at least one brief failed the schema
  2  invalid usage, or a brief could not be read or parsed
`

function parseArguments(argv) {
  const files = []
  let json = false

  for (const argument of argv) {
    if (argument === '--json') json = true
    else if (argument === '-h' || argument === '--help') return { help: true }
    else if (argument.startsWith('-')) throw new Error(`Unknown option "${argument}"`)
    else files.push(argument)
  }

  if (files.length === 0) throw new Error('Provide at least one brief file')
  return { files, json, help: false }
}

/**
 * The two failures are caught separately on purpose. A filesystem error
 * describes the caller's own argument, but a parse error describes the file's
 * contents -- V8 quotes the input back in one of its two message shapes -- and
 * that must not reach a report. `parseFailureDetail` keeps the offset and
 * drops the quoted half.
 */
async function readBrief(file) {
  const path = resolve(file)
  const display = relative(process.cwd(), path) || file
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    return { file: display, error: `Could not read brief: ${error.message}` }
  }
  if (Buffer.byteLength(raw) > MAX_BRIEF_BYTES) {
    return { file: display, error: `Brief exceeds the ${MAX_BRIEF_BYTES} byte limit.` }
  }
  try {
    return { file: display, brief: JSON.parse(raw) }
  } catch (error) {
    return { file: display, error: `Brief is not valid JSON: ${parseFailureDetail(error)}.` }
  }
}

async function main(argv) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}`)
    return 2
  }

  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }

  const report = createReport(await Promise.all(options.files.map(readBrief)))

  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report))

  if (report.status === 'incomplete') return 2
  return report.status === 'fail' ? 1 : 0
}

process.exitCode = await main(process.argv.slice(2))
