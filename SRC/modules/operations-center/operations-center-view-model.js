/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER VIEW MODEL
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const PACKING_OPERATIONAL_STATUS = 'Packing';
  const SHIPMENT_STAGING_EXIT_STATUS = 'Pending Invoice';

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
    const stagedRecordKeys = new Set(
      getShipmentStagingRecordsForProjection()
        .filter(record => normalizeOperationsValue(record?.status).toLowerCase() === SHIPMENT_STAGING_EXIT_STATUS.toLowerCase())
        .flatMap(getShipmentStagingMasterRecordKeys)
        .filter(Boolean)
    );

    if (!stagedRecordKeys.size) return getMasterRecords();
    return getMasterRecords().filter(record =>
      !stagedRecordKeys.has(normalizeOperationsValue(getMasterRecordKey(record)))
    );
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

  function getOperationalProjectionField(record, field) {
    const projectionMap = {
      quantityOrdered: item => formatOperationsQuantity(item?.quantityOrdered),
      erpQtyOpen: item => formatOperationsQuantity(item?.erpQuantityOpen),
      pendingInvoiceQty: item => formatOperationsQuantity(getPendingShipmentQuantityForMasterRecord(item)),
      opQtyOpen: getOperationalQuantityOpen
    };
    return projectionMap[field] ? projectionMap[field](record) : '';
  }

  function getOperationalQuantityOpen(record) {
    const erpQtyOpen = parseOperationsQuantity(record?.erpQuantityOpen);
    const pendingShipmentQuantity = getPendingShipmentQuantityForMasterRecord(record);
    return formatOperationsQuantity(Math.max(erpQtyOpen - pendingShipmentQuantity, 0));
  }

  function getPendingShipmentQuantityForMasterRecord(record) {
    const shipmentRecords = getShipmentStagingRecordsForProjection();
    const customerNumber = normalizeOperationsValue(record?.customerNumber);
    const salesOrder = normalizeOperationsValue(record?.salesOrderNumber);
    const sequenceLine = normalizeOperationsValue(record?.salesOrderLineNumber);
    if (!customerNumber || !salesOrder || !sequenceLine) return 0;

    return shipmentRecords
      .filter(shipmentRecord => normalizeOperationsValue(shipmentRecord.status) === 'Pending Invoice')
      .filter(shipmentRecord =>
        normalizeOperationsValue(shipmentRecord.customerNumber) === customerNumber &&
        normalizeOperationsValue(shipmentRecord.salesOrder) === salesOrder &&
        normalizeOperationsValue(shipmentRecord.salesOrderLine) === sequenceLine
      )
      .reduce((total, shipmentRecord) => total + parseOperationsQuantity(shipmentRecord.quantityShipped), 0);
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
    const overlay = window.OperationsCenter.stateActions.getOverlayRecord(getMasterRecordKey(record));
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
      extendedPrice: vpro5.extendedPrice,
      operationalStatus: overlay.operationalStatus
    };
    return String(fieldMap[field] ?? '');
  }

  function getWorkOrderPresentation(record) {
    const relationship = record?.workOrderRelationship || {};
    const candidates = Array.isArray(relationship.candidates) ? relationship.candidates : [];
    const status = String(relationship.status || 'UNRESOLVED');
    if (status === 'EXACT_LINE_UNIQUE') {
      const workOrder = String(relationship.actionableWorkOrderNumber || '').trim();
      return { status, label: workOrder, actionable: !!workOrder, reason: '' };
    }
    if (status === 'SALES_ORDER_ITEM_UNIQUE_CANDIDATE') {
      const item = normalizeOperationsValue(record?.itemNumber);
      const candidate = candidates.find(value => normalizeOperationsValue(value.itemNumber) === item);
      return {
        status,
        label: 'Candidate: ' + (candidate?.workOrderNumber || 'Work Order'),
        actionable: false,
        reason: 'Work Order is an item-level candidate; its anchor line differs.'
      };
    }
    if (status === 'SALES_ORDER_LEVEL_CANDIDATE') {
      return {
        status,
        label: 'Candidate: ' + (candidates[0]?.workOrderNumber || 'Work Order') + ' (order-level)',
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

  function getOperationalStatusPresentation(value) {
    const status = String(value ?? '').trim();
    const isPacking = status.toLowerCase() === PACKING_OPERATIONAL_STATUS.toLowerCase();

    return {
      status,
      label: isPacking ? '\u{1F7E8} ' + PACKING_OPERATIONAL_STATUS : status,
      isPacking,
      className: isPacking
        ? 'dle-operational-status-badge dle-operational-status-packing'
        : ''
    };
  }

  function setPackingOperationalStatus(masterRecordKey) {
    const normalizedKey = String(masterRecordKey || '').trim();
    if (!normalizedKey) return false;

    const record = getMasterRecords().find(item => getMasterRecordKey(item) === normalizedKey);
    if (!record) return false;

    record.dle = record.dle || {};
    record.dle.operationalStatus = PACKING_OPERATIONAL_STATUS;
    return window.OperationsCenter.stateActions.updateOverlayField(
      normalizedKey,
      'operationalStatus',
      PACKING_OPERATIONAL_STATUS
    );
  }

  window.OperationsCenter.viewModel = {
    getMasterData,
    getMasterRecords,
    getOperationsCenterRecords,
    getMasterRecordKey,
    getOperationalProjectionField,
    getOfficialField,
    getWorkOrderPresentation,
    getOperationalStatusPresentation,
    setPackingOperationalStatus
  };
})();
