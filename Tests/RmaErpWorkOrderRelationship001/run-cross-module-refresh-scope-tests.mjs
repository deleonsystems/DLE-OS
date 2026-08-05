import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  'SRC/modules/operations-center/operations-center-data-service.js', 'utf8');

const salesOrder = {
  salesOrderLineId: '1000010000010', customerNumber: '100001',
  salesOrderNumber: '0000001', lineNumber: '010', quantityOrdered: 1,
  erpQuantityOpen: 1, unitPrice: 10, extendedPrice: 10,
  itemNumber: 'ITEM-1', customerName: 'Customer', orderDate: '2026-08-05',
  estimatedShipDate: '2026-08-06'
};
const relationship = {
  customerNumber: '100001', salesOrderNumber: '0000001',
  salesOrderLineNumber: '010', salesOrderItemNumber: 'ITEM-1',
  resolutionStatus: 'UNRESOLVED', resolutionBasis: 'NO_SUPPORTED_RELATIONSHIP',
  candidateCount: 0, candidates: []
};
const page = items => ({
  items, page: 1, totalItems: items.length, totalPages: items.length ? 1 : 0,
  hasNextPage: false
});
const delayedPage = (items, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(page(items)), 15);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new DOMException('aborted', 'AbortError'));
  }, { once: true });
});

const context = vm.createContext({
  console, AbortController, DOMException, setTimeout, clearTimeout,
  window: { DleApiClient: {
    liveCanonical: {
      getCanonicalSalesOrders: options => delayedPage([salesOrder], options.signal),
      getCanonicalSalesOrderWorkOrderRelationships: options =>
        delayedPage([relationship], options.signal)
    },
    getRmaReworkCases: async () => ({ items: [], totalItems: 0 }),
    getWorkOrderApprovalReview: async () => ({})
  } }
});
vm.runInContext(source, context);
const load = context.window.OperationsCenter.dataService.loadCanonicalRows;

const [operations, kitting] = await Promise.all([
  load({ requestScope: 'operations-center' }),
  load({ requestScope: 'kitting' })
]);
assert.equal(operations.rows.length, 1,
  'Operations Center refresh completes while Kitting refresh is active');
assert.equal(kitting.rows.length, 1,
  'Kitting refresh completes while Operations Center refresh is active');

const staleKitting = load({ requestScope: 'kitting' });
const currentKitting = load({ requestScope: 'kitting' });
await assert.rejects(staleKitting, error => error?.name === 'AbortError',
  'a newer refresh still cancels stale work inside the same caller scope');
assert.equal((await currentKitting).rows.length, 1);

console.log('Cross-module operational refresh cancellation scopes: PASS');
