# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Added

- the versioned Edilec content brief schema, covering audience, intent,
  evidence, structure, owner and review fields;
- `validateBrief` and `createReport`, producing findings with an exact JSON
  Pointer for every problem;
- a CLI accepting one or more briefs, with `--json` for the machine-readable
  report and exit codes 0 / 1 / 2;
- runnable minimal, extended and invalid examples;
- the rule catalog and limits in `docs/schema.md`.

### Fixed

- `brief-unreadable` no longer republishes the brief it could not parse. V8
  reports a parse failure two ways, and one of them quotes the input back --
  `Unexpected token 'A', "AKIAIOSFODNN7EXAMPLE" is not valid JSON` -- which
  reproduces the first ten characters of the file, or the whole file when it is
  shorter than that. The CLI interpolated that message whole, so a brief short
  enough to be nothing but a credential was printed in full into the JSON
  report on stdout and into the human summary. `parseFailureDetail` in
  `src/index.mjs` now keeps the offset, line and column and drops the quoted
  half, and the filesystem failure is caught separately so it keeps saying
  which syscall failed. `test/parse-failure.test.mjs` plants the canary through
  the real binary and asserts it is absent from stdout, from stderr and from
  every prefix of it down to eight characters, because V8 quotes only ten.

No release has been published.
