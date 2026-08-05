import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scripts = [
  'SRC/modules/operations-center/operations-center-fields.js',
  'SRC/modules/operations-center/operations-overlay-schema.js',
  'SRC/modules/operations-center/operations-center-state.js',
  'SRC/modules/operations-center/operations-center-data-service.js',
  'SRC/modules/operations-center/operations-center-view-model.js'
];

function canonicalRow(overrides = {}) {
  return {
    salesOrderLineId: '1234560001234010',
    orderDate: '2026-07-01',
    customerNumber: '123456',
    customerName: 'Test Customer',
    customerPurchaseOrderNumber: 'PO-1',
    salesOrderNumber: '0001234',
    lineNumber: '010',
    itemNumber: 'ITEM-1',
    description: 'Test item',
    estimatedShipDate: '2026-08-01',
    quantityOrdered: 3.5,
    erpQuantityOpen: 3.5,
    unitPrice: 12.25,
    extendedPrice: 42.875,
    workOrderNumber: '0012345',
    ...overrides
  };
}

const apiRows = [
  canonicalRow(),
  canonicalRow({
    salesOrderLineId: '1234560001234020',
    lineNumber: '020',
    quantityOrdered: -1,
    erpQuantityOpen: -1
  })
];
const calls = [];
const relationshipCalls = [];
const context = vm.createContext({
  console,
  AbortController,
  DOMException,
  structuredClone,
  setTimeout,
  clearTimeout,
  window: {
    OperationsCenter: {},
    DleApiClient: {
      async getRmaReworkCases() {
        return { items: [], totalItems: 0 };
      },
      async getWorkOrderApprovalReview() {
        return { currentApproval: null };
      },
      liveCanonical: {
        async getCanonicalSalesOrders(options) {
          calls.push(options);
          const index = options.page - 1;
          return {
            items: [apiRows[index]],
            page: options.page,
            pageSize: options.pageSize,
            totalItems: 2,
            totalPages: 2,
            hasNextPage: options.page === 1
          };
        },
        async getCanonicalSalesOrderWorkOrderRelationships(options) {
          relationshipCalls.push(options);
          const exact = {
            customerNumber: '123456',
            salesOrderNumber: '0001234',
            salesOrderLineNumber: '010',
            salesOrderItemNumber: 'ITEM-1',
            anchorSalesOrderLine: '010',
            actionableWorkOrderNumber: '0012345',
            resolutionStatus: 'EXACT_LINE_UNIQUE',
            resolutionBasis: 'CUSTOMER+SALES_ORDER+SALES_ORDER_LINE',
            candidateCount: 1,
            candidates: [{
              workOrderNumber: '0012345',
              itemNumber: 'ITEM-1',
              scheduledProductionQuantity: 20,
              anchorSalesOrderLine: '010',
              relationshipSource: 'WOE03_B+WOE01_DIRECT'
            }]
          };
          const unresolved = {
            customerNumber: '123456',
            salesOrderNumber: '0001234',
            salesOrderLineNumber: '020',
            salesOrderItemNumber: 'ITEM-1',
            resolutionStatus: 'UNRESOLVED',
            resolutionBasis: 'NO_SUPPORTED_RELATIONSHIP',
            candidateCount: 0,
            candidates: []
          };
          return {
            items: options.page === 1 ? [exact] : [unresolved],
            page: options.page,
            pageSize: options.pageSize,
            totalItems: 2,
            totalPages: 2,
            hasNextPage: options.page === 1
          };
        }
      }
    },
    shipmentStagingState: { records: [] }
  }
});

for (const script of scripts) {
  vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context, { filename: script });
}

const oc = context.window.OperationsCenter;
const result = await oc.dataService.loadCanonicalRows();
assert.equal(calls.length, 2, 'all canonical pages are fetched');
assert.deepEqual(calls.map(call => call.page), [1, 2]);
assert.deepEqual(relationshipCalls.map(call => call.page), [1, 2]);
assert.equal(result.rows.length, 2);
assert.equal(result.rows[0].salesOrderLineId, apiRows[0].salesOrderLineId, 'canonical identity is preserved');
assert.equal(result.rows[0].masterRecordKey, '123456|0001234|010', 'compatibility identity is preserved');
assert.equal(result.rows[0].quantityOrdered, 3.5);
assert.equal(result.rows[0].erpQuantityOpen, 3.5);
assert.equal(result.rows[1].erpQuantityOpen, -1, 'negative ERP quantity is preserved');
assert.equal(result.rows[0].dle.operationalStatus, '', 'canonical records default operational status to blank');
assert.equal(result.rows[0].workOrderNumber, '0012345', 'exact governed relationship is actionable');
assert.equal(result.rows[1].workOrderNumber, '', 'unresolved relationship never uses the raw scalar');
assert.equal(result.rows[1].workOrderRelationship.status, 'UNRESOLVED');

context.window.DleApiClient.liveCanonical.getCanonicalSalesOrders = async options => ({
  items: [],
  page: options.page,
  pageSize: options.pageSize,
  totalItems: 0,
  totalPages: 0,
  hasNextPage: false
});
context.window.DleApiClient.liveCanonical.getCanonicalSalesOrderWorkOrderRelationships = async options => ({
  items: [],
  page: options.page,
  pageSize: options.pageSize,
  totalItems: 0,
  totalPages: 0,
  hasNextPage: false
});
const emptyResult = await oc.dataService.loadCanonicalRows();
assert.equal(emptyResult.rows.length, 0, 'an empty canonical source is a valid loaded state');

const requestId = oc.stateActions.beginCanonicalLoad();
assert.equal(oc.stateActions.commitCanonicalLoad(result, requestId), true);
assert.equal(oc.viewModel.getMasterRecords().length, 2);
assert.equal(oc.viewModel.getOfficialField(result.rows[0], 'operationalStatus'), '');
const failedRefreshId = oc.stateActions.beginCanonicalLoad();
assert.equal(oc.stateActions.failCanonicalLoad(new Error('refresh unavailable'), failedRefreshId), true);
assert.equal(oc.state.canonicalRows.length, 2, 'a refresh failure preserves the last loaded canonical rows');
assert.equal(oc.state.canonicalStale, true, 'a refresh failure marks preserved canonical rows stale');

context.window.shipmentStagingState.records = [{
  status: 'Pending Invoice',
  customerNumber: '123456',
  salesOrder: '0001234',
  salesOrderLine: '010',
  quantityShipped: 1.25
}];
assert.equal(oc.viewModel.getOfficialField(result.rows[0], 'quantityOrdered'), '3.5');
assert.equal(oc.viewModel.getOfficialField(result.rows[0], 'erpQtyOpen'), '3.5');
assert.equal(oc.viewModel.getOfficialField(result.rows[0], 'pendingInvoiceQty'), '1.25');
assert.equal(oc.viewModel.getOfficialField(result.rows[0], 'opQtyOpen'), '2.25', 'OP Qty Open subtracts Pending Invoice once');
assert.equal(oc.viewModel.getOfficialField(result.rows[1], 'opQtyOpen'), '0', 'OP Qty Open floors negative results at zero');

assert.equal(oc.viewModel.setPackingOperationalStatus(result.rows[0].masterRecordKey), true);
assert.equal(oc.viewModel.getOfficialField(result.rows[0], 'operationalStatus'), 'Packing');
assert.equal(oc.state.dirty, true, 'workflow-owned status is stored as an overlay change');
const pending = oc.stateActions.buildPendingOverlayByKey();
assert.equal(pending[result.rows[0].masterRecordKey].operationalStatus, 'Packing');

const viewModelText = fs.readFileSync(path.join(root, 'SRC/modules/operations-center/operations-center-view-model.js'), 'utf8');
const apiClientText = fs.readFileSync(path.join(root, 'SRC/api/dle-api-client.js'), 'utf8');
assert.doesNotMatch(viewModelText, /dleMasterData|legacy Master Data/i, 'Operations Center view model no longer reads legacy Master Data');
assert.doesNotMatch(viewModelText, /erpQuantityOpen\s*=|quantityOrdered\s*-/, 'ERP Qty Open is not derived in Operations Center');
assert.match(apiClientText, /window\.location\.hostname \+ ':5052'/, 'development canonical API uses the active page hostname');

console.log('OPERATIONAL-MASTER-DATA-SQL-001 Phase 2 module contract: PASS');
