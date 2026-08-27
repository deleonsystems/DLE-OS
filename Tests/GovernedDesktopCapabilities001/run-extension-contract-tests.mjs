import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const extensionRoot = path.join(root, 'Tools', 'DevelopmentRuntime',
  'GovernedDesktopCapabilities', 'EdgeExtension');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
const contractSource = fs.readFileSync(path.join(extensionRoot, 'contract.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(extensionRoot, 'service-worker.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(extensionRoot, 'content-script.js'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'Tools', 'DevelopmentRuntime',
  'GovernedDesktopCapabilities', 'Install-DleOsDevGovernedDesktopCapabilities.ps1'), 'utf8');

assert.deepEqual(manifest.host_permissions, ['https://dev.dle-os.internal.dlemfg.com/*']);
assert.deepEqual(manifest.content_scripts[0].matches, ['https://dev.dle-os.internal.dlemfg.com/*']);
assert.deepEqual(manifest.permissions, ['nativeMessaging']);
assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
assert.match(workerSource, /com\.dlemfg\.dleos\.dev\.desktop_capabilities/);
assert.match(contentSource, /data-dle-desktop-operation="open-drawing-folder"/);
assert.doesNotMatch(contentSource + workerSource, /explorer\.exe|\\\\DeLeon-Server|run-command|open-any-path/);
assert.match(installer, /Registry32/);
assert.match(installer, /LocalMachine/);
assert.match(installer, /C:\\ProgramData\\DLE-OS\\GovernedDesktopCapabilities\\DEV\\host/);
assert.match(installer, /ReadAndExecute, Synchronize/);
assert.doesNotMatch(installer, /HKLM64|RegistryView\]::Registry64.*LocalMachine/);
assert.match(installer, /chrome-extension:\/\/\$extensionId\//);

const context = { URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(contractSource, context);
const contract = context.DleDesktopContract;
const capability = 'dlecap1_' + 'A'.repeat(43);
const request = contract.createRequest(capability, 'correlation-1');
assert.equal(request.operation, 'open-drawing-folder');
assert.equal(contract.createRequest('C:\\Windows', 'correlation-1'), null);
assert.equal(contract.createRequest('dlecap1_' + 'A'.repeat(42), 'correlation-1'), null);
assert.equal(contract.isExactRequest(request), true);
assert.equal(contract.isExactRequest({ ...request, path: 'C:\\Windows' }), false);
assert.equal(contract.isExactRequest({ ...request, operation: 'run-command' }), false);
assert.equal(contract.isApprovedSender({
  frameId: 0,
  tab: { url: 'https://dev.dle-os.internal.dlemfg.com/' }
}), true);
assert.equal(contract.isApprovedSender({
  frameId: 0,
  tab: { url: 'https://evil.example/' }
}), false);
assert.equal(contract.isApprovedSender({
  frameId: 1,
  tab: { url: 'https://dev.dle-os.internal.dlemfg.com/' }
}), false);

let messageListener;
let nativeMessageCallback;
let diagnosticResponse;
const diagnosticWarnings = [];
const diagnosticMessages = [];
const workerContext = {
  DleDesktopContract: contract,
  importScripts() {},
  console: {
    warn(...values) { diagnosticWarnings.push(values.join(' ')); }
  },
  chrome: {
    tabs: {
      sendMessage(tabId, message, callback) {
        assert.equal(tabId, 42);
        diagnosticMessages.push(message);
        callback?.();
      }
    },
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) { messageListener = listener; }
      },
      sendNativeMessage(hostName, nativeRequest, callback) {
        assert.equal(hostName, 'com.dlemfg.dleos.dev.desktop_capabilities');
        assert.equal(nativeRequest, request);
        nativeMessageCallback = callback;
      }
    }
  }
};
workerContext.globalThis = workerContext;
vm.createContext(workerContext);
vm.runInContext(workerSource, workerContext);
assert.equal(messageListener(request, {
  frameId: 0,
  tab: { id: 42, url: 'https://dev.dle-os.internal.dlemfg.com/' }
}, response => { diagnosticResponse = response; }), true);
workerContext.chrome.runtime.lastError = {
  message: 'Specified native messaging host not found.'
};
nativeMessageCallback(undefined);
assert.equal(diagnosticResponse.category, 'NativeHostUnavailable');
assert.equal(diagnosticWarnings.length, 1);
assert.match(diagnosticWarnings[0], /"category":"HostNotFound"/);
assert.match(diagnosticWarnings[0], /"edgeError":"Specified native messaging host not found\."/);
assert.match(diagnosticWarnings[0], /"correlationId":"correlation-1"/);
assert.doesNotMatch(diagnosticWarnings[0], new RegExp(capability));
assert.deepEqual(diagnosticMessages.map(message => message.event), [
  'service-worker-startup',
  'service-worker-message-received',
  'service-worker-handler-start',
  'native-messaging-call-start',
  'native-messaging-callback-error',
  'service-worker-response-sent'
]);
assert.equal(diagnosticMessages[4].errorCategory, 'HostNotFound');
assert.equal(diagnosticMessages[5].errorCategory, 'NativeHostUnavailable');
assert.doesNotMatch(JSON.stringify(diagnosticMessages), new RegExp(capability));
assert.match(contentSource, /content-script-send-start/);
assert.match(contentSource, /content-script-response-received/);
assert.match(contentSource, /content-script-send-complete/);
assert.match(contentSource, /content-script-send-error/);

console.log('Edge extension exact-origin and bounded-message contracts: PASS');
