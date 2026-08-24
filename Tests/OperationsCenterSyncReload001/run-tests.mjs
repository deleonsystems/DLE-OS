import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function createElement(id) {
  return {
    id,
    dataset: {},
    disabled: false,
    hidden: false,
    innerHTML: '',
    textContent: '',
    classList: { toggle() {} }
  };
}

function createContext({ confirm = () => true, startState, currentStates = [] } = {}) {
  const elements = new Map([
    ['syncOperationsStatus', createElement('syncOperationsStatus')],
    ['syncOperationsButton', createElement('syncOperationsButton')],
    ['operationsCenterTable', createElement('operationsCenterTable')],
    ['operationsCenterMobileView', { ...createElement('operationsCenterMobileView'), hidden: true }]
  ]);
  let refreshCalls = 0;
  const timers = [];
  const stateActions = {
    beginCanonicalLoad: () => 'load-' + (refreshCalls + 1),
    commitCanonicalLoad: () => true,
    failCanonicalLoad: error => { throw error; },
    setVerifiedStatusLoading() {},
    setVerifiedStatusError(error) { throw error; }
  };
  const context = vm.createContext({
    console,
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      }
    },
    fetch,
    structuredClone,
    window: {
      OperationsCenter: {
        state: { canonicalError: null, canonicalRows: [] },
        stateActions,
        table: {
          renderModule() {}
        },
        dataService: {
          async loadCanonicalRows() {
            refreshCalls += 1;
            return [{ masterRecordKey: 'synced-row' }];
          }
        },
        verifiedStatusService: {
          async loadLatestForRows() {}
        }
      },
      DleApiClient: {
        liveCanonical: {
          async startSyncOperations() {
            return startState;
          },
          async getSyncOperationsCurrent() {
            return currentStates.shift();
          }
        }
      },
      confirm,
      alert(message) {
        throw new Error('Unexpected alert: ' + message);
      },
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout() {}
    }
  });
  vm.runInContext(read('SRC/modules/operations-center/operations-center.js'), context, {
    filename: 'SRC/modules/operations-center/operations-center.js'
  });
  return {
    context,
    async runNextTimer() {
      const callback = timers.shift();
      assert.equal(typeof callback, 'function', 'a polling timer was registered');
      await callback();
    },
    get refreshCalls() {
      return refreshCalls;
    }
  };
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
}

const successful = createContext({
  startState: { runId: 'SYNCOPS-20260824T120000Z-AAAA1111', status: 'RUNNING' },
  currentStates: [
    {
      runId: 'SYNCOPS-20260824T120000Z-AAAA1111',
      status: 'SUCCEEDED',
      result: 'Current operational demand successfully synchronized and is visible through API 5052.'
    },
    {
      runId: 'SYNCOPS-20260824T120000Z-AAAA1111',
      status: 'SUCCEEDED',
      result: 'Current operational demand successfully synchronized and is visible through API 5052.'
    }
  ]
});
await successful.context.window.startSyncOperations();
assert.equal(successful.refreshCalls, 0, 'starting a running sync does not reload early');
await successful.runNextTimer();
await settle();
assert.equal(successful.refreshCalls, 1, 'successful Sync Operations invokes the shared Reload View path once');
await successful.context.window.refreshSyncOperationsStatus();
await settle();
assert.equal(successful.refreshCalls, 1, 're-rendering the same successful run does not duplicate the reload');

const failed = createContext({
  startState: { runId: 'SYNCOPS-20260824T120100Z-BBBB2222', status: 'RUNNING' },
  currentStates: [
    { runId: 'SYNCOPS-20260824T120100Z-BBBB2222', status: 'FAILED', result: 'Daily operational synchronization returned FAILED_NOT_PROMOTED.' }
  ]
});
await failed.context.window.startSyncOperations();
await failed.context.window.refreshSyncOperationsStatus();
await settle();
assert.equal(failed.refreshCalls, 0, 'failed Sync Operations does not auto-reload Operations Center');

const oldSuccess = createContext({
  currentStates: [
    { runId: 'SYNCOPS-20260823T120000Z-CCCC3333', status: 'SUCCEEDED', result: 'Already complete.' }
  ]
});
await oldSuccess.context.window.refreshSyncOperationsStatus();
await settle();
assert.equal(oldSuccess.refreshCalls, 0, 'page-load view of a previous successful run does not auto-reload');

const manual = createContext();
await manual.context.window.refreshOperationsCenterCanonicalData();
assert.equal(manual.refreshCalls, 1, 'manual Reload View still uses the shared canonical refresh path');

console.log('Operations Center Sync Operations reload contracts: PASS');
