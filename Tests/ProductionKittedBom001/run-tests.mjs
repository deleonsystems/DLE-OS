import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dashboardSource = fs.readFileSync(
  path.join(root, 'SRC', 'modules', 'work-order-dashboard', 'work-order-dashboard.js'), 'utf8');
const dashboardMarkup = fs.readFileSync(
  path.join(root, 'SRC', 'modules', 'work-order-dashboard', 'work-order-dashboard.html'), 'utf8');
const dashboardStyles = fs.readFileSync(
  path.join(root, 'SRC', 'modules', 'work-order-dashboard', 'work-order-dashboard.css'), 'utf8');
const kittingDocumentService = fs.readFileSync(
  path.join(root, 'Tools', 'DevelopmentRuntime', 'DleOs.DevelopmentFrontend', 'KittingDocumentService.cs'), 'utf8');

const element = initial => ({ hidden: false, disabled: false, textContent: '', dataset: {}, ...initial });
const elements = new Map([
  ['workOrderDashboardModule', element()],
  ['workOrderDashboardModuleStatus', element()],
  ['workOrderDashboardKittedBomPlaceholder', element({ disabled: true })],
  ['workOrderDashboardKittedBomPlaceholderLabel', element()],
  ['workOrderDashboardKittedBomPlaceholderMessage', element()],
  ['workOrderDashboardKittedBomEvidence', element({ hidden: true })],
  ['workOrderDashboardKittedBomStatus', element()],
  ['workOrderDashboardKittedBomFilename', element()],
  ['workOrderDashboardKittedBomFolder', element()],
  ['workOrderDashboardKittedBomPriorShortage', element()],
  ['workOrderDashboardKittedBomMessage', element()],
  ['workOrderDashboardKittedBomOpenPrimary', element({ disabled: true })],
  ['workOrderDashboardKittedBomOpenPrior', element({ hidden: true, disabled: true })]
]);

const evidenceByWorkOrder = {
  '0115244': {
    displayLabel: 'Kit Complete — Prior Shortage',
    primaryDocument: {
      documentType: 'complete', fileName: '0115244.pdf', folder: 'KIT-COMPLETE',
      openUrl: '/api/development/kitting-documents/v1/work-orders/0115244/documents/complete'
    },
    secondaryPriorShortageDocument: {
      documentType: 'shortage', fileName: '0115244.pdf', folder: 'KIT-SHORTAGES',
      openUrl: '/api/development/kitting-documents/v1/work-orders/0115244/documents/shortage'
    },
    priorShortageEvidenceExists: true
  },
  '0115620': {
    displayLabel: 'Kit Short',
    primaryDocument: {
      documentType: 'shortage', fileName: '0115620.pdf', folder: 'KIT-SHORTAGES',
      openUrl: '/api/development/kitting-documents/v1/work-orders/0115620/documents/shortage'
    },
    secondaryPriorShortageDocument: null,
    priorShortageEvidenceExists: false
  },
  '0115999': {
    displayLabel: 'Kit Short',
    primaryDocument: {
      documentType: 'shortage', fileName: '0115999.pdf', folder: 'KIT-SHORTAGES',
      openUrl: '/api/development/kitting-documents/v1/work-orders/0115999/documents/shortage'
    },
    secondaryPriorShortageDocument: null,
    priorShortageEvidenceExists: false
  }
};
const statusByWorkOrder = {
  '0115244': { machineValue: 'KIT_COMPLETE', label: 'Kit Complete' },
  '0115620': { machineValue: 'KIT_SHORT', label: 'Kit Short' },
  '0115998': { machineValue: 'KIT_COMPLETE', label: 'Kit Complete' },
  '0115999': { machineValue: 'KIT_COMPLETE', label: 'Kit Complete' }
};
const fetches = [];
const opened = [];
const context = {
  window: {
    OperationsCenter: {},
    MaterialStatus: {
      normalizeWorkOrderNumber: value => String(value || ''),
      get: async workOrder => statusByWorkOrder[workOrder] || null
    },
    open(url, target, features) { opened.push({ url, target, features }); }
  },
  document: {
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll() { return []; }
  },
  fetch: async url => {
    fetches.push(url);
    const workOrder = String(url).split('/').pop();
    return { ok: !!evidenceByWorkOrder[workOrder], json: async () => evidenceByWorkOrder[workOrder] };
  },
  structuredClone: value => JSON.parse(JSON.stringify(value)),
  console
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(dashboardSource, context);
const dashboard = context.window.WorkOrderDashboardModule;

function handoff(workOrderNumber, machineValue) {
  return {
    canonicalWorkOrder: { workOrderNumber },
    workOrderNumber,
    governingSource: 'EXACT',
    preferredDashboardView: 'production',
    preferredPresentation: 'dashboard',
    materialStatusProjection: statusByWorkOrder[workOrderNumber] || { machineValue, label: machineValue },
    originRow: { official: { workOrder: workOrderNumber } },
    relatedRows: []
  };
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

dashboard.setSelectedWorkOrder(handoff('0115244', 'KIT_COMPLETE'));
await settle();
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholder').disabled, false);
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholderLabel').textContent, 'Kit Complete');
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholderMessage').textContent, 'Open Kitted BOM');
assert.equal(elements.get('workOrderDashboardKittedBomEvidence').hidden, true);
assert.equal(fetches.at(-1), '/api/development/kitting-documents/v1/work-orders/0115244');
assert.equal(dashboard.openProductionKittedBom(), true);
assert.equal(opened.at(-1).url, evidenceByWorkOrder['0115244'].primaryDocument.openUrl);

dashboard.setSelectedWorkOrder(handoff('0115620', 'KIT_SHORT'));
await settle();
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholderLabel').textContent, 'Kit Short');
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholderMessage').textContent, 'Open Kitted BOM');
assert.equal(fetches.at(-1), '/api/development/kitting-documents/v1/work-orders/0115620');
assert.equal(dashboard.openProductionKittedBom(), true);
assert.equal(opened.at(-1).url, evidenceByWorkOrder['0115620'].primaryDocument.openUrl);

dashboard.setSelectedWorkOrder(handoff('0115998', 'KIT_COMPLETE'));
await settle();
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholderLabel').textContent, 'Kit Complete');
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholderMessage').textContent, 'Kitted BOM unavailable');
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholder').disabled, true);
assert.equal(dashboard.openProductionKittedBom(), false);

dashboard.setSelectedWorkOrder(handoff('0115999', 'KIT_COMPLETE'));
await settle();
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholderLabel').textContent, 'Kit Complete');
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholderMessage').textContent, 'Kitted BOM unavailable');
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholder').disabled, true);
assert.equal(dashboard.openProductionKittedBom(), false,
  'Production must not open stale evidence for a different Material Status');

const kittingHandoff = handoff('0115620', 'KIT_SHORT');
kittingHandoff.preferredDashboardView = 'standard';
kittingHandoff.preferredPresentation = 'kitting-job';
dashboard.setSelectedWorkOrder(kittingHandoff);
await settle();
assert.equal(elements.get('workOrderDashboardKittedBomPlaceholder').hidden, true);
assert.equal(elements.get('workOrderDashboardKittedBomEvidence').hidden, false);
assert.equal(elements.get('workOrderDashboardKittedBomStatus').textContent, 'Kit Short');
assert.equal(elements.get('workOrderDashboardKittedBomFilename').textContent, '0115620.pdf');
assert.equal(elements.get('workOrderDashboardKittedBomFolder').textContent, 'KIT-SHORTAGES');
assert.equal(elements.get('workOrderDashboardKittedBomOpenPrimary').disabled, false);

const standardHandoff = handoff('0115620', 'KIT_SHORT');
standardHandoff.preferredDashboardView = 'standard';
dashboard.setSelectedWorkOrder(standardHandoff);
assert.equal(dashboard.openProductionKittedBom(), false);
assert.equal(dashboard.openKittedBom('primary'), false);

assert.match(dashboardMarkup, /onclick="openWorkOrderDashboardProductionKittedBom\(\)"/);
assert.ok(
  dashboardMarkup.indexOf('id="workOrderDashboardKittedBomPlaceholder"') <
    dashboardMarkup.indexOf('id="workOrderDashboardReleasedBom"'),
  'The Production Kitted BOM tile must be the first Manufacturing Documents control');
assert.match(dashboardMarkup, /<dt>Located file<\/dt>/);
assert.doesNotMatch(dashboardMarkup, /workOrderDashboardKittedBomProductionMessage/);
assert.match(dashboardSource, /return openKittedBomDocument\('primary'\)/);
assert.match(dashboardStyles, /data-view-mode="desktop"[^}]*data-dashboard-view="production"[^}]*module-document-grid[^}]*repeat\(3,/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*KittedBomPlaceholder:not\(:disabled\)/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*workOrderDashboardReleasedBom,[\s\S]*?workOrderDashboardKitReleasedBom,[\s\S]*?display:\s*none/);
assert.match(dashboardStyles, /data-dashboard-view="production"[^}]*workOrderDashboardKittedBomPlaceholder[^}]*order:\s*-1/);
assert.match(dashboardSource, /credentials:\s*'same-origin'/);
assert.match(dashboardSource, /cache:\s*'no-store'/);
assert.match(dashboardSource, /kind !== 'primary'/);
assert.doesNotMatch(dashboardSource, /openProductionKittedBomEvidence[\s\S]{0,900}appendKittingDisposition/);
assert.match(kittingDocumentService, /if \(complete is not null && shortage is not null\)/);
assert.match(kittingDocumentService, /if \(complete is not null\)/);
assert.match(kittingDocumentService, /if \(shortage is not null\)/);

console.log('Production Kitted BOM governed Kit Complete/Kit Short read-only presentation: PASS');
