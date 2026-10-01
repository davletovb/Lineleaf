// Browser integration of the production controller/transport/panel with synthetic Chrome/native ports.
import {installController} from '/lib/controller.mjs';
import {fakeChrome, Event} from '/test-api.mjs';
const worker = fakeChrome({sites: [location.origin]});
worker.api.tabs.get = async id => ({id, url: location.href});
worker.sender.url = location.href;
worker.api.tabs.sendMessage = async (_, message) => fixture.runtimeMessages.emit(message, {id: chrome.runtime.id});
installController(worker.api);
chrome.runtime.sendMessage = message => new Promise(resolve => worker.api.runtime.onMessage.emit(message, worker.sender, resolve));
chrome.runtime.connect = () => {
  const server = worker.connect(), client = {onMessage: new Event(), onDisconnect: new Event()};
  server.postMessage = message => queueMicrotask(() => client.onMessage.emit(message));
  server.onDisconnect.addListener(() => client.onDisconnect.emit());
  client.disconnect = () => server.disconnect();
  client.postMessage = message => {
    if (message.type === 'start') fixture.checks.push(message);
    queueMicrotask(() => server.onMessage.emit(message));
  };
  return client;
};
fixture.worker = worker;
await import('/content.js');
