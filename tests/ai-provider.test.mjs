import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const temp = mkdtempSync(join(tmpdir(), 'jukebox-ai-provider-'));
writeFileSync(join(temp, 'package.json'), '{"type":"commonjs"}');
for (const name of ['types', 'provider.server', 'transcription.server']) {
  writeFileSync(join(temp, `${name}.js`), ts.transpileModule(readFileSync(new URL(`../lib/jukebox-ai/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText);
}
const req = createRequire(import.meta.url);
const { createJsonModel, createJsonModelFromEnv, readProviderConfig } = req(join(temp, 'provider.server.js'));
const { createTranscriber, createTranscriberFromEnv, MAX_RECORDING_BYTES } = req(join(temp, 'transcription.server.js'));
const config = { baseUrl: 'https://provider.example/v1', apiKey: 'test-secret-do-not-log', model: 'explicit-test-model' };
const task = {
  task: 'test-selection', messages: [{ role: 'system', content: 'Return the requested object.' }, { role: 'user', content: 'music and cards' }],
  schema: { type: 'object', properties: { card: { type: 'string' }, score: { type: 'number' } } },
};
const success = (content = '{"card":"001","score":0.7}', extras = {}) => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 12, completion_tokens: 8 }, ...extras }, { headers: { 'x-request-id': 'req-test-001' } });
const expectCode = code => error => error.code === code;
let count = 0;
const test = async (name, fn) => { await fn(); count++; process.stdout.write(`PASS ${name}\n`); };

try {
  await test('missing credentials/model are explicit configuration failures with no calls', async () => {
    let calls = 0;
    const transport = async () => { calls++; return success(); };
    assert.throws(() => createJsonModelFromEnv({}, transport), expectCode('not_configured'));
    assert.throws(() => createJsonModelFromEnv({ JUKEBOX_AI_API_KEY: 'configured' }, transport), expectCode('not_configured'));
    assert.throws(() => createTranscriberFromEnv({ JUKEBOX_AI_API_KEY: 'configured', JUKEBOX_AI_MODEL: 'chat-only' }, transport), expectCode('not_configured'));
    assert.equal(calls, 0);
  });
  await test('configuration rejects credential-bearing URLs, remote plaintext, redirects and invalid limits', async () => {
    for (const baseUrl of ['http://remote.example/v1', 'https://user:password@provider.example/v1', 'https://provider.example/v1?key=secret', 'https://provider.example/v1#secret', 'ftp://127.0.0.1/v1', 'invalid']) {
      assert.throws(() => createJsonModel({ ...config, baseUrl }), expectCode('invalid_configuration'));
    }
    assert.throws(() => createJsonModel({ ...config, timeoutMs: 0 }), expectCode('invalid_configuration'));
    assert.throws(() => createJsonModel({ ...config, maxResponseBytes: NaN }), expectCode('invalid_configuration'));
    assert.throws(() => createJsonModel({ ...config, apiKey: 'key\nnew-header' }), expectCode('invalid_configuration'));
    for (const baseUrl of ['http://127.0.0.1:8080/v1', 'http://localhost:8080/v1', 'http://[::1]:8080/v1']) assert.doesNotThrow(() => createJsonModel({ ...config, baseUrl }));
  });
  await test('strict structured request, bounded output, authorization and metrics are real fields', async () => {
    let sent;
    const model = createJsonModel(config, async (url, init) => { sent = { url, init }; return success(); });
    const result = await model.generate(task);
    assert.equal(sent.url, 'https://provider.example/v1/chat/completions');
    assert.equal(sent.init.headers.Authorization, `Bearer ${config.apiKey}`);
    assert.equal(sent.init.redirect, 'error');
    const body = JSON.parse(sent.init.body);
    assert.equal(body.model, config.model);
    assert.equal(body.max_completion_tokens, 1800);
    assert.equal(body.store, false);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.deepEqual(body.response_format.json_schema.schema.required, ['card', 'score']);
    assert.equal(task.schema.additionalProperties, undefined, 'caller schema must not be mutated');
    assert.deepEqual(result.value, { card: '001', score: .7 });
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8 });
    assert.equal(result.requestId, 'req-test-001');
    assert.equal(result.model, config.model);
    assert.ok(result.elapsedMs >= 0);
    assert.ok(!JSON.stringify(result).includes(config.apiKey));
  });
  await test('environment values are server-only and model must be explicitly chosen', async () => {
    const env = { JUKEBOX_AI_API_KEY: config.apiKey, JUKEBOX_AI_MODEL: 'chosen-model', JUKEBOX_AI_TIMEOUT_MS: '1200' };
    const settings = readProviderConfig(env);
    assert.equal(settings.baseUrl, 'https://api.openai.com/v1');
    assert.equal(settings.model, 'chosen-model');
    assert.equal(settings.timeoutMs, 1200);
  });
  await test('nested objects are strict and message extras never reach provider', async () => {
    let payload;
    const model = createJsonModel(config, async (_url, init) => { payload = JSON.parse(init.body); return success(); });
    await model.generate({ ...task, messages: [{ role: 'user', content: 'visible', tokenHash: 'private-seat-token' }], schema: { type: 'object', properties: { list: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } } });
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'visible' }]);
    assert.equal(payload.response_format.json_schema.schema.properties.list.items.additionalProperties, false);
    assert.deepEqual(payload.response_format.json_schema.schema.properties.list.items.required, ['id']);
  });
  await test('HTTP errors never leak provider body, URL, or credentials and never automatically retry', async () => {
    let calls = 0;
    const model = createJsonModel(config, async () => { calls++; return new Response(`Sensitive prompt ${config.apiKey}`, { status: 429 }); });
    await assert.rejects(model.generate(task), error => error.code === 'rate_limited' && !String(error).includes(config.apiKey) && !String(error).includes('Sensitive'));
    assert.equal(calls, 1);
    await assert.rejects(createJsonModel(config, async () => new Response(config.apiKey, { status: 401 })).generate(task), expectCode('provider_http_error'));
  });
  await test('network exceptions are sanitized', async () => {
    await assert.rejects(createJsonModel(config, async () => { throw new Error(`Failed https://provider.example/?key=${config.apiKey}`); }).generate(task), error => error.code === 'network_error' && !String(error).includes(config.apiKey) && !String(error).includes('provider.example'));
  });
  await test('malformed envelope, structured content, refusal and truncation fail distinctly', async () => {
    await assert.rejects(createJsonModel(config, async () => new Response('<html>failure</html>')).generate(task), expectCode('invalid_response'));
    await assert.rejects(createJsonModel(config, async () => success('{broken')).generate(task), expectCode('invalid_response'));
    await assert.rejects(createJsonModel(config, async () => Response.json({ choices: [] })).generate(task), expectCode('invalid_response'));
    await assert.rejects(createJsonModel(config, async () => success('{}', { choices: [{ finish_reason: 'length', message: { content: '{}' } }] })).generate(task), expectCode('invalid_response'));
    await assert.rejects(createJsonModel(config, async () => success('{}', { choices: [{ finish_reason: 'stop', message: { refusal: 'sensitive refusal', content: null } }] })).generate(task), expectCode('provider_refusal'));
  });
  await test('large declared and streamed responses are stopped', async () => {
    await assert.rejects(createJsonModel({ ...config, maxResponseBytes: 128 }, async () => new Response('{}', { headers: { 'content-length': '99999' } })).generate(task), expectCode('response_too_large'));
    let cancelled = false;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(256)); }, cancel() { cancelled = true; } });
    await assert.rejects(createJsonModel({ ...config, maxResponseBytes: 128 }, async () => new Response(body)).generate(task), expectCode('response_too_large'));
    assert.ok(cancelled);
  });
  await test('cancellation before dispatch makes no provider call', async () => {
    let calls = 0;
    const controller = new AbortController(); controller.abort('private reason');
    await assert.rejects(createJsonModel(config, async () => { calls++; return success(); }).generate(task, controller.signal), expectCode('cancelled'));
    assert.equal(calls, 0);
  });
  await test('timeout bounds a stalled network request', async () => {
    await assert.rejects(createJsonModel({ ...config, timeoutMs: 10 }, async () => new Promise(() => {})).generate(task), expectCode('timeout'));
  });
  await test('timeout also bounds a stalled response body', async () => {
    let cancelled = false;
    const body = new ReadableStream({ pull() {}, cancel() { cancelled = true; } });
    await assert.rejects(createJsonModel({ ...config, timeoutMs: 10 }, async () => new Response(body)).generate(task), expectCode('timeout'));
    assert.ok(cancelled);
  });
  await test('external cancellation during a request is distinct from a timeout', async () => {
    const controller = new AbortController();
    const promise = createJsonModel(config, async () => new Promise(() => {})).generate(task, controller.signal);
    controller.abort('do-not-log');
    await assert.rejects(promise, error => error.code === 'cancelled' && !String(error).includes('do-not-log'));
  });
  await test('transcription uses separate explicit model and an editable draft response', async () => {
    let sent;
    const transcriber = createTranscriberFromEnv({ JUKEBOX_AI_BASE_URL: config.baseUrl, JUKEBOX_AI_API_KEY: config.apiKey, JUKEBOX_AI_MODEL: 'chat', JUKEBOX_TRANSCRIBE_MODEL: 'speech' }, async (url, init) => {
      sent = { url, init }; return Response.json({ text: '  I chose the horse for freedom.  ' });
    });
    const result = await transcriber.transcribe(new Blob(['audio'], { type: 'audio/webm;codecs=opus' }), 'en');
    assert.equal(sent.url, 'https://provider.example/v1/audio/transcriptions');
    assert.equal(sent.init.headers['Content-Type'], undefined, 'fetch must generate multipart boundary');
    assert.equal(sent.init.body.get('model'), 'speech');
    assert.equal(sent.init.body.get('language'), 'en');
    assert.equal(sent.init.body.get('file').name, 'recording.webm');
    assert.equal(result.text, 'I chose the horse for freedom.');
    assert.equal(result.model, 'speech');
    assert.ok(result.elapsedMs >= 0);
    assert.ok(!('playerId' in result) && !('published' in result));
  });
  await test('empty/oversized/unsupported audio and languages never invoke provider', async () => {
    let calls = 0;
    const transcriber = createTranscriber(config, async () => { calls++; return Response.json({ text: 'hello' }); });
    for (const recording of [new Blob([], { type: 'audio/webm' }), new Blob(['text'], { type: 'text/html' }), new Blob([new Uint8Array(MAX_RECORDING_BYTES + 1)], { type: 'audio/wav' })]) {
      await assert.rejects(transcriber.transcribe(recording, 'en'), expectCode('invalid_recording'));
    }
    await assert.rejects(transcriber.transcribe(new Blob(['audio'], { type: 'audio/webm' }), 'xx'), expectCode('invalid_recording'));
    assert.equal(calls, 0);
  });
  await test('malformed transcription is rejected; an empty transcript remains an empty draft', async () => {
    const recording = new Blob(['audio'], { type: 'audio/mp4' });
    await assert.rejects(createTranscriber(config, async () => Response.json({ text: { unexpected: true } })).transcribe(recording, 'zh'), expectCode('invalid_response'));
    const silent = await createTranscriber(config, async () => Response.json({ text: '   ' })).transcribe(recording, 'zh');
    assert.equal(silent.text, '');
  });
  console.log(`\n${count} AI provider/transcription scenarios passed. No live provider calls made.`);
} finally { rmSync(temp, { recursive: true, force: true }); }
