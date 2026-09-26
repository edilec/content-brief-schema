# Content Brief Schema

Validate structured content briefs before an article or landing page enters
production.

- **Repository:** [edilec/content-brief-schema](https://github.com/edilec/content-brief-schema)
- **Area:** Content & Publishing
- **License:** MIT

## Why it exists

A brief is the contract agreed before anyone writes: who the piece is for, what
it is trying to do, what evidence backs its claims, how it is laid out, who owns
it, and when it must be reviewed. Discovering halfway through a draft that
nobody agreed what the piece was supposed to prove is expensive; discovering it
after publication is worse.

This tool checks that contract as data, with an exact field path for every
problem, so a brief can be validated in review or in CI.

## Requirements

- Node.js 22 or newer
- no runtime dependencies

## Quick start

```sh
node bin/content-brief-schema.mjs examples/minimal-brief.json
node bin/content-brief-schema.mjs examples/invalid-brief.json --json
```

The invalid example reports every problem with its JSON Pointer:

```text
ERROR   examples/invalid-brief.json /evidence Expected at least 1 item; found 0.
ERROR   examples/invalid-brief.json /id Value must be a lowercase hyphenated slug.
ERROR   examples/invalid-brief.json /intent Value must be one of: informational, comparison, implementation, commercial.
ERROR   examples/invalid-brief.json /owner/contact Value must be an email address.
ERROR   examples/invalid-brief.json /review/requiredBy Value is not a real calendar date.
ERROR   examples/invalid-brief.json /structure/0/purpose Required property "purpose" is missing.
WARNING examples/invalid-brief.json /unexpectedField Property "unexpectedField" is not part of the brief schema.
```

## The schema

`schemaVersion` is `"1"`. A brief requires `id`, `title`, `audience`, `intent`,
`evidence`, `structure`, `owner`, and `review`.

| Field | Shape | Notes |
| --- | --- | --- |
| `id` | lowercase hyphenated slug | stable identity for the brief |
| `title` | string | up to 200 characters |
| `summary` | string | optional |
| `audience.primary` | string | required |
| `audience.secondary` | string[] | optional |
| `audience.expertise` | `novice`, `practitioner`, `expert` | optional |
| `intent` | `informational`, `comparison`, `implementation`, `commercial` | required |
| `evidence[]` | `{ claim, sourceType, source, url?, retrievedAt? }` | at least one entry |
| `evidence[].sourceType` | `internal-data`, `public-document`, `interview`, `measurement` | required |
| `structure[]` | `{ heading, purpose, mustCover? }` | at least one section |
| `owner` | `{ name, contact, role? }` | `contact` must be an email address |
| `review` | `{ status, requiredBy, reviewers }` | at least one reviewer |
| `review.status` | `draft`, `in-review`, `approved` | required |
| `nonGoals`, `keywords` | string[] | optional |

[`examples/minimal-brief.json`](./examples/minimal-brief.json) contains only the
required fields. [`examples/extended-brief.json`](./examples/extended-brief.json)
uses every optional field.

Full field rules, limits and rule IDs are in
[`docs/schema.md`](./docs/schema.md).

## Library usage

```js
import { validateBrief, createReport } from 'content-brief-schema'

const { valid, findings } = validateBrief(brief)
const report = createReport([{ file: 'brief.json', brief }])
```

## Report

`--json` emits the report on stdout; diagnostics go to stderr, so the output can
be piped straight into a JSON parser. Findings are sorted by file, then pointer,
then rule, so repeated runs over the same input are byte-identical.

```json
{
  "schemaVersion": "1",
  "tool": "content-brief-schema",
  "status": "fail",
  "summary": { "checked": 1, "errors": 8, "warnings": 1, "unreadable": 0 },
  "findings": [
    {
      "ruleId": "required-missing",
      "severity": "error",
      "message": "Required property \"purpose\" is missing.",
      "location": { "file": "brief.json", "pointer": "/structure/0/purpose" }
    }
  ]
}
```

`status` is `incomplete` when a brief could not be read or parsed. An unreadable
brief is never reported as a passing brief.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | every brief satisfied the schema |
| `1` | at least one brief failed the schema |
| `2` | invalid usage, or a brief could not be read or parsed |

## Limits and non-goals

- One brief is capped at 1 MiB.
- Unknown properties are warnings, not errors, so a team can carry extra local
  fields without failing the check. They are still reported.
- The tool validates structure, not judgement. It cannot tell you whether a
  claim is true, whether the evidence actually supports it, whether the audience
  is the right one, or whether the piece is worth writing.
- It reads local files only. It never fetches a `url` in an evidence entry, so a
  recorded URL is checked for shape, not reachability.
- Passing this check is not editorial approval.

## Development

```sh
npm test          # behaviour tests
npm run check     # lint, tests, runnable example, packaging check
```

## License

MIT. See [LICENSE](./LICENSE).
