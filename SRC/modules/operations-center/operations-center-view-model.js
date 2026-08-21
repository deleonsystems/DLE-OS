/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER VIEW MODEL
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  function getMasterData() {
    const state = window.OperationsCenter.state;
    if (!state?.canonicalLoaded) return null;
    return {
      schema: 'DLE_OPERATIONS_CENTER_CANONICAL_V1',
      source: state.canonicalSource,
      records: state.canonicalRows
    };
  }

  function getMasterRecords() {
    const records = window.OperationsCenter.state?.canonicalRows;
    return Array.isArray(records) ? records : [];
  }

  function getOperationsCenterRecords() {
    return getMasterRecords().filter(record => {
      if (isActiveRmaReworkRecord(record)) return true;
      return !getShipmentProjection(record).isFullyStaged;
    });
  }

  function isActiveRmaReworkRecord(record) {
    if (record?.rmaReworkMembership) return true;

    const operational = record?.workOrderApprovalReview?.operationalRelationship;
    const route = normalizeOperationsValue(operational?.operationalRoute).toUpperCase();
    const status = normalizeOperationsValue(operational?.operationalStatus).toUpperCase();
    const source = normalizeOperationsValue(operational?.activeWorkOrderSource).toUpperCase();
    return route === 'RMA_REWORK' ||
      ['RMA_DECISION_PENDING', 'RMA_WORK_ORDER_ASSIGNED'].includes(status) ||
      source === 'RMA_DECISION';
  }

  function parseSearchTerms(value) {
    return String(value || '')
      .split(';')
      .map(segment => segment.trim())
      .filter(Boolean);
  }

  function getOperationsCenterView(options = {}) {
    const records = Array.isArray(options.records)
      ? options.records.slice()
      : getOperationsCenterRecords();
    const searchTerms = Array.isArray(options.searchTerms)
      ? options.searchTerms.map(normalizeOperationsValue).filter(Boolean)
      : [];
    const searchedRecords = searchTerms.length
      ? records.filter(record => {
        const searchText = getOperationsCenterSearchText(record).toUpperCase();
        return searchTerms.every(term => searchText.includes(term.toUpperCase()));
      })
      : records;
    const hiddenRecords = options.hideRmaRework
      ? searchedRecords.filter(isActiveRmaReworkRecord)
      : [];
    const visibleRecords = options.hideRmaRework
      ? searchedRecords.filter(record => !isActiveRmaReworkRecord(record))
      : searchedRecords;

    return {
      records: visibleRecords,
      hiddenRmaReworkCount: hiddenRecords.length,
      filteredRecordCount: searchedRecords.length,
      sourceRecordCount: records.length
    };
  }

  function getOperationsCenterSearchText(record) {
    const official = [
      'orderDate', 'customerNumber', 'customer', 'customerPo', 'salesOrder',
      'sequenceLine', 'workOrder', 'partNumber', 'description',
      'opQtyOpen', 'dueDate', 'price', 'extendedPrice', 'materialStatus'
    ].map(field => getOfficialField(record, field));
    const latestStatus = getVerifiedStatusPresentation(record);
    const presentation = getWorkOrderPresentation(record);
    return collectSearchValues([
      official,
      presentation,
      latestStatus,
      record?.workOrderApprovalReview?.operationalRelationship,
      record?.rmaReworkMembership
    ]).join(' ');
  }

  function collectSearchValues(value, values = []) {
    if (value === null || value === undefined) return values;
    if (Array.isArray(value)) {
      value.forEach(item => collectSearchValues(item, values));
    } else if (typeof value === 'object') {
      Object.values(value).forEach(item => collectSearchValues(item, values));
    } else {
      values.push(normalizeOperationsValue(value));
    }
    return values;
  }

  function getShipmentStagingMasterRecordKeys(record) {
    const detailKeys = Array.isArray(record?.lines)
      ? record.lines.map(line => line?.masterRecordKey || line?.sourceWorkOrder?.masterRecordKey)
      : [];
    const sourceKeys = Array.isArray(record?.sourceWorkOrders)
      ? record.sourceWorkOrders.map(source => source?.masterRecordKey)
      : [];
    const keys = detailKeys.length
      ? detailKeys
      : sourceKeys.length
        ? sourceKeys
        : [record?.masterRecordKey || record?.sourceWorkOrder?.masterRecordKey];

    return Array.from(new Set(keys.map(key => normalizeOperationsValue(key)).filter(Boolean)));
  }

  function getMasterRecordKey(record) {
    if (record?.masterRecordKey) return String(record.masterRecordKey);
    if (record?.id) return String(record.id);
    if (typeof getMasterRecordKeyForRecord === 'function') return getMasterRecordKeyForRecord(record);
    const vpro5 = record?.vpro5 || {};
    return [vpro5.customerNumber || '', vpro5.salesOrder || '', vpro5.sequenceLine || ''].join('|');
  }

  function getVerifiedStatusRecord(record) {
    return window.OperationsCenter.stateActions.getVerifiedStatusRecord(getMasterRecordKey(record));
  }

  function getVerifiedStatusPresentation(record) {
    const latest = getVerifiedStatusRecord(record);
    if (!latest) return { statusText: '', recordedBy: '', recordedAtUtc: '', timeLabel: '', summary: '' };
    const timeLabel = formatVerifiedStatusTimestamp(latest.recordedAtUtc);
    const statusText = normalizeOperationsValue(latest.statusText);
    const recordedBy = normalizeOperationsValue(latest.recordedBy);
    return {
      ...latest,
      statusText,
      recordedBy,
      timeLabel,
      summary: [statusText, recordedBy, timeLabel].filter(Boolean).join(' ')
    };
  }

  function formatVerifiedStatusTimestamp(value) {
    const timestamp = String(value || '').trim();
    const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp)
      ? timestamp + 'Z'
      : timestamp;
    const date = utcTimestamp ? new Date(utcTimestamp) : null;
    if (!date || Number.isNaN(date.valueOf())) return '';
    const timeZone = window.DleOperatorHeader?.factoryTimeZone || 'America/Los_Angeles';
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

  function getOperationalProjectionField(record, field) {
    const projectionMap = {
      quantityOrdered: item => formatOperationsQuantity(item?.quantityOrdered),
      erpQtyOpen: item => formatOperationsQuantity(item?.erpQuantityOpen),
      pendingInvoiceQty: item => formatOperationsQuantity(getShipmentProjection(item).stagedQuantity),
      opQtyOpen: getOperationalQuantityOpen,
      materialStatus: item => item?.materialStatus?.label || ''
    };
    return projectionMap[field] ? projectionMap[field](record) : '';
  }

  function getOperationalQuantityOpen(record) {
    return formatOperationsQuantity(getShipmentProjection(record).operationalRemainingQuantity);
  }

  function getPendingShipmentQuantityForMasterRecord(record) {
    return getShipmentProjection(record).stagedQuantity;
  }

  function getShipmentProjection(record) {
    const projector = window.ShipmentOperationalProjection;
    if (!projector?.projectLine) {
      const erpQuantityOpen = parseOperationsQuantity(record?.erpQuantityOpen);
      return {
        canonicalOpenQuantity: erpQuantityOpen,
        stagedQuantity: 0,
        operationalRemainingQuantity: erpQuantityOpen,
        isFullyStaged: false,
        isPartiallyStaged: false,
        statusLabel: ''
      };
    }
    return projector.projectLine(record, getShipmentStagingRecordsForProjection());
  }

  function getShipmentStagingRecordsForProjection() {
    if (typeof shipmentStagingState !== 'undefined' && Array.isArray(shipmentStagingState.records)) {
      return shipmentStagingState.records;
    }
    if (Array.isArray(window.shipmentStagingState?.records)) {
      return window.shipmentStagingState.records;
    }
    return [];
  }

  function normalizeOperationsValue(value) {
    return String(value ?? '').trim();
  }

  function parseOperationsQuantity(value) {
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatOperationsQuantity(value) {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  function getOfficialField(record, field) {
    const projectedValue = getOperationalProjectionField(record, field);
    if (projectedValue !== '') return projectedValue;

    const vpro5 = record?.vpro5 || {};
    const fieldMap = {
      orderDate: vpro5.orderDate,
      customerNumber: vpro5.customerNumber,
      customer: vpro5.customer,
      customerPo: vpro5.customerPo,
      salesOrder: vpro5.salesOrder,
      sequenceLine: vpro5.sequenceLine,
      workOrder: vpro5.workOrder,
      qtyOpen: vpro5.qtyOpen,
      partNumber: vpro5.partNumber,
      description: vpro5.description,
      dueDate: vpro5.dueDate,
      price: vpro5.price,
      extendedPrice: vpro5.extendedPrice
    };
    return String(fieldMap[field] ?? '');
  }

  function getWorkOrderPresentation(record) {
    const relationship = record?.workOrderRelationship || {};
    const candidates = Array.isArray(relationship.candidates) ? relationship.candidates : [];
    const status = String(relationship.status || 'UNRESOLVED');
    const operational = record?.workOrderApprovalReview?.operationalRelationship;
    if (operational) {
      const active = normalizeOperationsValue(operational.activeWorkOrderNumber);
      if (active) {
        return {
          status: normalizeOperationsValue(operational.operationalStatus) || 'ACTIVE_PRODUCTION_WORK_ORDER',
          label: active,
          secondaryLabel: operational.activeWorkOrderSource === 'RMA_DECISION'
            ? 'RMA / Rework Assigned' : operational.activeWorkOrderSource === 'APPROVED' ? 'Approved' : 'ERP Confirmed',
          actionable: true,
          reason: normalizeOperationsValue(operational.reason)
        };
      }
      if (['RMA_REWORK', 'RETURN_RMA_REVIEW_REQUIRED'].includes(operational.operationalRoute)) {
        const history = Array.isArray(operational.historicalWorkOrders)
          ? operational.historicalWorkOrders.map(item =>
            (item.relationshipRole === 'ORIGINAL_BUILD' ? 'Original Build: ' : 'Historical: ') +
              normalizeOperationsValue(item.workOrderNumber)).filter(Boolean) : [];
        return {
          status: normalizeOperationsValue(operational.operationalStatus) || 'RETURN_REVIEW_REQUIRED',
          label: normalizeOperationsValue(operational.workOrderDecision) || 'Return Review Required',
          secondaryLabel: operational.operationalRoute === 'RMA_REWORK' ? 'RMA / Rework' : 'RMA / Return Review',
          actionable: false,
          reason: normalizeOperationsValue(operational.reason),
          caseReference: normalizeOperationsValue(operational.rmaReworkControl?.caseReference),
          evidenceLabel: 'Canonical evidence retained as historical only',
          evidence: history
        };
      }
      if (operational.operationalRoute === 'DIRECT_FULFILLMENT' &&
          operational.operationalStatus === 'NO_WORK_ORDER_REQUIRED') {
        const reasonCode = record?.workOrderApprovalReview?.currentApproval?.decisionReasonCode;
        const basis = ({
          PART_COMPONENT_ONLY: 'Part/Component Only',
          CUSTOMER_SUPPLIED_MATERIAL: 'Customer-Supplied Material',
          PURCHASED_RESALE_ITEM: 'Purchased Item / Resale Item',
          SHIPPING_REPLACEMENT_MATERIAL_ONLY: 'Shipping or Replacement Material Only',
          OTHER: 'Other'
        })[reasonCode] || 'Direct Fulfillment';
        return {
          status: 'NO_WORK_ORDER_REQUIRED',
          label: 'Not Required',
          secondaryLabel: basis + ' · Direct Fulfillment · Approved',
          actionable: false,
          reason: normalizeOperationsValue(operational.reason)
        };
      }
    }
    const membership = record?.rmaReworkMembership;
    if (membership) {
      const approvalNumber = normalizeOperationsValue(
        record?.workOrderApprovalReview?.currentApproval?.approvedWorkOrderNumber
      );
      const exactNumber = status === 'EXACT_LINE_UNIQUE'
        ? normalizeOperationsValue(relationship.actionableWorkOrderNumber)
        : '';
      const candidateNumbers = candidates
        .map(candidate => normalizeOperationsValue(candidate?.workOrderNumber))
        .filter(Boolean);
      const evidence = [];
      if (approvalNumber) evidence.push('Prior approval: ' + approvalNumber);
      if (exactNumber) evidence.push('Exact relationship: ' + exactNumber);
      candidateNumbers.forEach(number => evidence.push('Candidate: ' + number));
      return {
        status: 'RMA_CONTROLLED',
        label: 'Decision Pending',
        secondaryLabel: 'RMA / Rework',
        actionable: false,
        reason: 'Active RMA/Rework case controls this Sales Order line. Prior actionable evidence is superseded.',
        caseReference: normalizeOperationsValue(membership.caseReference || membership.caseId),
        evidenceLabel: 'Superseded by active RMA/Rework case',
        evidence: Array.from(new Set(evidence))
      };
    }

    const approvedWorkOrder = normalizeOperationsValue(
      record?.workOrderApprovalReview?.currentApproval?.approvedWorkOrderNumber
    );
    if (approvedWorkOrder) {
      return {
        status: 'APPROVED',
        label: approvedWorkOrder,
        secondaryLabel: 'Approved',
        actionable: true,
        reason: 'Current governed operational Work Order approval.'
      };
    }
    if (status === 'EXACT_LINE_UNIQUE') {
      const workOrder = String(relationship.actionableWorkOrderNumber || '').trim();
      return { status, label: workOrder, actionable: !!workOrder, reason: '' };
    }
    if (status === 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE') {
      const item = normalizeOperationsValue(record?.itemNumber);
      const declaredCount = Number.isInteger(relationship.candidateCount)
        ? relationship.candidateCount : null;
      const candidate = candidates.length === 1 ? candidates[0] : null;
      const valid = candidate && normalizeOperationsValue(candidate.itemNumber) === item &&
        (declaredCount === null || declaredCount === 1);
      if (!valid) {
        return {
          status,
          label: 'Candidate Data Conflict',
          actionable: false,
          reason: 'The authoritative unique-item candidate payload is incomplete or inconsistent.'
        };
      }
      return {
        status,
        label: 'Candidate: ' + candidate.workOrderNumber,
        actionable: false,
        reason: 'Work Order is an item-level candidate; its anchor line differs.'
      };
    }
    if (status === 'SALES_ORDER_LEVEL_CANDIDATE') {
      const declaredCount = Number.isInteger(relationship.candidateCount)
        ? relationship.candidateCount : null;
      if (candidates.length !== 1 || (declaredCount !== null && declaredCount !== 1)) {
        return {
          status,
          label: 'Candidate Data Conflict',
          actionable: false,
          reason: 'The authoritative Sales Order-level candidate payload is incomplete or inconsistent.'
        };
      }
      return {
        status,
        label: 'Candidate: ' + candidates[0].workOrderNumber + ' (order-level)',
        actionable: false,
        reason: 'Work Order has only Sales Order-level evidence.'
      };
    }
    if (status === 'AMBIGUOUS') {
      return {
        status,
        label: 'Multiple Work Orders (' + candidates.length + ')',
        actionable: false,
        reason: 'Multiple Work Orders match this Sales Order line.'
      };
    }
    return {
      status: 'UNRESOLVED',
      label: 'Work Order Not Resolved',
      actionable: false,
      reason: 'No governed Work Order relationship was found.'
    };
  }

  window.OperationsCenter.viewModel = {
    getMasterData,
    getMasterRecords,
    getOperationsCenterRecords,
    isActiveRmaReworkRecord,
    parseSearchTerms,
    getOperationsCenterView,
    getOperationsCenterSearchText,
    getMasterRecordKey,
    getOperationalProjectionField,
    getShipmentProjection,
    getOfficialField,
    getWorkOrderPresentation,
    getVerifiedStatusPresentation
  };
})();
