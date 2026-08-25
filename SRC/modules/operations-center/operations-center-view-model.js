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
    if (!isOperationalEnrichmentAvailable()) return getMasterRecords();
    return getMasterRecords().filter(record => {
      if (isActiveRmaReworkRecord(record)) return true;
      return !getShipmentProjection(record).isFullyStaged;
    });
  }

  function isActiveRmaReworkRecord(record) {
    if (!isOperationalEnrichmentAvailable()) return false;
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

  function getWorkOrderVerifiedStatusRecord(workOrderNumber) {
    return window.OperationsCenter.stateActions.getWorkOrderVerifiedStatusRecord(normalizeWorkOrderNumber(workOrderNumber));
  }

  function getEffectiveVerifiedStatusRecord(record) {
    const line = getVerifiedStatusRecord(record);
    if (line) return { ...line, scope: 'LINE_OVERRIDE', inherited: false };
    const workOrder = getWorkOrderVerifiedStatusRecord(resolveGovernedWorkOrderNumber(record));
    return workOrder ? { ...workOrder, masterRecordKey: getMasterRecordKey(record), scope: 'WORK_ORDER_DEFAULT', inherited: true } : null;
  }

  function getVerifiedStatusPresentation(record) {
    if (!isOperationalEnrichmentAvailable()) {
      return { ...emptyVerifiedStatusPresentation(), unavailable: true };
    }
    const latest = getEffectiveVerifiedStatusRecord(record);
    if (!latest) return emptyVerifiedStatusPresentation();
    return presentVerifiedStatus(latest);
  }

  function emptyVerifiedStatusPresentation() {
    return { statusText: '', recordedBy: '', recordedAtUtc: '', timeLabel: '', summary: '', scope: '', inherited: false };
  }

  function getVerifiedStatusLoggerPrefill(record, group = null) {
    if (group?.type === 'WORK_ORDER_GROUP') {
      const workOrder = getWorkOrderVerifiedStatusRecord(group.workOrderNumber);
      const presentation = workOrder ? presentVerifiedStatus({ ...workOrder, scope: 'WORK_ORDER_DEFAULT', inherited: false })
        : emptyVerifiedStatusPresentation();
      return { ...presentation, mode: 'WORK_ORDER', inheritedStatusText: '' };
    }
    const line = getVerifiedStatusRecord(record);
    if (line) {
      return { ...presentVerifiedStatus({ ...line, scope: 'LINE_OVERRIDE', inherited: false }),
        mode: 'LINE', inheritedStatusText: '' };
    }
    const effective = getVerifiedStatusPresentation(record);
    return { ...emptyVerifiedStatusPresentation(), mode: 'LINE',
      inheritedStatusText: effective.inherited ? effective.statusText : '' };
  }

  function presentVerifiedStatus(latest) {
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

  function normalizeWorkOrderNumber(value) {
    const text = normalizeOperationsValue(value);
    return /^\d+$/.test(text) ? text.padStart(7, '0') : '';
  }

  function resolveGovernedWorkOrderNumber(record) {
    if (!isOperationalEnrichmentAvailable()) return '';
    const operational = record?.workOrderApprovalReview?.operationalRelationship;
    const approved = record?.workOrderApprovalReview?.currentApproval;
    const relationship = record?.workOrderRelationship;
    const activeWorkOrder = normalizeWorkOrderNumber(operational?.activeWorkOrderNumber);
    if (activeWorkOrder) return activeWorkOrder;
    const approvedWorkOrder = normalizeWorkOrderNumber(approved?.approvedWorkOrderNumber);
    if (approvedWorkOrder) return approvedWorkOrder;
    if (normalizeOperationsValue(relationship?.status) === 'EXACT_LINE_UNIQUE') {
      const exactWorkOrder = normalizeWorkOrderNumber(relationship?.actionableWorkOrderNumber);
      if (exactWorkOrder) return exactWorkOrder;
    }
    return normalizeWorkOrderNumber(record?.vpro5?.workOrder || record?.workOrderNumber);
  }

  function parseDueDateTime(value) {
    const text = normalizeOperationsValue(value);
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!match) return Number.POSITIVE_INFINITY;
    const year = Number(match[3].length === 2 ? '20' + match[3] : match[3]);
    const time = Date.UTC(year, Number(match[1]) - 1, Number(match[2]));
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
  }

  function compareOperationsLines(left, right) {
    return parseDueDateTime(getOfficialField(left, 'dueDate')) - parseDueDateTime(getOfficialField(right, 'dueDate')) ||
      normalizeOperationsValue(getOfficialField(left, 'salesOrder')).localeCompare(normalizeOperationsValue(getOfficialField(right, 'salesOrder')), undefined, { numeric: true }) ||
      normalizeOperationsValue(getOfficialField(left, 'sequenceLine')).localeCompare(normalizeOperationsValue(getOfficialField(right, 'sequenceLine')), undefined, { numeric: true });
  }

  function parseOperationsOpenQuantity(value) {
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatGroupedQuantity(value) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function getWorkOrderGroups(records = getOperationsCenterRecords(), options = {}) {
    const groupsByWorkOrder = new Map();
    const unresolvedByMasterRecordKey = new Map();
    (Array.isArray(records) ? records : []).forEach(record => {
      const workOrder = resolveGovernedWorkOrderNumber(record);
      if (!workOrder) {
        const masterRecordKey = getMasterRecordKey(record);
        if (masterRecordKey) unresolvedByMasterRecordKey.set(masterRecordKey, record);
        return;
      }
      if (!groupsByWorkOrder.has(workOrder)) {
        groupsByWorkOrder.set(workOrder, { workOrderNumber: workOrder, recordsByKey: new Map() });
      }
      groupsByWorkOrder.get(workOrder).recordsByKey.set(getMasterRecordKey(record), record);
    });
    const groups = [
      ...Array.from(groupsByWorkOrder.values())
        .map(group => buildWorkOrderGroup(group.workOrderNumber, Array.from(group.recordsByKey.values()))),
      ...Array.from(unresolvedByMasterRecordKey.values()).map(buildUnresolvedLineGroup)
    ]
      .sort((left, right) => compareOperationsLines(left.primaryRecord, right.primaryRecord));
    const searchTerms = Array.isArray(options.searchTerms)
      ? options.searchTerms.map(normalizeOperationsValue).filter(Boolean)
      : [];
    return searchTerms.length
      ? groups.filter(group => group.records.some(record => {
        const searchText = getOperationsCenterSearchText(record).toUpperCase();
        return searchTerms.every(term => searchText.includes(term.toUpperCase()));
      }))
      : groups;
  }

  function buildUnresolvedLineGroup(record) {
    const quantityOpen = getOfficialField(record, 'opQtyOpen');
    const parsedQuantity = parseOperationsOpenQuantity(quantityOpen);
    return {
      type: 'UNRESOLVED_LINE',
      key: 'UNRESOLVED|' + getMasterRecordKey(record),
      workOrderNumber: '',
      records: [record],
      primaryRecord: record,
      lineCount: 1,
      groupedOpenQuantity: quantityOpen,
      positiveLineCount: parsedQuantity > 0 ? 1 : 0,
      nonPositiveLineCount: parsedQuantity <= 0 ? 1 : 0,
      hasQuantityException: parsedQuantity <= 0,
      overrideCount: 0,
      mixed: false,
      statusPresentation: getVerifiedStatusPresentation(record)
    };
  }

  function buildWorkOrderGroup(workOrderNumber, records) {
    const ordered = records.slice().sort(compareOperationsLines);
    const primary = ordered[0] || null;
    const positiveLines = ordered.filter(record => parseOperationsOpenQuantity(getOfficialField(record, 'opQtyOpen')) > 0);
    const nonPositiveLines = ordered.filter(record => parseOperationsOpenQuantity(getOfficialField(record, 'opQtyOpen')) <= 0);
    const groupedOpenQuantity = positiveLines.reduce((sum, record) => sum + parseOperationsOpenQuantity(getOfficialField(record, 'opQtyOpen')), 0);
    const lineStatuses = ordered.map(record => getVerifiedStatusPresentation(record));
    const distinctEffectiveStatuses = Array.from(new Set(lineStatuses.map(status => status.statusText).filter(Boolean)));
    const overrideCount = ordered.filter(record => !!getVerifiedStatusRecord(record)).length;
    const workOrderStatus = getWorkOrderVerifiedStatusRecord(workOrderNumber);
    const mixed = distinctEffectiveStatuses.length > 1;
    return {
      type: 'WORK_ORDER_GROUP',
      key: 'WO|' + workOrderNumber,
      workOrderNumber,
      records: ordered,
      primaryRecord: primary,
      lineCount: ordered.length,
      groupedOpenQuantity: formatGroupedQuantity(groupedOpenQuantity),
      positiveLineCount: positiveLines.length,
      nonPositiveLineCount: nonPositiveLines.length,
      hasQuantityException: nonPositiveLines.length > 0,
      overrideCount,
      mixed,
      statusPresentation: mixed
        ? { statusText: 'MIXED', recordedBy: '', timeLabel: '', summary: 'MIXED', mixed: true }
        : workOrderStatus ? presentVerifiedStatus({ ...workOrderStatus, scope: 'WORK_ORDER_DEFAULT', inherited: false })
          : lineStatuses.find(status => status.statusText) || { statusText: '', recordedBy: '', timeLabel: '', summary: '' }
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
    if (!isOperationalEnrichmentAvailable() &&
        ['pendingInvoiceQty', 'opQtyOpen', 'materialStatus'].includes(field)) {
      return 'Unavailable';
    }
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
    if (!isOperationalEnrichmentAvailable()) {
      return {
        available: false,
        canonicalOpenQuantity: parseOperationsQuantity(record?.erpQuantityOpen),
        stagedQuantity: null,
        operationalRemainingQuantity: null,
        isFullyStaged: null,
        isPartiallyStaged: null,
        statusLabel: 'Unavailable'
      };
    }
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
    if (!isOperationalEnrichmentAvailable()) {
      const canonicalWorkOrder = status === 'EXACT_LINE_UNIQUE'
        ? normalizeOperationsValue(relationship.actionableWorkOrderNumber) : '';
      return {
        status: 'OPERATIONAL_UNAVAILABLE',
        label: 'Operational routing unavailable',
        secondaryLabel: canonicalWorkOrder ? 'Canonical WO evidence: ' + canonicalWorkOrder : '',
        actionable: false,
        reason: '5054 operational approvals and RMA/Rework routing are unavailable. Canonical evidence is not an operational decision.'
      };
    }
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
    getWorkOrderGroups,
    buildWorkOrderGroup,
    buildUnresolvedLineGroup,
    compareOperationsLines,
    normalizeWorkOrderNumber,
    resolveGovernedWorkOrderNumber,
    getMasterRecordKey,
    getOperationalProjectionField,
    getShipmentProjection,
    getOfficialField,
    getWorkOrderPresentation,
    getVerifiedStatusPresentation,
    getVerifiedStatusLoggerPrefill
  };

  function isOperationalEnrichmentAvailable() {
    const state = window.OperationsCenter.state;
    return !state || !Object.prototype.hasOwnProperty.call(state, 'operationalEnrichmentAvailable') ||
      state.operationalEnrichmentAvailable === true;
  }
})();
