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
      workOrder: viewModel.getOfficialField(record, 'workOrder'),
      itemNumber: viewModel.getOfficialField(record, 'partNumber'),
      description: viewModel.getOfficialField(record, 'description'),
      quantityOpen: viewModel.getOfficialField(record, 'opQtyOpen'),
      dueDate: viewModel.getOfficialField(record, 'dueDate'),
      materialStatus: viewModel.getOfficialField(record, 'materialStatus')
    };
  }

  async function loadLatestForRows(records) {
    const keys = Array.from(new Set((records || []).map(getMasterRecordKey).filter(Boolean)));
    if (!keys.length) {
      window.OperationsCenter.stateActions.setVerifiedStatusRecords([]);
      return [];
    }
    const result = await window.DleApiClient.getOperationsCenterVerifiedStatusLatest(keys);
    const latestRecords = Array.isArray(result?.records) ? result.records : [];
    window.OperationsCenter.stateActions.setVerifiedStatusRecords(latestRecords);
    return latestRecords;
  }

  async function appendForRecord(record, statusText) {
    const text = String(statusText || '').trim();
    if (!text) throw new Error('Last Verified Status is required.');
    const viewModel = window.OperationsCenter.viewModel;
    const masterRecordKey = getMasterRecordKey(record);
    const request = {
      statusText: text,
      workOrderNumber: viewModel.getOfficialField(record, 'workOrder'),
      itemNumber: viewModel.getOfficialField(record, 'partNumber'),
      description: viewModel.getOfficialField(record, 'description'),
      evidenceSnapshot: buildEvidenceSnapshot(record),
      requestCorrelationId: window.DleApiClient.createRequestCorrelationId()
    };
    const result = await window.DleApiClient.appendOperationsCenterVerifiedStatus(masterRecordKey, request);
    const latest = result?.record;
    if (latest) window.OperationsCenter.stateActions.upsertVerifiedStatusRecord(latest);
    return result;
  }

  window.OperationsCenter.verifiedStatusService = {
    loadLatestForRows,
    appendForRecord,
    buildEvidenceSnapshot
  };
})();
