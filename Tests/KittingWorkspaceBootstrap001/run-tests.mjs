import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(
  path.join(root, 'SRC', 'workspaces', 'kitting', 'kitting-workspace.js'), 'utf8');

function createHarness(fetchImplementation) {
  const buttonHandlers = new Map();
  const mount = {
    dataset: {},
    innerHTML: '',
    querySelector(selector) {
      const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
      if (attribute && !this.innerHTML.includes(attribute)) return null;
      return {
        addEventListener(eventName, handler) {
          buttonHandlers.set(selector + ':' + eventName, handler);
        }
      };
    }
  };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        dataset: {},
        innerHTML: '',
        textContent: '',
        value: '',
        classList: { toggle() {} }
      });
    }
    return elements.get(id);
  };
  let reloadCount = 0;
  let assignedLocation = '';
  const context = {
    AbortController,
    console: { error() {} },
    fetch: fetchImplementation,
    document: {
      querySelector(selector) {
        return selector === '[data-workspace-mount="kitting"]' ? mount : null;
      },
      querySelectorAll() { return []; },
      getElementById: element
    },
    window: {
      setTimeout,
      clearTimeout,
      location: {
        reload() { reloadCount += 1; },
        assign(value) { assignedLocation = value; }
      },
      DleWorkspaces: {},
      DleApiClient: {
        getRmaReworkCases: async () => ({ items: [], totalItems: 0 }),
        getWorkOrderApprovalReview: async () => ({}),
        getKittingDisposition: async () => ({}),
        liveCanonical: { getCanonicalWorkOrders: async () => ({ items: [], totalItems: 0 }) }
      },
      OperationsCenter: {
        dataService: { loadCanonicalRows: async () => ({ rows: [] }) },
        viewModel: {}
      },
      KittingReadModel: {
        PRIMARY_QUEUES: {
          NOT_CLASSIFIED: 'NOT_CLASSIFIED', NEEDS_RESOLUTION: 'NEEDS_RESOLUTION',
          NEEDS_KITTING: 'NEEDS_KITTING', KIT_SHORT: 'KIT_SHORT',
          KIT_COMPLETE: 'KIT_COMPLETE', RMA_REWORK: 'RMA_REWORK'
        },
        collectActionableWorkOrderNumbers: () => [],
        buildReadModel: () => ({
          counts: {},
          queues: {
            notClassified: [], needsResolution: [], needsKitting: [],
            kitShort: [], kitComplete: [], rmaRework: []
          }
        })
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    context, mount, buttonHandlers,
    get reloadCount() { return reloadCount; },
    get assignedLocation() { return assignedLocation; }
  };
}

{
  let calls = 0;
  const harness = createHarness(async () => {
    calls += 1;
    throw new TypeError('Failed to fetch');
  });
  await harness.context.window.DleWorkspaces.kitting.render();
  assert.equal(calls, 2, 'a transient template failure receives one bounded retry');
  assert.match(harness.mount.innerHTML, /Kitting Workspace could not start/);
  assert.match(harness.mount.innerHTML, /deployment may have interrupted the active session/);
  assert.equal(harness.mount.dataset.workspaceLoaded, 'false');
  assert.equal(harness.buttonHandlers.has('[data-kitting-bootstrap-retry]:click'), true);
  assert.equal(harness.buttonHandlers.has('[data-kitting-bootstrap-reload]:click'), true);
}

{
  let calls = 0;
  const harness = createHarness(async () => {
    calls += 1;
    return {
      ok: false,
      status: 403,
      headers: { get: name => name === 'X-DLE-OS-Authentication-Required' ? 'true' : null },
      text: async () => ''
    };
  });
  await harness.context.window.DleWorkspaces.kitting.render();
  assert.equal(calls, 1, 'an explicit expired session is not retried');
  assert.match(harness.mount.innerHTML, /session is no longer active/);
  assert.equal(harness.buttonHandlers.has('[data-kitting-bootstrap-retry]:click'), false,
    'expired sessions do not offer a retry that cannot renew authentication');
  harness.buttonHandlers.get('[data-kitting-bootstrap-signin]:click')();
  assert.equal(harness.assignedLocation, '/auth/signin');
  harness.buttonHandlers.get('[data-kitting-bootstrap-reload]:click')();
  assert.equal(harness.reloadCount, 1, 'reload action returns through the governed auth flow');
}

{
  let calls = 0;
  const harness = createHarness(async () => {
    calls += 1;
    if (calls <= 2) throw new TypeError('simulated bootstrap outage');
    return { ok: true, status: 200, text: async () => '<section>Recovered Kitting</section>' };
  });
  await harness.context.window.DleWorkspaces.kitting.render();
  assert.match(harness.mount.innerHTML, /Retry Kitting/);
  harness.buttonHandlers.get('[data-kitting-bootstrap-retry]:click')();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(calls, 3, 'Retry Kitting issues a fresh template request');
  assert.equal(harness.mount.dataset.workspaceLoaded, 'true');
  assert.match(harness.mount.innerHTML, /Recovered Kitting/);
}

{
  let calls = 0;
  const harness = createHarness(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('connection reset');
    return { ok: true, status: 200, text: async () => '<section>Kitting loaded</section>' };
  });
  await harness.context.window.DleWorkspaces.kitting.render();
  assert.equal(calls, 2);
  assert.equal(harness.mount.dataset.workspaceLoaded, 'true');
  assert.match(harness.mount.innerHTML, /Kitting loaded/);
}

assert.match(source, /credentials:\s*"same-origin"/);
assert.match(source, /TEMPLATE_FETCH_TIMEOUT_MS/);
assert.match(source, /finally\s*\{\s*window\.clearTimeout/);

console.log('Kitting workspace bootstrap retry, timeout, session recovery, and success contracts: PASS');
