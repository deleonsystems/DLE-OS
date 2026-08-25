import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const sql = read('Tools/WorkOrderApproval/Database/001_AddSalesOrderLineWorkOrderDecision.sql');
const reasonMigration = read('Tools/WorkOrderApproval/Database/002_AddGovernedDecisionReasons.sql');
const noWorkOrderMigration = read('Tools/WorkOrderApproval/Database/003_AddNoWorkOrderRequiredDecision.sql');
const server = read('Tools/LiveSnapshotRefresh/ControlHost/WorkOrderApprovalCenter.cs');
const program = read('Tools/LiveSnapshotRefresh/ControlHost/Program.cs');
const client = read('SRC/api/dle-api-client.js');
const dashboard = read('SRC/modules/sales-order-dashboard/sales-order-dashboard.js');
const html = read('SRC/modules/sales-order-dashboard/sales-order-dashboard.html');
const css = read('SRC/modules/sales-order-dashboard/sales-order-dashboard.css');

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
assert.match(reasonMigration, /DecisionReasonCode/);
assert.match(reasonMigration, /DecisionNote/);
assert.match(reasonMigration, /DecisionReasonCode IS NULL/,
  'legacy append-only rows remain valid without rewriting their original reason');
assert.match(reasonMigration, /DecisionReasonCode <> 'OTHER'/);
assert.match(noWorkOrderMigration, /DecisionClassification/);
assert.match(noWorkOrderMigration, /NO_WORK_ORDER_REQUIRED_COMPONENT/);
assert.match(noWorkOrderMigration, /ApprovedWorkOrderNumber IS NULL/);
assert.match(noWorkOrderMigration, /DIRECT_FULFILLMENT|PART_COMPONENT_ONLY/);
assert.doesNotMatch(sql, /FOREIGN KEY[^;]*canonical\./s);

// Governed 5043 security, API, validation, and concurrency contract.
assert.match(program, /MapWorkOrderApprovals\("SnapshotRefreshOperator"\)/);
assert.match(program, /RequireAuthenticatedUser/);
assert.match(program, /authorizedOperator/);
for (const action of ['approve', 'replace', 'approve-no-work-order',
  'replace-no-work-order', 'revoke']) assert.match(server, new RegExp('"' + action + '"'));
assert.match(server, /RequireAuthorization\(policy\)/);
assert.match(server, /TrustedDevelopmentIdentity\.RequireActorName\(context\)/,
  'development decisions use the validated DLE-OS actor rather than the service account');
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
assert.match(server, /decision_reason_code_invalid/);
assert.match(server, /other_decision_note_required/);
assert.match(server, /decisionReasonContract/);
assert.match(server, /DecisionReasonCode/);
assert.match(server, /DecisionNote/);
assert.match(server, /DLE_NO_WORK_ORDER_REQUIRED_REASON_V2/);
assert.match(server, /PART_COMPONENT_ONLY/);
assert.doesNotMatch(server, /new\("PURCHASED_RESALE_ITEM"/);
assert.match(server, /approval_schema_unavailable/);
assert.match(server, /approval_database_write_failed/);
assert.match(server, /approval_concurrency_conflict/);
assert.match(server, /X-Request-ID/);
assert.match(server, /EnsureSchemaReadyAsync/);
assert.match(server, /if \(!ControlHostRuntimeConfiguration\.IsIsolatedDevelopment\)/,
  'isolated 5054 must not query canonical tables inside its operational-only database');
assert.match(server, /canApproveNoWorkOrder/);
assert.match(server, /rma_rework_controls_work_order_decision/);
assert.match(server, /GetActiveMembershipAsync/);
assert.match(server, /canApprove = OperationalAllowsApproval\(operational\) && membership is null/);
assert.match(server, /canReplace = OperationalAllowsApproval\(operational\) && membership is null/);
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
assert.match(client, /approve-no-work-order/);
assert.match(client, /requestError\.requestId/);

// Dashboard classification and action gating.
const context = vm.createContext({
  console,
  document: { addEventListener() {}, getElementById() { return null; } },
  window: {}
});
vm.runInContext(dashboard, context);
const api = context.window.SalesOrderDashboard;
const governedReasons = api.getWorkOrderApprovalReasons();
assert.equal(governedReasons.length, 7);
for (const reason of governedReasons) {
  const result = api.validateWorkOrderApprovalReason(
    reason.code, reason.code === 'OTHER' ? 'Operator explanation' : 'stale text'
  );
  assert.equal(result.valid, true, reason.code + ' validates');
  assert.equal(result.decisionReasonCode, reason.code, reason.code + ' submits its governed code');
  assert.equal(result.decisionNote, reason.code === 'OTHER' ? 'Operator explanation' : null,
    reason.code + ' applies the correct note rule');
}
assert.equal(api.validateWorkOrderApprovalReason('', '').valid, false, 'reason selection is required');
assert.equal(api.validateWorkOrderApprovalReason('OTHER', '   ').valid, false, 'Other rejects whitespace');
assert.equal(api.validateWorkOrderApprovalReason('UNKNOWN', '').valid, false, 'frontend rejects unknown code');
const exactReasonContract = {
  schema: 'DLE_WORK_ORDER_APPROVAL_REASON_V1', otherCode: 'OTHER', options: governedReasons
};
assert.equal(api.hasExactWorkOrderApprovalReasonContract({ decisionReasonContract: exactReasonContract }), true);
assert.equal(api.hasExactWorkOrderApprovalReasonContract({}), false, 'older API fails safely');
assert.equal(api.hasExactWorkOrderApprovalReasonContract({
  decisionReasonContract: { ...exactReasonContract, options: governedReasons.slice(0, -1) }
}), false, 'mismatched API contract fails safely');

const noWorkOrderReasonContract = {
  schema: 'DLE_NO_WORK_ORDER_REQUIRED_REASON_V2', otherCode: 'OTHER', options: [
    { code: 'PART_COMPONENT_ONLY', label: 'Part/Component Only' },
    { code: 'CUSTOMER_SUPPLIED_MATERIAL', label: 'Customer-Supplied Material' },
    { code: 'SHIPPING_REPLACEMENT_MATERIAL_ONLY', label: 'Shipping or Replacement Material Only' },
    { code: 'OTHER', label: 'Other' }
  ]
};
const noWorkOrderReview = { noWorkOrderDecisionReasonContract: noWorkOrderReasonContract };
const noWorkOrderReasons = api.getNoWorkOrderReasons(noWorkOrderReview);
assert.equal(noWorkOrderReasons.map(reason => reason.code).join(','),
  'PART_COMPONENT_ONLY,CUSTOMER_SUPPLIED_MATERIAL,SHIPPING_REPLACEMENT_MATERIAL_ONLY,OTHER');
for (const reason of noWorkOrderReasons) {
  const result = api.validateNoWorkOrderReason(reason.code,
    reason.code === 'OTHER' ? 'Documented exception' : 'stale text', noWorkOrderReview);
  assert.equal(result.valid, true);
  assert.equal(result.decisionNote, reason.code === 'OTHER' ? 'Documented exception' : null);
}
assert.equal(api.validateNoWorkOrderReason('', '', noWorkOrderReview).valid, false);
assert.equal(api.validateNoWorkOrderReason('OTHER', '   ', noWorkOrderReview).valid, false);
assert.equal(api.validateNoWorkOrderReason('PURCHASED_RESALE_ITEM', '', noWorkOrderReview).valid, false);
assert.equal(api.hasExactNoWorkOrderReasonContract(noWorkOrderReview), true);
assert.equal(api.hasExactNoWorkOrderReasonContract({
  noWorkOrderDecisionReasonContract: {
    ...noWorkOrderReasonContract, schema: 'DLE_NO_WORK_ORDER_REQUIRED_REASON_V1'
  }
}), false, 'older five-reason API fails safely');
assert.match(api.formatWorkOrderApprovalFailure({
  code: 'approval_schema_unavailable', requestId: 'request-003'
}), /migration or schema is unavailable[\s\S]*request-003/);
assert.match(api.formatWorkOrderApprovalFailure({ code: 'approval_store_unavailable' }),
  /approval store is unavailable/);
assert.match(api.formatWorkOrderApprovalFailure({ code: 'approval_database_write_failed' }),
  /could not be written[\s\S]*No decision was recorded/);
assert.match(api.formatWorkOrderApprovalFailure({ status: 403 }), /not authorized/);

const reasonElements = {
  workOrderApprovalReasonCode: { value: 'OTHER' },
  workOrderApprovalOtherReasonField: { hidden: true },
  workOrderApprovalOtherReason: { value: 'temporary', disabled: true, required: false }
};
context.document.getElementById = id => reasonElements[id] || null;
context.window.updateWorkOrderApprovalReason();
assert.equal(reasonElements.workOrderApprovalOtherReasonField.hidden, false, 'Other reveals its field');
assert.equal(reasonElements.workOrderApprovalOtherReason.required, true, 'Other field is required');
reasonElements.workOrderApprovalReasonCode.value = 'SUPERVISOR_REVIEW';
context.window.updateWorkOrderApprovalReason();
assert.equal(reasonElements.workOrderApprovalOtherReasonField.hidden, true);
assert.equal(reasonElements.workOrderApprovalOtherReason.value, '', 'changing away clears stale Other text');
assert.match(api.renderApprovalDecisionReasonHistory({
  decisionReasonCode: 'OTHER', decisionNote: 'Supporting email reviewed.'
}), /Other[\s\S]*Supporting email reviewed/);
assert.match(api.renderApprovalDecisionReasonHistory({ decisionReason: 'Legacy fixture reason' }),
  /<strong>Legacy fixture reason<\/strong>/);
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
context.window.OperationsCenter = { state: { operationalEnrichmentAvailable: false } };
const offlinePresentation = api.getWorkOrderPresentation(row);
assert.equal(offlinePresentation.status, 'OPERATIONAL_UNAVAILABLE');
assert.equal(offlinePresentation.primary, '0115505', 'canonical Work Order evidence remains identifiable');
assert.equal(offlinePresentation.secondary, 'Canonical evidence only');
assert.equal(offlinePresentation.actionable, false,
  'canonical Work Order evidence is not treated as an approved operational route');
context.window.OperationsCenter.state.operationalEnrichmentAvailable = true;
assert.equal(api.getWorkOrderPresentation(row).secondary, 'Candidate',
  'healthy 5054 state restores the normal governed review presentation');
state.rmaMemberships.set('001082|0011998|040', {
  caseId: 'case-1', caseReference: 'RMA-123', caseRecord: { caseType: 'CUSTOMER_REWORK' }
});
state.approvalReviews.set('001082|0011998|040', {
  currentApproval: { approvedWorkOrderNumber: '0115505' },
  conflictClassification: 'APPROVED_SUPPORTED_CANDIDATE'
});
const rmaControlled = api.getWorkOrderPresentation(row);
assert.equal(rmaControlled.status, 'RMA_CONTROLLED');
assert.equal(rmaControlled.primary, 'Decision Pending');
assert.equal(rmaControlled.secondary, 'RMA / Rework · RMA-123');
assert.equal(rmaControlled.actionable, false);
state.rmaMemberships.clear();

// King Nutronics 0012090/090 remains fulfillable and shippable without inventing a Work Order.
const kingNutronicsLine090 = {
  official: {
    customerNumber: '001238', salesOrder: '0012090', sequenceLine: '090',
    partNumber: '3666-292-1 REV A', workOrder: '',
    workOrderRelationship: {
      status: 'AMBIGUOUS', candidateCount: 2,
      candidates: [{ workOrderNumber: '0115611' }, { workOrderNumber: '0115612' }]
    }
  }
};
state.approvalReviews.clear();
assert.equal(api.getWorkOrderPresentation(kingNutronicsLine090).secondary, 'Review Required');
state.approvalReviews.set('001238|0012090|090', {
  noWorkOrderDecisionReasonContract: noWorkOrderReasonContract,
  currentApproval: {
    decisionClassification: 'NO_WORK_ORDER_REQUIRED_COMPONENT',
    approvedWorkOrderNumber: null, decisionReasonCode: 'PART_COMPONENT_ONLY'
  },
  operationalRelationship: {
    activeWorkOrderNumber: null, operationalRoute: 'DIRECT_FULFILLMENT',
    operationalStatus: 'NO_WORK_ORDER_REQUIRED', workOrderDecision: 'No Work Order Required',
    reason: 'Part/Component Only', fulfillmentRequired: true, shippingRequired: true,
    productionWorkOrderRequired: false
  }
});
const noWorkOrderPresentation = api.getWorkOrderPresentation(kingNutronicsLine090);
assert.equal(noWorkOrderPresentation.primary, 'No Work Order Required');
assert.equal(noWorkOrderPresentation.secondary, 'Part/Component Only');
assert.equal(noWorkOrderPresentation.actionable, false, 'Work Order navigation remains disabled');
assert.equal(noWorkOrderPresentation.fulfillmentEligible, true, 'shipment workflow remains eligible');
state.approvalReviews.delete('001238|0012090|090');
assert.equal(api.getWorkOrderPresentation(kingNutronicsLine090).secondary, 'Review Required',
  'revocation refresh restores the prior conflict presentation');

// Regression fixture for the development-runtime case reported by the operator.
const salesOrder12015Line040 = {
  official: {
    customerNumber: '549250', salesOrder: '0012015', sequenceLine: '040',
    workOrderRelationship: {
      status: 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE', candidateCount: 1,
      candidates: [{ workOrderNumber: '0115526' }]
    }
  }
};
state.approvalReviews.clear();
const beforeApproval12015 = api.getWorkOrderPresentation(salesOrder12015Line040);
assert.equal(beforeApproval12015.primary, '0115526');
assert.equal(beforeApproval12015.secondary, 'Candidate');
state.approvalReviews.set('549250|0012015|040', {
  currentApproval: { approvedWorkOrderNumber: '0115526' },
  conflictClassification: 'APPROVED_SUPPORTED_CANDIDATE'
});
const afterApproval12015 = api.getWorkOrderPresentation(salesOrder12015Line040);
assert.equal(afterApproval12015.primary, '0115526');
assert.equal(afterApproval12015.secondary, 'Approved · Candidate Supported');
assert.equal(afterApproval12015.actionable, true);

assert.match(html, /Work Order Relationship Review/);
assert.match(html, /salesOrderLineReviewAvailability/);
assert.match(html, /salesOrderLineWorkOrderReviewButton/);
assert.match(dashboard, /Review unavailable/);
assert.match(dashboard, /Operational routing, approval, and RMA\/Rework services are unavailable/);
assert.match(dashboard, /if \(!operationalServicesAvailable\(\)\)[\s\S]*?return false;/,
  'offline review entry points fail closed before opening governed review workflows');
assert.match(dashboard, /workOrderApprovalChoice/);
assert.match(html, /<select id="workOrderApprovalReasonCode" aria-required="true"/);
assert.match(html, /<select id="noWorkOrderReasonCode" aria-required="true"/);
assert.match(html, /<option value="" selected disabled>Select a reason<\/option>/);
assert.match(html, /for="workOrderApprovalReasonCode"><strong>Decision Reason<\/strong>/);
assert.match(html, /for="workOrderApprovalOtherReason" hidden/);
assert.match(css, /approval-reason\[hidden\][\s\S]*display: none/);
assert.match(css, /approval-reason label\[hidden\][\s\S]*display: none/);
assert.match(dashboard, /decisionReasonCode: reason\.decisionReasonCode/);
assert.match(dashboard, /decisionNote: reason\.decisionNote/);
assert.match(dashboard,
  /submitWorkOrderApprovalAction[\s\S]*publishOperationalLineStateChange\(\[[\s\S]*customerNumber: identity\.customerNumber[\s\S]*salesOrderNumber: identity\.salesOrderNumber[\s\S]*lineNumber: identity\.lineNumber[\s\S]*'work-order-approval-' \+ action/,
  'approval, replacement, and revocation publish the exact changed line for cross-module refresh');
assert.match(html, /Replace Approval/);
assert.match(html, /Revoke Approval/);
assert.match(html, /Approve No Work Order Required/);
assert.match(html, /No Work Order Required Reason/);
assert.match(dashboard, /error\.status === 409/);
assert.match(dashboard, /Evidence changed\. Reloading/);
assert.match(dashboard, /openSalesOrderDashboardWorkOrder/);
assert.match(dashboard, /updateRequestToShipAction/);
assert.match(server, /Superseded by active RMA\/Rework case/);

console.log('WORKORDER-APPROVAL-001 governed contract: PASS');
