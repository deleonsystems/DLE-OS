/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER VERIFIED STATUS SERVICE
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  function getMasterRecordKey(record) {
    return window.OperationsCenter.viewModel.getMasterRecordKey(record);
  }

  function buildEvidenceSnapshot(record) {
    const viewModel = window.OperationsCenter.viewModel;
    return {
      customerNumber: viewModel.getOfficialField(record, 'customerNumber'),
      customer: viewModel.getOfficialField(record, 'customer'),
      customerPo: viewModel.getOfficialField(record, 'customerPo'),
      salesOrder: viewModel.getOfficialField(record, 'salesOrder'),
      line: viewModel.getOfficialField(record, 'sequenceLine'),
      workOrder: viewModel.resolveGovernedWorkOrderNumber(record),
      itemNumber: viewModel.getOfficialField(record, 'partNumber'),
      description: viewModel.getOfficialField(record, 'description'),
      quantityOpen: viewModel.getOfficialField(record, 'opQtyOpen'),
      dueDate: viewModel.getOfficialField(record, 'dueDate'),
      materialStatus: viewModel.getOfficialField(record, 'materialStatus')
    };
  }

  async function loadLatestForRows(records) {
    const rowList = Array.isArray(records) ? records : [];
    const keys = Array.from(new Set(rowList.map(getMasterRecordKey).filter(Boolean)));
    const workOrders = Array.from(new Set(rowList.map(record =>
      window.OperationsCenter.viewModel.resolveGovernedWorkOrderNumber(record)).filter(Boolean)));
    if (!keys.length && !workOrders.length) {
      window.OperationsCenter.stateActions.setVerifiedStatusRecords([], []);
      return [];
    }
    const [lineResult, workOrderResult] = await Promise.all([
      keys.length ? window.DleApiClient.getOperationsCenterVerifiedStatusLatest(keys) : { records: [] },
      workOrders.length ? window.DleApiClient.getOperationsCenterWorkOrderVerifiedStatusLatest(workOrders) : { records: [] }
    ]);
    const latestRecords = Array.isArray(lineResult?.records) ? lineResult.records : [];
    const latestWorkOrderRecords = Array.isArray(workOrderResult?.records) ? workOrderResult.records : [];
    window.OperationsCenter.stateActions.setVerifiedStatusRecords(latestRecords, latestWorkOrderRecords);
    return latestRecords;
  }

  function buildGroupEvidenceSnapshot(group) {
    const viewModel = window.OperationsCenter.viewModel;
    return {
      workOrder: group.workOrderNumber,
      representativeMasterRecordKey: viewModel.getMasterRecordKey(group.primaryRecord),
      representativeSalesOrder: viewModel.getOfficialField(group.primaryRecord, 'salesOrder'),
      representativeLine: viewModel.getOfficialField(group.primaryRecord, 'sequenceLine'),
      lineCount: group.lineCount,
      groupedOpenQuantity: group.groupedOpenQuantity,
      positiveLineCount: group.positiveLineCount,
      nonPositiveLineCount: group.nonPositiveLineCount,
      lines: group.records.map(record => buildEvidenceSnapshot(record))
    };
  }

  function resolveRequestCorrelationId(options) {
    return String(options?.requestCorrelationId || '').trim() || window.DleApiClient.createRequestCorrelationId();
  }

  async function appendForWorkOrderGroup(group, statusText, options = {}) {
    const text = String(statusText || '').trim();
    if (!text) throw new Error('Last Verified Status is required.');
    if (group?.type !== 'WORK_ORDER_GROUP' || !String(group?.workOrderNumber || '').trim()) {
      throw new Error('A governed Work Order is required for a Work Order status.');
    }
    const request = {
      statusText: text,
      evidenceSnapshot: buildGroupEvidenceSnapshot(group),
      requestCorrelationId: resolveRequestCorrelationId(options)
    };
    const result = await window.DleApiClient.appendOperationsCenterWorkOrderVerifiedStatus(group.workOrderNumber, request);
    const latest = result?.record;
    if (latest) window.OperationsCenter.stateActions.upsertWorkOrderVerifiedStatusRecord(latest);
    return result;
  }

  async function appendForRecord(record, statusText, options = {}) {
    const text = String(statusText || '').trim();
    if (!text) throw new Error('Last Verified Status is required.');
    const viewModel = window.OperationsCenter.viewModel;
    const masterRecordKey = getMasterRecordKey(record);
    const request = {
      statusText: text,
      workOrderNumber: viewModel.resolveGovernedWorkOrderNumber(record),
      itemNumber: viewModel.getOfficialField(record, 'partNumber'),
      description: viewModel.getOfficialField(record, 'description'),
      evidenceSnapshot: buildEvidenceSnapshot(record),
      requestCorrelationId: resolveRequestCorrelationId(options)
    };
    const result = await window.DleApiClient.appendOperationsCenterVerifiedStatus(masterRecordKey, request);
    const latest = result?.record;
    if (latest) window.OperationsCenter.stateActions.upsertVerifiedStatusRecord(latest);
    return result;
  }

  window.OperationsCenter.verifiedStatusService = {
    loadLatestForRows,
    appendForRecord,
    buildEvidenceSnapshot,
    buildGroupEvidenceSnapshot,
    appendForWorkOrderGroup
  };
})();
