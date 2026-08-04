import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const sql = read('Tools/WorkOrderApproval/Database/001_AddSalesOrderLineWorkOrderDecision.sql');
const server = read('Tools/LiveSnapshotRefresh/ControlHost/WorkOrderApprovalCenter.cs');
const program = read('Tools/LiveSnapshotRefresh/ControlHost/Program.cs');
const client = read('SRC/api/dle-api-client.js');
const dashboard = read('SRC/modules/sales-order-dashboard/sales-order-dashboard.js');
const html = read('SRC/modules/sales-order-dashboard/sales-order-dashboard.html');

// SQL append-only and current-state contract.
assert.match(sql, /operational\.SalesOrderLineWorkOrderDecisionEvent/);
assert.match(sql, /DecisionSequence bigint IDENTITY/);
assert.match(sql, /APPROVE.*REPLACE.*REVOKE/s);
assert.match(sql, /SupersedesDecisionId/);
assert.match(sql, /vw_CurrentSalesOrderLineWorkOrderDecision/);
assert.match(sql, /EventRank = 1/);
assert.match(sql, /INSTEAD OF UPDATE, DELETE/);
assert.match(sql, /events are append-only/);
assert.match(sql, /CandidateSetHash/);
assert.match(sql, /CandidateSetJson/);
assert.match(sql, /CandidateSnapshotIdAtDecision/);
assert.match(sql, /RequestCorrelationId/);
assert.doesNotMatch(sql, /FOREIGN KEY[^;]*canonical\./s);

// Governed 5043 security, API, validation, and concurrency contract.
assert.match(program, /MapWorkOrderApprovals\("SnapshotRefreshOperator"\)/);
assert.match(program, /RequireAuthenticatedUser/);
assert.match(program, /authorizedOperator/);
for (const action of ['approve', 'replace', 'revoke']) assert.match(server, new RegExp('"' + action + '"'));
assert.match(server, /RequireAuthorization\(policy\)/);
assert.match(server, /context\.User\.Identity!\.Name/);
assert.match(server, /SYSUTCDATETIME\(\)/);
assert.doesNotMatch(server, /request\.ApprovedBy|request\.ApprovedAt/);
assert.match(server, /stale_relationship_evidence/);
assert.match(server, /current_decision_changed/);
assert.match(server, /StatusCodes\.Status409Conflict|new\(409/);
assert.match(server, /candidate set|CandidateSetHash/i);
assert.match(server, /sourceSnapshotId/);
assert.match(server, /candidateEvidence/);
assert.match(server, /canonical_work_order_missing/);
assert.match(server, /sales_order_line_not_found/);
assert.match(server, /work_order_outside_current_evidence/);
assert.match(server, /decision_reason_required/);
assert.match(server, /malformed_identifier/);
assert.match(server, /UseDefaultCredentials = true/);
assert.match(server, /api\/platform\/live\/v1\/sales-order-work-order-relationships/);
assert.doesNotMatch(server, /INSERT\s+canonical\.|UPDATE\s+canonical\.|DELETE\s+canonical\./i);

// Client stays on the exact governed control origin and sends credentials.
assert.match(client, /LIVE_SNAPSHOT_REFRESH_BASE_URL/);
assert.match(client, /api\/work-order-approvals\/v1/);
assert.match(client, /credentials: 'include'/);
assert.match(client, /getWorkOrderApprovalReview/);
assert.match(client, /submitWorkOrderApprovalAction/);

// Dashboard classification and action gating.
const context = vm.createContext({
  console,
  document: { addEventListener() {}, getElementById() { return null; } },
  window: {}
});
vm.runInContext(dashboard, context);
const api = context.window.SalesOrderDashboard;
const row = {
  official: {
    customerNumber: '001082', salesOrder: '0011998', sequenceLine: '040',
    workOrderRelationship: {
      status: 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE', candidateCount: 1,
      candidates: [{ workOrderNumber: '0115505' }]
    }
  }
};
const state = api.getState();
function present(classification, workOrder = '0115505') {
  state.approvalReviews.set('001082|0011998|040', {
    currentApproval: { approvedWorkOrderNumber: workOrder },
    conflictClassification: classification
  });
  return api.getWorkOrderPresentation(row);
}
assert.deepEqual(
  [present('APPROVED_AGREES_EXACT').primary, present('APPROVED_AGREES_EXACT').secondary],
  ['0115505', 'Approved · ERP Agrees']
);
assert.equal(present('APPROVED_SUPPORTED_CANDIDATE').actionable, true);
assert.equal(present('APPROVED_SUPPORTED_CANDIDATE').secondary, 'Approved · Candidate Supported');
for (const [classification, label] of [
  ['APPROVED_CONFLICTS_EXACT', 'Approved · ERP Conflict'],
  ['APPROVED_NOT_IN_CURRENT_CANDIDATES', 'Approved · Unsupported'],
  ['APPROVED_WORK_ORDER_MISSING', 'Approved · WO Missing'],
  ['APPROVED_WITH_CURRENT_AMBIGUITY', 'Approved · Ambiguous']
]) {
  const result = present(classification);
  assert.equal(result.secondary, label);
  assert.equal(result.actionable, false);
}
state.approvalReviews.clear();
assert.equal(api.getWorkOrderPresentation(row).secondary, 'Candidate');
assert.equal(api.getWorkOrderPresentation(row).actionable, false);

assert.match(html, /Work Order Relationship Review/);
assert.match(dashboard, /workOrderApprovalChoice/);
assert.match(html, /Decision reason/);
assert.match(html, /Replace Approval/);
assert.match(html, /Revoke Approval/);
assert.match(dashboard, /error\.status === 409/);
assert.match(dashboard, /Evidence changed\. Reloading/);
assert.match(dashboard, /openSalesOrderDashboardWorkOrder/);
assert.match(dashboard, /updateRequestToShipAction/);

console.log('WORKORDER-APPROVAL-001 governed contract: PASS');
