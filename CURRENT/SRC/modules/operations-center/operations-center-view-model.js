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

  function getOfficialField(record, field) {
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
    getOfficialField
  };
})();
