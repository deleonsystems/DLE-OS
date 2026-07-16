/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER VIEW MODEL
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  function getMasterData() {
    if (typeof dleMasterDataFileState !== 'undefined' && dleMasterDataFileState.data) return dleMasterDataFileState.data;
    if (typeof dleMasterData !== 'undefined' && dleMasterData?.records) return dleMasterData;
    return null;
  }

  function getMasterRecords() {
    const data = getMasterData();
    const records = Array.isArray(data?.records) ? data.records : [];
    if (typeof getActiveMasterDataRecords === 'function') {
      return getActiveMasterDataRecords(records);
    }
    return records.filter(record => String(record.lifecycleState || '').toUpperCase() !== 'ARCHIVED');
  }

  function getMasterRecordKey(record) {
    if (record?.id) return String(record.id);
    if (typeof getMasterRecordKeyForRecord === 'function') return getMasterRecordKeyForRecord(record);
    const vpro5 = record?.vpro5 || {};
    return [vpro5.customerNumber || '', vpro5.salesOrder || '', vpro5.sequenceLine || ''].join('|');
  }

  function getOperationalProjectionField(record, field) {
    const projectionMap = {
      opQtyOpen: getOperationalQuantityOpen
    };
    return projectionMap[field] ? projectionMap[field](record) : '';
  }

  function getOperationalQuantityOpen(record) {
    const vpro5 = record?.vpro5 || {};
    const erpQtyOpen = parseOperationsQuantity(vpro5.qtyOpen);
    const pendingShipmentQuantity = getPendingShipmentQuantityForMasterRecord(record);
    return formatOperationsQuantity(Math.max(erpQtyOpen - pendingShipmentQuantity, 0));
  }

  function getPendingShipmentQuantityForMasterRecord(record) {
    const shipmentRecords = getShipmentStagingRecordsForProjection();
    const vpro5 = record?.vpro5 || {};
    const customerNumber = normalizeOperationsValue(vpro5.customerNumber);
    const salesOrder = normalizeOperationsValue(vpro5.salesOrder);
    const sequenceLine = normalizeOperationsValue(vpro5.sequenceLine);
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
    const dle = record?.dle || {};
    const fieldMap = {
      orderDate: vpro5.orderDate,
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
      operationalStatus: dle.operationalStatus
    };
    return String(fieldMap[field] ?? '');
  }

  window.OperationsCenter.viewModel = {
    getMasterData,
    getMasterRecords,
    getMasterRecordKey,
    getOperationalProjectionField,
    getOfficialField
  };
})();
