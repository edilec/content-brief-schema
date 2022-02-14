/**
 * The Edilec content brief schema, expressed as data.
 *
 * A brief is the contract agreed before an article or landing page is written:
 * who it is for, what it is trying to do, what evidence backs it, how it is
 * laid out, who owns it, and when it must be reviewed. Validating that contract
 * up front is cheaper than discovering halfway through a draft that nobody
 * agreed what the piece was supposed to prove.
 *
 * The schema is a small declarative structure rather than a JSON Schema
 * document, because the shape is fixed and owned here. That keeps the package
 * dependency-free and lets every diagnostic carry an exact JSON Pointer.
 */

export const BRIEF_SCHEMA_VERSION = '1'

export const INTENTS = Object.freeze([
  'informational',
  'comparison',
  'implementation',
  'commercial',
])

export const EXPERTISE_LEVELS = Object.freeze(['novice', 'practitioner', 'expert'])

export const SOURCE_TYPES = Object.freeze([
  'internal-data',
  'public-document',
  'interview',
  'measurement',
])

export const REVIEW_STATUSES = Object.freeze(['draft', 'in-review', 'approved'])

const isoDate = {
  type: 'string',
  pattern: /^\d{4}-\d{2}-\d{2}$/,
  patternDescription: 'an ISO date of the form YYYY-MM-DD',
  check: (value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
      ? 'is not a real calendar date'
      : null
  },
}

const contact = {
  type: 'string',
  minLength: 3,
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  patternDescription: 'an email address',
}

const nonEmptyString = { type: 'string', minLength: 1, trimmed: true }

export const BRIEF_SCHEMA = Object.freeze({
  type: 'object',
  required: ['schemaVersion', 'id', 'title', 'audience', 'intent', 'evidence', 'structure', 'owner', 'review'],
  properties: {
    schemaVersion: { type: 'string', enum: [BRIEF_SCHEMA_VERSION] },
    id: {
      type: 'string',
      pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      patternDescription: 'a lowercase hyphenated slug',
      maxLength: 128,
    },
    title: { ...nonEmptyString, maxLength: 200 },
    summary: { ...nonEmptyString, maxLength: 1000 },
    audience: {
      type: 'object',
      required: ['primary'],
      properties: {
        primary: { ...nonEmptyString, maxLength: 200 },
        secondary: { type: 'array', items: { ...nonEmptyString, maxLength: 200 }, maxItems: 10 },
        expertise: { type: 'string', enum: EXPERTISE_LEVELS },
      },
    },
    intent: { type: 'string', enum: INTENTS },
    evidence: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        required: ['claim', 'sourceType', 'source'],
        properties: {
          claim: { ...nonEmptyString, maxLength: 500 },
          sourceType: { type: 'string', enum: SOURCE_TYPES },
          source: { ...nonEmptyString, maxLength: 500 },
          url: { type: 'string', format: 'http-url', maxLength: 2000 },
          retrievedAt: isoDate,
        },
      },
    },
    structure: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        required: ['heading', 'purpose'],
        properties: {
          heading: { ...nonEmptyString, maxLength: 200 },
          purpose: { ...nonEmptyString, maxLength: 500 },
          mustCover: { type: 'array', items: { ...nonEmptyString, maxLength: 300 }, maxItems: 20 },
        },
      },
    },
    owner: {
      type: 'object',
      required: ['name', 'contact'],
      properties: {
        name: { ...nonEmptyString, maxLength: 120 },
        contact,
        role: { ...nonEmptyString, maxLength: 120 },
      },
    },
    review: {
      type: 'object',
      required: ['status', 'requiredBy', 'reviewers'],
      properties: {
        status: { type: 'string', enum: REVIEW_STATUSES },
        requiredBy: isoDate,
        reviewers: { type: 'array', minItems: 1, maxItems: 10, items: contact },
      },
    },
    nonGoals: { type: 'array', items: { ...nonEmptyString, maxLength: 300 }, maxItems: 20 },
    keywords: { type: 'array', items: { ...nonEmptyString, maxLength: 100 }, maxItems: 30 },
  },
})
