# Jukebox AI players — integration checkpoint

Status: portable server modules and tests, **not yet a playable or deployed AI room**.

## Source baseline

The checkout is based on `main` at `f049272e9294f435ca17b82e02d1a547d4e4850c`.
That source still uses Author / Spy / Listener. On 2026-11-06 the live
`jtmakegames.com/jukebox/` page and its public client assets instead showed
Improv with Audience / Improviser, assigned cards, a theatre map, skills and
automatic settlement. The latest source is in the owner's local Projects
directory, which is not mounted into this development workspace.

Do not deploy this old checkout over the current site. Move these modules to
the latest source, inspect its rules and implement the adapter there.

## Agreed product direction

- Add bots as participants in the same online rooms. One human plus bots is a
  normal online room, not a separate single-player ruleset.
- Preserve the current rules, skills, movement and settlement. Keep online
  and physical-table entry points.
- Use Beethoven, Debussy, Clara, Bach and Mozart as fictional characters.
- Perceptual preferences affect selection. Own perception generally has the
  greatest voting weight; public statements and others' known habits also
  matter. Default weights are 50 / 30 / 20, with documented persona variation.
- Initial explanations in turn, then open discussion. Voice input creates an
  editable draft; only confirmed text becomes public conversation.
- Text replies are the baseline. Add speech output only after measuring its
  cost and response delay.
- Review facts and behavior without assigning a single correct interpretation
  of a picture or piece of music.

## Implemented modules

- `types.ts`: engine-independent public/private observation contracts.
- `personas.ts`: five versioned character configurations.
- `perception.ts`: allowlisted role-blind hand assessment, weighted selection,
  and enforcement of the Improviser's assigned card.
- `judgment.ts`: public evidence projection, 50/30/20-style arithmetic,
  unknown human preferences and legal voting candidates.
- `prompts.ts`: bounded structured outputs, grounded discussion and validation.
- `coordinator.ts`: model generation outside transactions; an adapter must
  atomically claim and commit jobs. Stale generations never become moves.
- `provider.server.ts`: configurable JSON-schema Chat Completions transport,
  cancellation, bounded responses, redacted errors and no fake AI fallback.
- `transcription.server.ts`: bounded audio-to-editable-text adapter.
- `assets.ts`, `audit.ts`: versioned asset descriptions, private SQLite audit
  records and review annotations, and JSON export of saved events.

The modules do not import the old `Room` type. They are not wired into old room
HTTP endpoints. No secret-review page or unrestricted model endpoint exists.
The visual review console and room UI are pending integration into the latest
application. Tests use mock model responses, not paid or live AI calls.

## Integration requirements

1. Build `BotObservation` on the server from the bot's own authorized view and
   actual public conversation. Never send whole room state to the model.
2. Add bot seats through host-authorized room actions. Keep bots distinct from
   authenticatable human seats; do not issue arbitrary-seat client credentials.
3. Implement `BotRoomAdapter.claim` with a persisted lease and generation key.
   Include relevant round, phase, transcript and configuration versions; a
   heartbeat alone should not invalidate a task.
4. `commit` must atomically verify the lease, revalidate the legal move using
   the existing game engine, apply it once, and persist its audit. Do not wait
   for a provider inside a SQLite transaction. Late replies must be discarded.
5. Persist the proposal's private `selectionMemory` with the actual card move,
   and supply it on subsequent discussion snapshots. It is bound to the bot,
   round, selected card and asset versions; another participant never sees it.
   Cache role-blind card assessments before enforcing the assigned card. Use
   recorded configurations for replay. Do not re-generate text during replay.
6. Keep ordinary room projections free of other hands, hidden roles, judgments
   and audit events. The review console requires server-side developer access,
   not just a hidden button or URL parameter.
7. Persist confirmed human messages equally for typing and transcription.
   Do not use accent, typing speed or input method as evidence of identity.
8. Populate actual-excerpt audio descriptions and card observations. Empty
   descriptions intentionally fail before generation; track titles are not
   audio evidence. Model proposals remain unreviewed until human review.
9. Wire first-turn speaking order and limited bot responses to the current room
   flow. Multiplayer discussion-to-vote authority must follow the live rules.
10. Exercise complete mixed-human/bot rounds, reconnection, simultaneous joins,
    vote secrecy, skill use, map movement and duplicate requests on that engine.

## Service configuration

All configuration is server-side; never prefix credentials with NEXT_PUBLIC.

| Variable | Purpose |
| --- | --- |
| `JUKEBOX_AI_API_KEY` | Provider credential, required before enabling live bots |
| `JUKEBOX_AI_MODEL` | Explicit model supporting strict structured JSON |
| `JUKEBOX_AI_BASE_URL` | Compatible API root; default `https://api.openai.com/v1` |
| `JUKEBOX_TRANSCRIBE_MODEL` | Explicit audio transcription model |
| `JUKEBOX_AI_TIMEOUT_MS` | Request deadline; default 20000 |
| `JUKEBOX_AI_MAX_RESPONSE_BYTES` | Bounded response size; default 1048576 |
| `JUKEBOX_AI_MAX_OUTPUT_TOKENS` | Output token limit; default 1800 |

No provider key was available in this workspace. Real response quality,
availability and speech latency have not been measured. The adapter currently
uses factual text descriptions; direct image/audio analysis is a subsequent
provider-specific integration, not an implemented capability.

API reference checked for the transport:
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create

## Checks

Run `pnpm typecheck`, `pnpm test:ai`, and the existing `pnpm test` on Node
22.20.x, matching the repository engine. The AI suite covers information
isolation, actual weighted choices, assigned cards, unsupported model results,
public evidence, stale/duplicate/cancelled jobs, provider errors and audit
persistence. Passing it does not substitute for live-model or browser tests.
