import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

class Element {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.offsetParent = {};
    this.attributes = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  focus() {}
}

const elements = new Map([
  'shippingShipmentStaging', 'shippingShipmentStagingTable', 'shippingShipmentStagingStatus',
  'shippingShipmentStagingRefreshButton', 'shippingShipmentStagingCount',
  'shippingShipmentStagingSearch', 'shippingShipmentStagingStatusFilter',
  'shippingWorkspaceStatus', 'shippingQueue', 'shippingQueueCount', 'shippingPrintQueueButton',
  'packingQueue', 'packingQueueCount', 'shippingSelectedRequest',
  'shippingCreateRequestToShipButton', 'shippingAcceptRequestButton',
  'shippingReturnToOperationsButton', 'shippingPrintRequestToShipButton',
  'shippingShipmentProcessedButton'
].map(id => [id, new Element(id)]));
const mount = new Element('shippingMount');
mount.dataset.workspaceLoaded = 'true';
const subscribers = [];
let operationalReads = 0;
let createCalls = 0;
let selectedShipment = '';
let reviewOpened = 0;

const meggitt = {
  shipmentStagingId: 'staging-guid', shipmentId: 'SHP-20260805-5AA4FE93',
  processedTimestamp: '2026-08-05T23:05:00Z', customerNumber: '001037',
  customerName: 'Meggitt N. Hollywood', salesOrder: '0012087', salesOrderLine: '010',
  itemNumber: 'TEST-PART', quantityShipped: 100, status: 'AWAITING_ERP_EVIDENCE',
  operationalStatus: 'AWAITING_ERP_EVIDENCE', workOrder: '', directFulfillment: true,
  workOrderRelationshipSource: 'NO_WORK_ORDER_REQUIRED'
};
const shipmentStagingState = { records: [meggitt], lastUpdated: '2026-08-05T23:05:00Z' };
const document = {
  body: { dataset: { workspaceView: 'shipping' } },
  getElementById(id) { return elements.get(id) || null; },
  querySelector(selector) { return selector === '[data-workspace-mount="shipping"]' ? mount : null; },
  querySelectorAll(selector) {
    if (selector === '#shippingShipmentStagingTable tbody tr' &&
        elements.get('shippingShipmentStagingTable').innerHTML.includes(meggitt.shipmentId)) {
      const row = new Element('staging-row');
      row.dataset.status = meggitt.operationalStatus;
      row.textContent = Object.values(meggitt).join(' ');
      return [row];
    }
    return [];
  },
  addEventListener() {}
};
const window = {
  location: { port: '5051' },
  DleApiClient: {
    subscribeOperationalLineStateChange(handler) { subscribers.push(handler); return () => {}; },
    createShipmentStaging() { createCalls += 1; }
  },
  usesOperationalShipmentStaging() { return true; },
  async refreshOperationalShipmentStaging() { operationalReads += 1; return shipmentStagingState.records; },
  getShipmentStagingDisplayLines(records) { return records.map(record => ({ ...record })); },
  selectShipmentStagingTransaction(_event, id) { selectedShipment = id; },
  openShipmentStagingReview() { reviewOpened += 1; },
  DleWorkspaces: {}
};
const context = vm.createContext({
  window, document, shipmentStagingState, console,
  fetch() { throw new Error('Shipping activation must not fetch legacy JSON or a duplicate template.'); },
  setTimeout, clearTimeout
});
vm.runInContext(read('SRC/modules/shipping/shipping-workspace.js'), context);

assert.equal(window.DleWorkspaces.shipping, window.ShippingWorkspace,
  'Shipping Workspace is registered under the Workspace View id');
await window.DleWorkspaces.shipping.render();
assert.equal(operationalReads, 1, 'direct activation refreshes the authoritative operational read model');
assert.match(elements.get('shippingShipmentStagingTable').innerHTML, /SHP-20260805-5AA4FE93/,
  'direct activation renders the existing Meggitt shipment');
assert.match(elements.get('shippingShipmentStagingTable').innerHTML, /0012087/);
assert.match(elements.get('shippingShipmentStagingTable').innerHTML, /AWAITING_ERP_EVIDENCE/);
assert.equal(createCalls, 0, 'loading the workspace never creates a duplicate shipment');

window.ShippingWorkspace.enqueueRequest({ requestId: 'OPERATIONS-HANDOFF' });
assert.match(elements.get('shippingShipmentStagingTable').innerHTML, /SHP-20260805-5AA4FE93/,
  'Operations handoff does not replace the staging population');
window.acceptShippingRequest();
assert.equal(window.ShippingWorkspace.getState().requests.length, 0,
  'accepting a request still removes it from the Shipping queue');
assert.equal(window.ShippingWorkspace.getState().packingRequests[0].status, 'Packing',
  'accepting a request still advances Shipping-owned developmental state to Packing');

shipmentStagingState.records = [];
window.ShippingWorkspace.renderShipmentStaging();
assert.match(elements.get('shippingShipmentStagingTable').innerHTML, /Shipment Staging is empty/,
  'an empty authoritative population has a valid empty state');

const serviceError = new Error('5054 unavailable');
serviceError.requestId = 'request-5054';
window.refreshOperationalShipmentStaging = async () => { operationalReads += 1; throw serviceError; };
await window.ShippingWorkspace.refreshShipmentStaging();
assert.match(elements.get('shippingShipmentStagingStatus').textContent, /5054 unavailable/);
assert.match(elements.get('shippingShipmentStagingStatus').textContent, /request-5054/,
  'API failures expose their request id');
assert.equal(elements.get('shippingWorkspaceStatus').textContent, 'Operational data unavailable',
  'an offline operational service never leaves Shipping looking Ready');
assert.equal(elements.get('shippingShipmentStagingCount').textContent, 'Unavailable');
assert.equal(elements.get('shippingQueueCount').textContent, 'Unavailable');
assert.equal(elements.get('packingQueueCount').textContent, 'Unavailable');
assert.match(elements.get('shippingShipmentStagingTable').innerHTML, /counts cannot be trusted/);
assert.match(elements.get('shippingQueue').innerHTML, /operational queue data is unavailable/);
assert.equal(elements.get('shippingAcceptRequestButton').disabled, true);
assert.equal(elements.get('shippingShipmentProcessedButton').disabled, true,
  '5054-backed Shipping actions fail closed');

window.refreshOperationalShipmentStaging = async () => { operationalReads += 1; return shipmentStagingState.records; };
shipmentStagingState.records = [meggitt];
subscribers[0]({ source: 'shipment-staging-read-model-change' });
assert.match(elements.get('shippingShipmentStagingTable').innerHTML, /SHP-20260805-5AA4FE93/,
  'shared state events update an already-open workspace');
assert.equal(elements.get('shippingWorkspaceStatus').textContent, 'Ready',
  'a healthy operational state event restores normal Shipping presentation');
assert.equal(elements.get('shippingShipmentStagingCount').textContent, '1 shipment');

window.openShippingShipmentStagingReview({
  currentTarget: { dataset: { shipmentId: meggitt.shipmentId } }, stopPropagation() {}
});
assert.equal(selectedShipment, meggitt.shipmentId);
assert.equal(reviewOpened, 1, 'workspace review uses the governed Shipment Staging review action');

const serviceSource = read('SRC/modules/shipment-staging/shipment-staging-service.js');
assert.match(read('SRC/shell/workspace-registry.js'), /id: "shipping",\s+label: "Shipping Workspace"/,
  'Workspace View presents the requested Shipping Workspace label');
assert.match(serviceSource, /DleOsRuntimeConfig\?\.environment === 'ISOLATED_DEVELOPMENT'/,
  'Shipment Staging uses the shared development-runtime identity instead of a port heuristic');
assert.match(serviceSource, /DleApiClient\.getShipmentStaging/);
assert.match(serviceSource, /if \(usesOperationalShipmentStaging\(\)\) return null;/,
  'isolated development bypasses browser-held file handles');
assert.match(read('SRC/api/dle-api-client.js'), /IS_DEVELOPMENT_RUNTIME[\s\S]*?DEVELOPMENT_BFF_BASE_URL/,
  'the authenticated development frontend uses its same-origin BFF');
assert.doesNotMatch(read('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/appsettings.json'), /5054/,
  'the browser is not configured to call the operational service directly');

console.log('Shipping Workspace standalone operational staging contract: PASS');
