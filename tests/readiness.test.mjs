// The retained native connection, Seatline's readiness API, and preparation: how the production controller and transport behave
// against synthetic native ports. A fake companion answers the wire; nothing here measures a provider.
import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {installController} from '../extension/lib/controller.mjs';
import {NativeSeatline} from '../extension/lib/native-seatline.mjs';
import {requireReady, LINK_IDLE, PREPARE_INTERVAL, READINESS} from '../extension/lib/policy.mjs';
import {fakeNative, fakeChrome, broker, sent, probed, turnOf, READY, waitFor} from './fixtures/extension-api.mjs';
import {closeNativeFixtures} from './fixtures/extension-api.mjs';
test.afterEach(closeNativeFixtures);

const API_KEY = {...READY, sign_in: 'api_key'};
const correction = (before, after) => ({before, after, left: '', right: '', category: 'grammar', explanation: 'Test'});
const start = (port, text = 'He go to work.', extra = {}) => port.onMessage.emit({type: 'start', id: crypto.randomUUID(), text, mode: 'proofread', ...extra});
const autoStart = (port, text) => start(port, text, {kind: 'automatic'});
// The frames the companion received (the fixture's call log also records the worker's storage setup).
const frames = f => f.calls.filter(m => m.method);
const methods = f => frames(f).filter(m => m.method !== 'cancel').map(m => m.method);
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve)); };
const result = port => port.received.find(m => m.type === 'result');
const failure = port => port.received.find(m => m.type === 'error');
const textOf = m => JSON.parse(turnOf(m).messages[0].text).text;

test('readiness and prepare answer with the provider status; a checked send reports it ahead of its output', async () => {
  const seen = [];
  const native = new NativeSeatline(() => fakeNative((m, p) => { seen.push(m.method); broker(m, p, {answer: 'answer'}); }));
  assert.deepEqual(await native.request('readiness', READINESS.cached), READY);
  assert.deepEqual(await native.request('prepare', READINESS.cached), READY);
  const statuses = []; assert.equal(await native.request('send_ready_with_policy', {turn: {}, freshness: READINESS.cached, allowed_sign_in: ['subscription']}, {onStatus: status => statuses.push(status)}), 'answer');
  assert.deepEqual(statuses, [READY]); assert.deepEqual(seen, ['readiness', 'prepare', 'send_ready_with_policy']); assert.equal(native.pending.size, 0); native.close();
});
test('status events outside their place, and a checked send that never reports a status, close the connection', async () => {
  const cases = {
    'a status for a plain send': (m, p) => { if (m.method === 'send') p.reply(m.id, {type: 'status', status: READY}); },
    'two statuses': (m, p) => { p.reply(m.id, {type: 'status', status: READY}); p.reply(m.id, {type: 'status', status: READY}); },
    'a status after output': (m, p) => { p.reply(m.id, {type: 'delta', text: 'late'}); p.reply(m.id, {type: 'status', status: READY}); },
    'output for a readiness check': (m, p) => { p.reply(m.id, {type: 'delta', text: 'text'}); },
    'no status before completion': (m, p) => { p.reply(m.id, {type: 'completed'}); },
  };
  for (const [name, handler] of Object.entries(cases)) {
    const method = name === 'a status for a plain send' ? 'send' : name === 'output for a readiness check' ? 'readiness' : 'send_ready_with_policy';
    const native = new NativeSeatline(() => fakeNative(handler));
    await assert.rejects(native.request(method, {}), /PROTOCOL_ERROR/, name); assert.equal(native.port, null, name);
  }
});
test('a status that fails the app policy stops a checked send at once, and its output is dropped', async () => {
  let port; const native = new NativeSeatline(() => port = fakeNative((m, p) => {
    if (m.method === 'send_ready_with_policy') { p.reply(m.id, {type: 'status', status: API_KEY}); p.reply(m.id, {type: 'delta', text: 'billed'}); }
    if (m.method === 'cancel') { p.reply(m.id, {type: 'completed'}); p.reply(m.target, {type: 'delta', text: 'more'}); p.reply(m.target, {type: 'stopped'}); }
  }));
  await assert.rejects(native.request('send_ready_with_policy', {}, {onStatus: requireReady}), /SUBSCRIPTION_REQUIRED/);
  assert.equal(port.sent[1].method, 'cancel'); assert.equal(port.sent[1].target, port.sent[0].id); assert.equal(native.pending.size, 0); native.close();
});
test('one connection carries concurrent requests and keeps their answers apart', async () => {
  let port; const held = [];
  const native = new NativeSeatline(() => port = fakeNative((m, p) => held.push([m, p])));
  const first = native.request('prepare', READINESS.cached), second = native.request('readiness', READINESS.cached);
  await waitFor(() => held.length === 2);
  const [[a, pa], [b, pb]] = held; // answered out of order
  pb.reply(b.id, {type: 'status', status: API_KEY}); pb.reply(b.id, {type: 'completed'});
  pa.reply(a.id, {type: 'status', status: READY}); pa.reply(a.id, {type: 'completed'});
  assert.deepEqual(await first, READY); assert.deepEqual(await second, API_KEY); assert.equal(port.closed, false); native.close();
});
test('a frame a stale retained port refuses is sent once on a new connection; nothing sent is ever replayed', async () => {
  const ports = [];
  const native = new NativeSeatline(() => {
    const port = fakeNative((m, p) => broker(m, p, {answer: 'ok'})); ports.push(port);
    if (ports.length === 2) port.postMessage = () => { throw new Error('Attempting to use a disconnected port object'); }; // the second port is dead on arrival
    return port;
  });
  assert.equal(await native.request('send', {}), 'ok'); // port 1, served
  ports[0].postMessage = () => { throw new Error('Attempting to use a disconnected port object'); }; // port 1 goes away without a disconnect event
  // The retry opens port 2, which refuses as well: two attempts in all, then a final failure.
  await assert.rejects(native.request('send', {}), /NATIVE_UNAVAILABLE/); assert.equal(ports.length, 2);
  // A fresh port that works answers the retry of a request the stale one refused.
  const again = []; const fixed = new NativeSeatline(() => {
    const port = fakeNative((m, p) => broker(m, p, {answer: 'ok'})); again.push(port);
    if (again.length === 1) port.postMessage = () => { throw new Error('Attempting to use a disconnected port object'); };
    return port;
  });
  assert.equal(await fixed.request('send', {}), 'ok'); assert.equal(again.length, 2); assert.equal(again[1].sent.length, 1); // delivered exactly once
  // A frame that was delivered and then lost to a disconnect is not retried.
  let deliveries = 0; const lost = new NativeSeatline(() => fakeNative((m, p) => { deliveries++; queueMicrotask(() => p.disconnect()); }));
  await assert.rejects(lost.request('send', {}), /NATIVE_UNAVAILABLE/); assert.equal(deliveries, 1);
});
test('closing ends what is in flight once and leaves the object ready to reconnect', async () => {
  const closes = []; let ports = 0;
  const native = new NativeSeatline(() => { ports++; return fakeNative((m, p) => { if (ports > 1) broker(m, p, {answer: 'back'}); }); }, {onClose: code => closes.push(code)});
  const pending = native.request('send', {}); await waitFor(() => native.pending.size === 1); native.close('NATIVE_UNAVAILABLE');
  await assert.rejects(pending, /NATIVE_UNAVAILABLE/); assert.deepEqual(closes, ['NATIVE_UNAVAILABLE']);
  assert.equal(await native.request('send', {}), 'back'); assert.equal(ports, 2); native.close();
});

test('checks share one native connection and one readiness: readiness, then a send under it, each time', async () => {
  const f = fakeChrome(); installController(f.api);
  for (let i = 0; i < 3; i++) { const port = f.connect({documentId: `document-${i}`}); start(port); await waitFor(() => result(port)); }
  assert.equal(f.ports.length, 1); assert.equal(f.ports[0].closed, false);
  assert.deepEqual(methods(f), ['readiness', 'send_ready_with_policy', 'readiness', 'send_ready_with_policy', 'readiness', 'send_ready_with_policy']);
  for (const m of f.calls.filter(probed)) assert.deepEqual(m.params, {mode: 'cached', max_age_ms: 30000});
  for (const m of f.calls.filter(sent)) {
    assert.deepEqual(m.params.allowed_sign_in, ['subscription']);
    assert.deepEqual(m.params.freshness, {mode: 'cached', max_age_ms: 30000});
    assert.equal(turnOf(m).check_sign_in, false, 'the readiness just checked stands in for a second probe');
    assert.deepEqual([turnOf(m).tools, turnOf(m).session, turnOf(m).continuation, turnOf(m).cleanup_group], ['none', 'ephemeral', null, null]);
  }
});
test('Lineleaf’s own policy is enforced from the readiness before anything is sent, and again from the status the send ran under', async () => {
  const refused = fakeChrome({state: API_KEY}); installController(refused.api); const port = refused.connect(); start(port);
  await waitFor(() => failure(port)); assert.equal(failure(port).code, 'SUBSCRIPTION_REQUIRED'); assert.deepEqual(methods(refused), ['readiness']);
  // The account changes between the check and the send: the send's own status is a billing mode Lineleaf refuses.
  const f = fakeChrome(); let swapped = false;
  f.api.runtime.connectNative = () => fakeNative((m, p) => broker(m, p, {state: swapped && m.method === 'send_ready_with_policy' ? API_KEY : READY, send: (m, p) => { p.reply(m.id, {type: 'delta', text: 'billed'}); p.reply(m.id, {type: 'completed'}); }}));
  installController(f.api); swapped = true; const second = f.connect(); start(second);
  await waitFor(() => failure(second)); assert.equal(failure(second).code, 'SUBSCRIPTION_REQUIRED'); assert.equal(result(second), undefined);
});
test('Seatline refusing before a turn starts earns one fresh check and send; a second refusal is final', async () => {
  for (const reason of ['READINESS_CHANGED', 'READINESS_EXPIRED', 'READINESS_UNVERIFIED']) {
    const f = fakeChrome(); let refusals = 1;
    f.api.runtime.connectNative = () => fakeNative((m, p) => { f.calls.push(m); broker(m, p, {send: (m, p) => {
      if (refusals-- > 0) p.reply(m.id, {type: 'failed', reason});
      else { p.reply(m.id, {type: 'delta', text: JSON.stringify({corrections: []})}); p.reply(m.id, {type: 'completed'}); }
    }}); });
    installController(f.api); const port = f.connect(); start(port); await waitFor(() => result(port));
    assert.deepEqual(methods(f), ['readiness', 'send_ready_with_policy', 'readiness', 'send_ready_with_policy'], reason);
    assert.deepEqual(f.calls.filter(probed).map(m => m.params.mode), ['cached', 'fresh'], reason);
    assert.deepEqual(f.calls.filter(sent).map(m => m.params.freshness.mode), ['cached', 'cached'], reason); // the retry's send reuses the fresh check just made
  }
  const f = fakeChrome(); let attempts = 0;
  f.api.runtime.connectNative = () => fakeNative((m, p) => { if (sent(m)) attempts++; broker(m, p, {send: (m, p) => p.reply(m.id, {type: 'failed', reason: 'READINESS_CHANGED'})}); });
  installController(f.api); const port = f.connect(); start(port); await waitFor(() => failure(port));
  assert.equal(attempts, 2); assert.equal(failure(port).code, 'READINESS_CHANGED');
  // Other failures are never retried: the send may have started.
  const g = fakeChrome(); let tries = 0;
  g.api.runtime.connectNative = () => fakeNative((m, p) => { if (sent(m)) tries++; broker(m, p, {send: (m, p) => p.reply(m.id, {type: 'failed', reason: 'PROVIDER_FAILED'})}); });
  installController(g.api); const other = g.connect(); start(other); await waitFor(() => failure(other)); assert.equal(tries, 1);
});
test('a companion without policy enforcement can show status but cannot receive a writing prompt', async () => {
  const f = fakeChrome({legacy: true}); installController(f.api);
  const first = f.connect(); start(first); await waitFor(() => failure(first));
  const second = f.connect({documentId: 'document-two'}); start(second); await waitFor(() => failure(second));
  assert.deepEqual(methods(f), ['readiness', 'status', 'status']); assert.equal(f.ports.length, 1);
  assert.equal(failure(first).code, 'COMPANION_UPDATE_REQUIRED');
  assert.equal(f.calls.filter(sent).length, 0, 'no fallback prompt may bypass policy enforcement');
  // The connection ends and the companion has been updated meanwhile: the readiness API is tried again, and used.
  f.ports[0].disconnect(); f.legacy = false;
  const third = f.connect({documentId: 'document-three'}); start(third); await waitFor(() => result(third));
  assert.deepEqual(methods(f).slice(3), ['readiness', 'send_ready_with_policy']); assert.equal(f.ports.length, 2);
  // Once the readiness API has answered on a connection, an INVALID_REQUEST from it is a real failure, not a reason to fall back to status.
  const g = fakeChrome(); let refuse = false;
  g.api.runtime.connectNative = () => { const port = fakeNative((m, p) => { g.calls.push(m); if (refuse && m.method === 'readiness') p.reply(m.id, {type: 'failed', reason: 'INVALID_REQUEST'}); else broker(m, p); }); g.ports.push(port); return port; };
  installController(g.api); const ok = g.connect(); start(ok); await waitFor(() => result(ok));
  refuse = true; const bad = g.connect({documentId: 'bad'}); start(bad); await waitFor(() => failure(bad));
  assert.equal(failure(bad).code, 'INVALID_REQUEST'); assert.deepEqual(methods(g), ['readiness', 'send_ready_with_policy', 'readiness']); assert.equal(g.ports.length, 1);
});
test('a readiness-capable companion without protected sends fails closed without a fallback turn', async () => {
  const f = fakeChrome();
  f.api.runtime.connectNative = () => fakeNative((m, p) => {
    f.calls.push(m);
    if (m.method === 'send_ready_with_policy') p.reply(m.id, {type: 'failed', reason: 'INVALID_REQUEST'});
    else broker(m, p);
  });
  installController(f.api); const port = f.connect(); start(port);
  await waitFor(() => failure(port));
  assert.equal(failure(port).code, 'COMPANION_UPDATE_REQUIRED');
  assert.deepEqual(methods(f), ['readiness', 'send_ready_with_policy']);
});
test('the connection closes after the idle limit, never while work is running, and the next request reconnects', async () => {
  mock.timers.enable({apis: ['setTimeout']});
  try {
    const f = fakeChrome(); installController(f.api); const port = f.connect(); start(port); await settle();
    assert.ok(result(port)); assert.equal(f.ports[0].closed, false);
    mock.timers.tick(LINK_IDLE - 1); await settle(); assert.equal(f.ports[0].closed, false);
    mock.timers.tick(1); await settle(); assert.equal(f.ports[0].closed, true);
    const next = f.connect({documentId: 'document-two'}); start(next); await settle();
    assert.ok(result(next)); assert.equal(f.ports.length, 2); assert.equal(f.ports[1].closed, false);
    // A request still running when the limit comes keeps the connection; the limit starts again afterwards.
    const g = fakeChrome({hang: true}); installController(g.api); const slow = g.connect(); start(slow); await settle();
    mock.timers.tick(LINK_IDLE * 3); await settle(); assert.equal(g.ports[0].closed, false);
  } finally { mock.timers.reset(); }
});
test('a connection lost while idle is replaced by the next request; one lost mid-request fails that request alone and replays nothing', async () => {
  const f = fakeChrome(); installController(f.api);
  const first = f.connect(); start(first); await waitFor(() => result(first));
  f.ports[0].disconnect(); // the companion went away while nothing was running
  const second = f.connect({documentId: 'document-two'}); start(second); await waitFor(() => result(second));
  assert.equal(f.ports.length, 2);
  // Now the connection drops after a turn was sent and before it answered.
  const lost = fakeChrome(); let turns = 0;
  lost.api.runtime.connectNative = () => { const port = fakeNative((m, p) => { lost.calls.push(m); if (sent(m)) { turns++; if (turns === 1) { queueMicrotask(() => p.disconnect()); return; } } broker(m, p); }); lost.ports.push(port); return port; };
  installController(lost.api); const dropped = lost.connect(); start(dropped); await waitFor(() => failure(dropped));
  assert.equal(failure(dropped).code, 'NATIVE_UNAVAILABLE'); assert.equal(turns, 1, 'the lost turn is not sent again');
  const after = lost.connect({documentId: 'document-two'}); start(after); await waitFor(() => result(after)); assert.equal(turns, 2); assert.equal(lost.ports.length, 2);
});
test('pausing and resetting close the connection; nothing keeps a companion process for a paused or cleared Lineleaf', async () => {
  for (const change of ['pause', 'reset', 'last-site-off']) {
    const f = fakeChrome(); installController(f.api); const port = f.connect(); start(port); await waitFor(() => result(port));
    if (change === 'pause') await f.rpc('set-pause', {paused: true});
    else if (change === 'reset') await f.rpc('reset');
    else await f.rpc('set-site', {origin: 'https://writing.test', enabled: false});
    await waitFor(() => f.ports[0].closed);
  }
});
test('Check Seatline always asks for a fresh readiness, over the same connection, and never while a request runs', async () => {
  const f = fakeChrome(); const controller = installController(f.api);
  const view = await f.rpc('check-connection'); assert.equal(view.ok, true); assert.equal(view.value.sign_in, 'subscription');
  assert.deepEqual(frames(f).map(m => [m.method, m.params]), [['readiness', {mode: 'fresh'}]]); assert.equal(f.ports[0].closed, false);
  const port = f.connect(); start(port); await waitFor(() => result(port)); assert.equal(f.ports.length, 1);
  const old = fakeChrome({legacy: true}); installController(old.api); assert.equal((await old.rpc('check-connection')).ok, true);
  assert.deepEqual(methods(old), ['readiness', 'status']);
  const busy = fakeChrome({hang: true}); installController(busy.api); const slow = busy.connect(); start(slow); await waitFor(() => busy.calls.some(sent));
  assert.equal((await busy.rpc('check-connection')).code, 'BUSY'); assert.ok(controller);
});

test('each field’s check is its own ephemeral turn: answers, turns and cancellations never cross between fields on the shared connection', async () => {
  const f = fakeChrome({answer: turn => JSON.stringify({corrections: [correction(JSON.parse(turn.messages[0].text).text.split(' ')[0], 'X')]})});
  installController(f.api);
  const a = f.connect({documentId: 'field-a'}), b = f.connect({documentId: 'field-b'});
  start(a, 'Alpha go home.'); await waitFor(() => result(a)); start(b, 'Bravo go home.'); await waitFor(() => result(b));
  assert.equal(result(a).edits[0].before, 'Alpha'); assert.equal(result(b).edits[0].before, 'Bravo');
  const turns = f.calls.filter(sent);
  assert.deepEqual(turns.map(textOf), ['Alpha go home.', 'Bravo go home.']);
  for (const turn of turns) assert.deepEqual(Object.keys(JSON.parse(turn.params.turn.messages[0].text)), ['text'], 'only the field’s own text, and a dictionary only when the user has one');
  assert.equal(f.ports.length, 1); assert.equal(JSON.stringify(a.received).includes('Bravo'), false); assert.equal(JSON.stringify(b.received).includes('Alpha'), false);
  // A request running for one field turns another away; it does not queue behind it or borrow its connection state.
  const slow = fakeChrome({hang: true}); installController(slow.api); const one = slow.connect({documentId: 'one'}), two = slow.connect({documentId: 'two'});
  start(one, 'One'); await waitFor(() => slow.calls.some(sent)); start(two, 'Two'); await waitFor(() => failure(two)); assert.equal(failure(two).code, 'BUSY');
  assert.deepEqual(slow.calls.filter(sent).map(textOf), ['One']);
});
test('a cancelled field leaves nothing behind for the next field, not even output that arrives after the cancel', async () => {
  const f = fakeChrome(); const controller = installController(f.api); let answers = 0;
  f.api.runtime.connectNative = () => { const port = fakeNative((m, p) => {
    f.calls.push(m);
    if (m.method === 'cancel') { p.reply(m.target, {type: 'delta', text: JSON.stringify({corrections: [correction('Alpha', 'LEAK')]})}); p.reply(m.id, {type: 'completed'}); p.reply(m.target, {type: 'stopped'}); return; }
    if (m.method === 'send_ready_with_policy' && ++answers === 1) { p.reply(m.id, {type: 'status', status: READY}); p.reply(m.id, {type: 'delta', text: '{"corrections":['}); return; } // field A: half an answer, then it is cancelled
    broker(m, p, {answer: turn => JSON.stringify({corrections: [correction(JSON.parse(turn.messages[0].text).text.split(' ')[0], 'ok')]})});
  }); f.ports.push(port); return port; };
  const a = f.connect({documentId: 'field-a'}), b = f.connect({documentId: 'field-b'});
  start(a, 'Alpha go home.'); await waitFor(() => f.calls.some(m => m.method === 'send_ready_with_policy'));
  a.disconnect(); await waitFor(() => failure(a) || controller.active === null);
  start(b, 'Bravo go home.'); await waitFor(() => result(b));
  assert.deepEqual(result(b).edits.map(e => [e.before, e.after]), [['Bravo', 'ok']]); assert.equal(JSON.stringify(b.received).includes('LEAK'), false); assert.equal(f.ports.length, 1);
});
test('a persistent session from the companion is a contract violation: the connection is dropped and the next field starts clean', async () => {
  const f = fakeChrome(); let violate = true;
  f.api.runtime.connectNative = () => { const port = fakeNative((m, p) => { f.calls.push(m); broker(m, p, {send: (m, p) => { if (violate) { violate = false; p.reply(m.id, {type: 'session', session: 'secret'}); } else { p.reply(m.id, {type: 'delta', text: '{"corrections":[]}'}); p.reply(m.id, {type: 'completed'}); } }}); }); f.ports.push(port); return port; };
  installController(f.api); const a = f.connect({documentId: 'field-a'}); start(a, 'Alpha'); await waitFor(() => failure(a));
  assert.equal(failure(a).code, 'PROTOCOL_ERROR'); assert.equal(f.ports[0].closed, true);
  const b = f.connect({documentId: 'field-b'}); start(b, 'Bravo'); await waitFor(() => result(b)); assert.equal(f.ports.length, 2);
  assert.ok(f.calls.filter(sent).every(m => turnOf(m).continuation === null && turnOf(m).session === 'ephemeral'));
});

test('an enabled editor’s preparation asks Seatline for a cached readiness and carries no text', async () => {
  let clock = 100000; const f = fakeChrome(); installController(f.api, {now: () => clock});
  const reply = await f.rpc('prepare', null, f.sender); assert.deepEqual(reply, {ok: true, value: 'prepared'});
  assert.deepEqual(frames(f).map(m => [m.method, m.params]), [['prepare', {mode: 'cached', max_age_ms: 30000}]]); assert.equal(f.ports.length, 1);
  assert.equal(JSON.stringify(f.calls).includes('messages'), false);
  // At most one preparation per interval, however often the user moves between fields.
  assert.deepEqual(await f.rpc('prepare', null, f.sender), {ok: true, value: 'skipped'}); assert.equal(frames(f).length, 1);
  clock += PREPARE_INTERVAL; assert.deepEqual(await f.rpc('prepare', null, f.sender), {ok: true, value: 'prepared'}); assert.equal(frames(f).length, 2);
  // The check that follows reuses the connection and asks for the same cached readiness.
  const port = f.connect(); start(port); await waitFor(() => result(port));
  assert.deepEqual(methods(f), ['prepare', 'prepare', 'readiness', 'send_ready_with_policy']); assert.equal(f.ports.length, 1);
});
test('preparation happens only for a site the user enabled and Lineleaf is not paused on, and never for a sender it does not trust', async () => {
  const off = fakeChrome({sites: []}); installController(off.api);
  const reply = await off.rpc('prepare', null, off.sender); assert.equal(reply.ok, false); assert.equal(frames(off).length, 0); assert.equal(off.ports.length, 0);
  const paused = fakeChrome(); installController(paused.api); await paused.rpc('set-pause', {paused: true});
  assert.equal((await paused.rpc('prepare', null, paused.sender)).ok, false); assert.equal(frames(paused).length, 0);
  const f = fakeChrome(); installController(f.api);
  for (const from of [{...f.sender, id: 'another-extension'}, {...f.sender, tab: {id: 7, incognito: true}}, {...f.sender, documentId: undefined}]) assert.equal((await f.rpc('prepare', null, from)).ok, false);
  assert.equal((await f.rpc('prepare', {text: 'draft'}, f.sender)).ok, false); assert.equal(frames(f).length, 0); // a payload is not part of the message
});
test('the toolbar menu prepares for its tab only when the site is enabled and not paused', async () => {
  const f = fakeChrome(); installController(f.api);
  assert.deepEqual(await f.rpc('prepare', {tabId: 7}), {ok: true, value: 'prepared'}); assert.equal(methods(f)[0], 'prepare');
  assert.equal((await f.rpc('prepare', {tabId: 'seven'})).ok, false);
  assert.equal((await f.rpc('prepare', {tabId: 7}, f.sender)).ok, false); // only the extension's own pages may send this form
  const off = fakeChrome({sites: []}); installController(off.api); assert.equal((await off.rpc('prepare', {tabId: 7})).ok, false); assert.equal(frames(off).length, 0);
});
test('preparation leaves a busy, rate-limited or slow provider alone, never reports a failure, and does not disturb the next check', async () => {
  let clock = 100000;
  const busy = fakeChrome({hang: true}); installController(busy.api, {now: () => clock}); const slow = busy.connect(); start(slow); await waitFor(() => busy.calls.some(sent));
  assert.deepEqual(await busy.rpc('prepare', null, busy.sender), {ok: true, value: 'skipped'}); assert.equal(busy.calls.filter(m => m.method === 'prepare').length, 0);
  const limited = fakeChrome(); installController(limited.api, {now: () => clock}); limited.api.runtime.connectNative = () => fakeNative((m, p) => { limited.calls.push(m); broker(m, p, {send: (m, p) => p.reply(m.id, {type: 'failed', reason: 'PROVIDER_RATE_LIMITED'})}); });
  const first = limited.connect(); start(first); await waitFor(() => failure(first)); clock += PREPARE_INTERVAL;
  assert.deepEqual(await limited.rpc('prepare', null, limited.sender), {ok: true, value: 'skipped'}); assert.equal(limited.calls.filter(m => m.method === 'prepare').length, 0);
  const held = fakeChrome({automatic: true}); installController(held.api, {now: () => clock});
  held.api.runtime.connectNative = () => fakeNative((m, p) => { held.calls.push(m); broker(m, p, {send: (m, p) => p.reply(m.id, {type: 'failed', reason: 'PROVIDER_TIMEOUT'})}); });
  const timedOut = held.connect(); autoStart(timedOut); await waitFor(() => failure(timedOut)); clock += PREPARE_INTERVAL;
  assert.deepEqual(await held.rpc('prepare', null, held.sender), {ok: true, value: 'skipped'}); assert.equal(held.calls.filter(m => m.method === 'prepare').length, 0);
  // A preparation that fails is silent, and the check after it still works.
  const f = fakeChrome(); installController(f.api, {now: () => clock}); let broken = true;
  f.api.runtime.connectNative = () => fakeNative((m, p) => { f.calls.push(m); if (m.method === 'prepare' && broken) { p.reply(m.id, {type: 'failed', reason: 'PROVIDER_FAILED'}); return; } broker(m, p); });
  assert.deepEqual(await f.rpc('prepare', null, f.sender), {ok: true, value: 'skipped'}); broken = false;
  const port = f.connect(); start(port); await waitFor(() => result(port)); assert.equal(port.received.some(m => m.type === 'error'), false);
});
test('a companion without the readiness API is not prepared, and stays unprepared until it reconnects', async () => {
  let clock = 100000; const f = fakeChrome({legacy: true}); installController(f.api, {now: () => clock});
  assert.deepEqual(await f.rpc('prepare', null, f.sender), {ok: true, value: 'skipped'}); assert.deepEqual(methods(f), ['prepare']);
  clock += PREPARE_INTERVAL; assert.deepEqual(await f.rpc('prepare', null, f.sender), {ok: true, value: 'skipped'}); assert.deepEqual(methods(f), ['prepare'], 'it is not asked again');
});
