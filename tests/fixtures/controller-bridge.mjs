// Browser integration of the production controller/transport/panel with synthetic Chrome/native ports.
import {installController} from '/lib/controller.mjs';
import {fakeChrome, Event} from '/test-api.mjs';
const params = new URL(location.href).searchParams;
const worker = fakeChrome({sites: [location.origin], automatic: params.has('automatic'), clarity: params.has('clarity')});
worker.api.tabs.query = async () => [{id: 7, url: location.href, incognito: false}];
worker.api.tabs.get = async id => ({id, url: location.href});
worker.sender.url = location.href;
worker.api.scripting.executeScript = async ({target}) => (target.documentIds ?? [worker.sender.documentId]).map(documentId => ({documentId, frameId: 0, result: {url: location.href, topOrigin: location.origin}}));
worker.api.tabs.sendMessage = async (_, message) => fixture.runtimeMessages.emit(message, {id: chrome.runtime.id});
installController(worker.api, {now: () => Date.now()}); // looked up on every call so a test can move the clock
chrome.runtime.sendMessage = message => new Promise(resolve => worker.api.runtime.onMessage.emit(message, {...worker.sender, url: location.href}, resolve));
// One-shot faults for tests: the next connection cannot be made (`connect`), or the worker goes away after the next explicit
// rewrite request arrives (`drop`).
fixture.faults = {connect: false, drop: false};
chrome.runtime.connect = () => {
  if (fixture.faults.connect) { fixture.faults.connect = false; throw new Error('worker unavailable'); }
  const server = worker.connect({url: location.href}), client = {onMessage: new Event(), onDisconnect: new Event()};
  server.postMessage = message => queueMicrotask(() => client.onMessage.emit(structuredClone(message)));
  server.onDisconnect.addListener(() => client.onDisconnect.emit());
  client.disconnect = () => server.disconnect();
  client.postMessage = message => {
    if (message.type === 'start') fixture.checks.push(structuredClone(message));
    if (message.type === 'start' && fixture.faults.drop && message.mode !== 'proofread') { fixture.faults.drop = false; queueMicrotask(() => server.disconnect()); return; }
    const copy = structuredClone(message); queueMicrotask(() => server.onMessage.emit(copy));
  };
  return client;
};
fixture.worker = worker;
await import('/content.js');
