# Brief schema reference

`schemaVersion` is `"1"`. A brief whose `schemaVersion` is anything else is
rejected rather than validated against rules it was not written for.

## Rule IDs

Rule IDs are stable. Renaming one is a breaking change and is recorded in the
changelog.

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `type-mismatch` | error | The value is the wrong JSON type for this field. |
| `required-missing` | error | A required property is absent. Reported at the property's own pointer, not its parent. |
| `property-unknown` | warning | The property is not part of the schema. |
| `string-untrimmed` | error | The value has leading or trailing whitespace. |
| `string-too-short` | error | The value is shorter than the field's minimum. |
| `string-too-long` | error | The value is longer than the field's maximum. |
| `array-too-short` | error | The array has fewer entries than the field requires. |
| `array-too-long` | error | The array has more entries than the field allows. |
| `value-not-allowed` | error | The value is outside the field's enumerated set. The message lists the set. |
| `value-malformed` | error | The value does not match the field's format. |
| `brief-unreadable` | error | The document could not be read or parsed. Makes the report `incomplete`. |

## Ordering of checks

Within one string field the checks run in a fixed order and stop at the first
failure, so a field reports one reason rather than a pile of consequences:

1. trimmed
2. minimum length
3. maximum length
4. enumerated set
5. pattern
6. format (`http-url`)
7. semantic check (for example, whether a date that matches `YYYY-MM-DD` is a
   real calendar date)

`2026-02-30` matches the date pattern and still fails, because step 7 asks the
calendar. `01/10/2026` fails at step 5, before the calendar is consulted.

An array that exceeds its maximum is reported once and its members are not
walked, so a pasted 10,000-entry list produces one finding rather than 10,000.

## Limits

| Limit | Value |
| --- | --- |
| Brief document | 1 MiB |
| `evidence` entries | 100 |
| `structure` sections | 50 |
| `mustCover` per section | 20 |
| `reviewers` | 10 |
| `nonGoals` | 20 |
| `keywords` | 30 |

## Pointers

Locations are JSON Pointers relative to the brief root. Array indices appear as
path segments (`/evidence/1/source`). Segments containing `/` or `~` are escaped
as `~1` and `~0`.

## Determinism

Findings are sorted by pointer, then rule ID, then message. The report sorts by
file first. The same input always produces byte-identical output; nothing in the
validator depends on the clock, the locale, or object insertion order.
