# Jukebox AI: material review and recorded replay foundation

This package is independent of the legacy room engine. It does not expose an HTTP route, change a game rule, send a model request or add a public review page.

## Material records

`lib/jukebox-ai/assets.ts` creates records for the 65 card IDs and 30 music IDs in `lib/catalog.json`. Existing paths, dimensions, excerpt notes and catalog metadata are retained. All baseline descriptions start `unreviewed` at revision `"0"`.

Only cards 001 and 024 contain small visual-observation seeds, based on inspected source images. These also require human review. The seeds do not establish sadness, moonlight or knocking. All other cards and all music start with empty semantic descriptions. Track titles and composers are metadata, not a description of what the actual excerpt sounds like.

Public API:

- `createAssetRecords()` returns fresh baseline records.
- `getAssetRecord(kind, id)` returns a baseline record or `undefined` for an unknown ID.
- `applyAssetPatch(record, patch, actor)` applies a validated review to a copy. It requires `expectedRevision` and returns the next revision.
- `toAssetReading(record)` produces the engine's semantic input, excluding titles and other metadata.
- `assetNeedsReview(record)` remains true for unreviewed, disputed or empty readings.

Facts and interpretations are separate arrays. A model may draft both arrays so batch description does not require manual approval of every asset before experimentation. Its descriptions always remain `unreviewed` with `descriptionSource: "model-proposal"`; a proposed fact is not a guarantee of truth. The model cannot approve itself. A trusted human reviewer must explicitly set `confirmObservedFacts: true` when editing facts or marking the description reviewed. The server integration must assign `actor.kind`; never accept a client-selected human-review identity as authorization. This contract prevents automatic certification of model proposals but does not claim to algorithmically detect every subjective sentence. The human reviewer remains responsible for that distinction.

Changing descriptions without explicitly reviewing them resets their status to `unreviewed`. `disputed` is preserved as a first-class review state rather than replacing disagreement with a single supposedly correct answer. Stable IDs and media paths cannot be changed through review patches.

## Private SQLite repository

`AiAuditRepository` in `lib/jukebox-ai/audit.ts` accepts a caller-owned `DatabaseSync` or an absolute SQLite file path (`:memory:` is also supported). It owns only two prefixed tables, `jukebox_ai_assets` and `jukebox_ai_events`, and does not read the game's `rooms` table. `close()` closes only a database created by the repository itself.

Material methods: `seedAssets()`, `getAsset(kind, id)`, `listAssets(kind?)`, `patchAsset(kind, id, patch, actor)`, and `exportAssetsJson()`. Seeding inserts missing baseline records and never overwrites review work. Review writes use revision compare-and-swap. Export retains stable IDs, revisions, statuses and notes alongside media and descriptions.

Audit methods:

- `append(event, timings?)`: records supplied model messages, response schema, parsed result, model and prompt/persona versions, round and bot IDs, elapsed time and optional first-text, transcription and speech-start times. Ordinary text is preserved exactly. Credential-like strings inside free text are replaced with `[REDACTED_CREDENTIAL]`, and the recording is explicitly marked `redacted`. Repeating the same event ID and original content is idempotent; different original content with that ID is rejected even when both inputs would produce the same redacted text.
- `get(id)` and `listRound(roundId, botId?)`: retrieve recorded results in insertion order.
- `reviewEvent(id, {expectedRevision, tags, note}, reviewerId)`: changes a review without changing the original event. Conflicting revisions are rejected.
- `exportRoundJson(roundId)`: exports a versioned JSON replay containing saved outputs and reviewer notes. It never reruns a model.

Tags include fits-persona, invented-detail, ignored-player, repetitive, information-leak and other. `digest` identifies the stored event and timing payload. `originalDigest` hashes the canonical original event/timing input before redaction; the original credential-like text is never saved. `redactions` includes the number of replacements and their JSON-pointer paths, and `recording` is `exact` or `redacted`. A redacted replay must never be presented as the exact original text. Review notes use the same redaction behavior and carry their own redaction metadata when needed. Existing databases are migrated with zero redactions for recordings accepted by the previous strict-rejection version.

The digests are integrity aids, not a statement that model self-explanations reveal hidden reasoning. The caller must provide actual inputs and results; this layer does not manufacture explanations or semantic scores. A replay contains the saved outputs, including any explicit redaction markers, rather than regenerated text.

The audit envelope and model request are allowlisted. Transport settings, authorization fields and common structured credential keys are rejected. Credential-like bearer/API-key strings in free text are redacted instead of failing a valid game action merely because a player quoted one. Server identifiers cannot contain such strings. Never pass SDK clients, HTTP headers, environment variables or provider configuration into these records. Arbitrary secret strings cannot reliably be recognized; keeping transport credentials outside the contract remains essential.

The module imports Node SQLite and is server-only infrastructure. It must not enter a Client Component import tree. Any future developer UI must have server-side authorization, and normal room responses must exclude the audit store, private hands and model input records. A hidden UI button or query parameter is not access control.

## Validation

Run `node tests/ai-assets-audit.test.mjs`. The scenarios cover all asset paths, empty music descriptions, human/model review separation, ambiguity and stale updates, immutable and idempotent events, structured credential rejection, free-text redaction without interrupting an action, original-input collision detection, recorded-result export, SQLite reopen persistence, previous-schema migration and caller-owned database lifetime.

These tests validate the foundation. They do not claim that the current website's rule set is the latest, that model-generated judgments are balanced, or that a protected visual review interface is already connected.
