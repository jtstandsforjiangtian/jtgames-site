import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const temp = mkdtempSync(join(tmpdir(), 'jukebox-ai-decision-'));
writeFileSync(join(temp, 'package.json'), '{"type":"commonjs"}');
for (const name of ['types', 'personas', 'perception', 'judgment']) {
  const source = readFileSync(new URL(`../lib/jukebox-ai/${name}.ts`, import.meta.url), 'utf8');
  writeFileSync(join(temp, `${name}.js`), ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
}
const require = createRequire(import.meta.url);
const { DIMENSIONS } = require(join(temp, 'types.js'));
const { PERSONAS, getPersona } = require(join(temp, 'personas.js'));
const { projectHandAssessment, validateCardEvaluations, rankHand, chooseCard } = require(join(temp, 'perception.js'));
const { projectJudgment, publicEvidenceIds, validateCandidateJudgments, rankJudgments, chooseVote } = require(join(temp, 'judgment.js'));
let count = 0;
function test(name, fn) { fn(); count++; process.stdout.write(`PASS ${name}\n`); }
const clone = value => structuredClone(value);
const asset = (id, kind = 'card') => ({ id, kind, revision: 'r1', facts: [`Visible details of ${id}`], interpretations: ['One possible reading'], reviewStatus: 'reviewed' });
function observation() {
  return {
    roundId: 'round-1', phase: 'selecting', language: 'en',
    music: asset('clip-1', 'music'),
    self: { id: 'self', personaId: 'beethoven', role: 'audience' },
    hand: [asset('still'), asset('horse')],
    players: [{ id: 'self', name: 'Beethoven', personaId: 'beethoven', cardId: 'still' }, { id: 'human', name: 'You', cardId: 'human-card' }, { id: 'clara', name: 'Clara', personaId: 'clara', cardId: 'clara-card' }],
    revealedCards: [asset('still'), asset('human-card'), asset('clara-card')],
    transcript: [{ id: 'm1', playerId: 'human', text: 'I noticed the space and freedom, not speed.' }],
  };
}
function evaluations() {
  return [
    { cardId: 'still', alignment: { emotion: .95, tension: .9, motion: .1, energy: .4, texture: .3, space: .3, narrative: .3, structure: .3 }, evidence: ['Stillness can coexist with inner tension.'] },
    { cardId: 'horse', alignment: { emotion: .5, tension: .2, motion: .95, energy: .85, texture: .4, space: .3, narrative: .2, structure: .2 }, evidence: ['The visible movement supports a brisk physical reading.'] },
  ];
}
function judgmentInput() { const o = observation(); o.phase = 'voting'; return projectJudgment(o); }
function judgments() {
  return [
    { playerId: 'human', selfMismatch: .8, statementConcern: .2, habitMismatch: null, evidenceIds: ['music:clip-1', 'card:human-card', 'message:m1'], summary: 'A plausible feeling, though unlike my first impression.' },
    { playerId: 'clara', selfMismatch: .4, statementConcern: .6, habitMismatch: .9, evidenceIds: ['card:clara-card'], summary: 'Her explanation does not develop her usual interest in relationships.' },
  ];
}

try {
  test('five distinct fictional characters have normalized attention and judging weights', () => {
    assert.equal(Object.keys(PERSONAS).length, 5);
    for (const p of Object.values(PERSONAS)) {
      assert.ok(Math.abs(DIMENSIONS.reduce((sum, key) => sum + p.attention[key], 0) - 1) < 1e-9);
      assert.ok(Math.abs(Object.values(p.judging).reduce((a, b) => a + b, 0) - 1) < 1e-9);
      assert.ok(p.judging.self > p.judging.statement && p.judging.self > p.judging.habit);
      assert.ok(DIMENSIONS.every(key => Number.isFinite(p.attention[key]) && p.attention[key] >= 0));
    }
    const p = getPersona('beethoven'); p.attention.emotion = 0; p.name.en = 'changed';
    assert.notEqual(getPersona('beethoven').attention.emotion, 0);
    assert.equal(getPersona('beethoven').name.en, 'Beethoven');
    assert.throws(() => getPersona('__proto__'));
  });
  test('hand assessment is identical after a hidden-role or assigned-card swap', () => {
    const audience = observation();
    const improviser = clone(audience); improviser.self.role = 'improviser'; improviser.assignedCardId = 'horse'; improviser.selectedCardId = 'horse';
    assert.deepEqual(projectHandAssessment(audience), projectHandAssessment(improviser));
  });
  test('assessment recursively projects fields and retains no aliases or extra secrets', () => {
    const o = observation(); o.secretIdentity = 'SECRET'; o.self.token = 'SECRET';
    o.hand[0].hiddenScore = 'SECRET'; o.music.trueRole = 'SECRET'; o.transcript[0].privateNotes = 'SECRET';
    const input = projectHandAssessment(o);
    assert.ok(!JSON.stringify(input).includes('SECRET'));
    assert.ok(!('self' in input) && !('transcript' in input));
    input.hand[0].facts.push('edited'); assert.equal(o.hand[0].facts.length, 1);
  });
  test('persona attention changes actual card choice without changing the evaluated evidence', () => {
    const o = observation();
    assert.equal(chooseCard(o, evaluations()).cardId, 'still');
    o.self.personaId = 'mozart';
    assert.equal(chooseCard(o, evaluations()).cardId, 'horse');
    assert.deepEqual(rankHand(projectHandAssessment(o), { evaluations: evaluations() }), rankHand(projectHandAssessment(o), evaluations().reverse()));
  });
  test('Improviser must play the assigned legal card even when its score is worse', () => {
    const o = observation(); const input = projectHandAssessment(o);
    assert.equal(rankHand(input, evaluations())[0].cardId, 'still');
    o.self.role = 'improviser'; o.assignedCardId = 'horse';
    const choice = chooseCard(o, evaluations());
    assert.equal(choice.cardId, 'horse'); assert.equal(choice.forced, true);
    assert.ok(choice.alignment < rankHand(input, evaluations())[0].score);
    o.assignedCardId = 'not-in-hand'; assert.throws(() => chooseCard(o, evaluations()));
    delete o.assignedCardId; assert.throws(() => chooseCard(o, evaluations()));
  });
  test('every hand card is scored once; invalid, missing, duplicate or extra actions are rejected', () => {
    const input = projectHandAssessment(observation());
    assert.throws(() => validateCardEvaluations(evaluations().slice(0, 1), input));
    const mutations = [
      e => { e[1].cardId = e[0].cardId; }, e => { e[1].cardId = 'unknown'; },
      e => { delete e[0].alignment.motion; }, e => { e[0].alignment.secret = 1; },
      e => { e[0].voteFor = 'human'; }, e => { e[0].evidence = []; },
      e => { e[0].evidence = ['x'.repeat(501)]; },
    ];
    for (const mutate of mutations) { const e = evaluations(); mutate(e); assert.throws(() => validateCardEvaluations(e, input)); }
    for (const invalid of [NaN, Infinity, -0.1, 1.1, '0.5']) {
      const e = evaluations(); e[0].alignment.emotion = invalid; assert.throws(() => validateCardEvaluations(e, input));
    }
    assert.throws(() => validateCardEvaluations({ evaluations: evaluations(), action: 'vote' }, input));
    const o = observation(); o.phase = 'discussion'; assert.throws(() => chooseCard(o, evaluations()));
    o.hand.push(clone(o.hand[0])); assert.throws(() => projectHandAssessment(o));
  });
  test('judgment input strips private roles, cards, credentials and unknown nested fields', () => {
    const o = observation(); o.phase = 'discussion'; o.assignedCardId = 'SECRET';
    o.self.role = 'improviser'; o.self.token = 'SECRET'; o.players[1].hand = ['SECRET']; o.players[1].role = 'SECRET';
    o.revealedCards.push(asset('unplayed-secret')); o.revealedCards[0].privateNotes = 'SECRET';
    o.transcript[0].internalScore = 'SECRET'; o.music.secret = 'SECRET';
    const input = projectJudgment(o);
    assert.ok(!JSON.stringify(input).includes('SECRET'));
    assert.ok(!JSON.stringify(input).includes('unplayed-secret'));
    assert.ok(!('role' in input.self) && !('hand' in input));
    assert.equal(input.self.selectedCardId, 'still');
    input.players[1].name = 'edited'; assert.equal(o.players[1].name, 'You');
    input.transcript[0].text = 'edited'; assert.notEqual(o.transcript[0].text, 'edited');
    const audience = clone(o); audience.self.role = 'audience'; audience.assignedCardId = 'different';
    assert.deepEqual(projectJudgment(o), projectJudgment(audience));
  });
  test('evidence namespaces allow equal raw IDs without confusing asset and message evidence', () => {
    const o = observation(); o.phase = 'voting'; o.music.id = 'still'; o.transcript[0].id = 'still';
    const ids = publicEvidenceIds(projectJudgment(o));
    assert.ok(ids.includes('music:still') && ids.includes('card:still') && ids.includes('message:still'));
  });
  test('human habit is unknown and its unused weight is renormalized rather than treated as innocence', () => {
    const input = judgmentInput(); const ranked = rankJudgments(input, judgments());
    const human = ranked.find(j => j.playerId === 'human');
    assert.equal(human.habitMismatch, null); assert.equal(human.weights.habit, 0);
    assert.ok(Math.abs(human.weights.self + human.weights.statement - 1) < 1e-9);
    assert.ok(Math.abs(human.score - ((.55 * .8 + .3 * .2) / .85)) < 1e-9);
    const bad = judgments(); bad[0].habitMismatch = 0; assert.throws(() => rankJudgments(input, bad));
    bad[0].habitMismatch = null; bad[1].habitMismatch = null; assert.throws(() => rankJudgments(input, bad));
  });
  test('replay uses validated recorded weights rather than silently substituting current persona defaults', () => {
    const hand = projectHandAssessment(observation());
    for (const key of DIMENSIONS) hand.persona.attention[key] = key === 'motion' ? 1 : 0;
    assert.equal(rankHand(hand, evaluations())[0].cardId, 'horse');
    hand.persona.attention.emotion = 1; assert.throws(() => rankHand(hand, evaluations()));
    const input = judgmentInput(); input.persona.judging = { self: .8, statement: .1, habit: .1 };
    const human = rankJudgments(input, judgments()).find(j => j.playerId === 'human');
    assert.ok(Math.abs(human.score - ((.8 * .8 + .1 * .2) / .9)) < 1e-9);
    input.persona.judging = { self: 0, statement: 0, habit: 1 }; assert.throws(() => rankJudgments(input, judgments()));
  });
  test('voting rejects self, unknown, duplicate or omitted candidates and hidden evidence', () => {
    const input = judgmentInput();
    for (const id of ['self', 'unknown', 'clara']) {
      const j = judgments(); j[0].playerId = id; assert.throws(() => validateCandidateJudgments(j, input));
    }
    assert.throws(() => validateCandidateJudgments(judgments().slice(0, 1), input));
    for (const id of ['card:horse', 'card:unplayed-secret', 'message:private-note', 'human-card']) {
      const j = judgments(); j[0].evidenceIds = [id]; assert.throws(() => validateCandidateJudgments(j, input));
    }
    const j = judgments(); j[0].evidenceIds = ['music:clip-1', 'music:clip-1'];
    assert.throws(() => validateCandidateJudgments(j, input));
  });
  test('model judgments are bounded and cannot smuggle an action or unbounded text', () => {
    const input = judgmentInput();
    for (const invalid of [NaN, Infinity, -.1, 1.1, '0.5']) {
      const j = judgments(); j[0].selfMismatch = invalid; assert.throws(() => validateCandidateJudgments(j, input));
    }
    for (const change of [j => { j[0].summary = 'x'.repeat(501); }, j => { j[0].summary = ''; }, j => { j[0].action = 'reveal'; }, j => { j[0].evidenceIds = []; }]) {
      const j = judgments(); change(j); assert.throws(() => validateCandidateJudgments(j, input));
    }
    assert.throws(() => validateCandidateJudgments({ judgments: judgments(), reveal: true }, input));
  });
  test('public explanation updates can change the vote; a private identity swap cannot', () => {
    const input = judgmentInput(); const before = judgments();
    before[0].selfMismatch = .6; before[0].statementConcern = .8;
    before[1].selfMismatch = .5; before[1].statementConcern = .5; before[1].habitMismatch = .5;
    assert.equal(chooseVote(input, before).playerId, 'human');
    const after = clone(before); after[0].statementConcern = 0;
    assert.equal(chooseVote(input, after).playerId, 'clara');
    const o = observation(); o.phase = 'voting'; o.self.role = 'improviser'; o.assignedCardId = 'horse';
    assert.deepEqual(rankJudgments(projectJudgment(o), before), rankJudgments(input, before));
    const discussion = clone(input); discussion.phase = 'discussion'; assert.throws(() => chooseVote(discussion, after));
  });
  test('malformed public snapshots fail closed instead of silently creating misleading evidence', () => {
    const mutations = [
      o => { o.players[1].id = 'self'; }, o => { o.transcript.push(clone(o.transcript[0])); },
      o => { o.transcript[0].playerId = 'outsider'; }, o => { o.transcript[0].replyToPlayerId = 'outsider'; },
      o => { o.revealedCards = []; }, o => { o.revealedCards.push(clone(o.revealedCards[0])); },
    ];
    for (const mutate of mutations) { const o = observation(); o.phase = 'voting'; mutate(o); assert.throws(() => projectJudgment(o)); }
    assert.throws(() => projectJudgment(observation()));
  });
  console.log(`\n${count} AI decision scenarios passed.`);
} finally { rmSync(temp, { recursive: true, force: true }); }
