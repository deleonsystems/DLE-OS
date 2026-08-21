import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiSource = fs.readFileSync(path.join(root, 'SRC/api/dle-api-client.js'), 'utf8');

function loadApiClient(fetchImplementation) {
  const window = {
    DleOsRuntimeConfig: { environment: 'ISOLATED_DEVELOPMENT' },
    DleOsCapabilities: { can: () => true },
    location: new URL('https://dev.dle-os.internal.dlemfg.com/')
  };
  vm.runInNewContext(apiSource, {
    window,
    localStorage: { getItem: () => null },
    fetch: fetchImplementation,
    URL,
    URLSearchParams,
    AbortController,
    Uint8Array,
    console
  }, { filename: 'dle-api-client.js' });
  return window.DleApiClient;
}

let requestCount = 0;
const expiredClient = loadApiClient(async () => {
  requestCount += 1;
  return new Response(null, {
    status: 403,
    headers: { 'X-DLE-OS-Authentication-Required': 'true' }
  });
});
await assert.rejects(
  expiredClient.appendOperationsCenterVerifiedStatus('549250|0012084|010', {
    statusText: 'Retain this entry',
    requestCorrelationId: '11111111-1111-4111-8111-111111111111'
  }),
  error => error.status === 403 &&
    error.code === 'DLE_OS_AUTHENTICATION_REQUIRED' &&
    error.authenticationRequired === true &&
    error.message === 'Your DLE-OS session has expired. Refresh the page or sign in again, then retry your save.'
);
assert.equal(requestCount, 1, 'an expired-session mutation is never replayed automatically');

const permissionClient = loadApiClient(async () => Response.json({
  code: 'DLE_OS_PERMISSION_DENIED',
  message: 'The DLE-OS user does not have the required application permission.'
}, { status: 403 }));
await assert.rejects(
  permissionClient.appendOperationsCenterVerifiedStatus('549250|0012084|010', {
    statusText: 'Permission test'
  }),
  error => error.status === 403 &&
    error.code === 'DLE_OS_PERMISSION_DENIED' &&
    error.authenticationRequired === false &&
    error.message === 'The DLE-OS user does not have the required application permission.'
);

const failureClient = loadApiClient(async () => new Response(null, { status: 502 }));
await assert.rejects(
  failureClient.liveCanonical.getSnapshotRefreshStatus(),
  error => error.status === 502 &&
    error.code === 'http_error' &&
    error.authenticationRequired === false &&
    error.message === 'The governed ERP snapshot refresh control returned HTTP 502.'
);

const operationsSource = fs.readFileSync(
  path.join(root, 'SRC/modules/operations-center/operations-center.js'), 'latin1');
assert.match(operationsSource,
  /catch \(error\) \{\s*if \(message\) message\.textContent = 'Save failed: ' \+ \(error\?\.message \|\| error\);/,
  'Verified Status presents the shared expired-session error in its save message');
assert.doesNotMatch(operationsSource,
  /catch \(error\)[\s\S]{0,300}appendForRecord/,
  'the Verified Status failure path does not replay the mutation');
assert.doesNotMatch(operationsSource,
  /catch \(error\)[\s\S]{0,300}text\.value\s*=/,
  'the Verified Status failure path preserves the entered text');

console.log('Frontend expired-session recovery contracts: PASS');
