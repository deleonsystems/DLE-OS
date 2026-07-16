/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER PROJECTION SERVICE
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const storageKey = 'DLE_OS_OPERATIONS_PROJECTION_V1';

  const state = {
    active: false,
    selectedByKey: {}
  };

  function initialize() {
    state.selectedByKey = readSelections();
    state.active = false;
  }

  function isActive() {
    return state.active;
  }

  function setActive(active) {
    state.active = !!active;
  }

  function toggleActive() {
    state.active = !state.active;
    return state.active;
  }

  function isSelected(masterRecordKey) {
    return !!state.selectedByKey[String(masterRecordKey || '')];
  }

  function setSelected(masterRecordKey, selected) {
    const key = String(masterRecordKey || '');
    if (!key) return;

    if (selected) {
      state.selectedByKey[key] = true;
    } else {
      delete state.selectedByKey[key];
    }

    writeSelections();
  }

  function getSummary(records, viewModel) {
    const selectedRecords = getSelectedRecords(records, viewModel);
    const projectedRevenue = selectedRecords.reduce((total, record) => {
      return total + parseCurrency(viewModel.getOfficialField(record, 'extendedPrice'));
    }, 0);

    return {
      selectedJobs: selectedRecords.length,
      projectedRevenue
    };
  }

  function getSelectedRecords(records, viewModel) {
    if (!viewModel?.getMasterRecordKey) return [];
    return (records || []).filter(record => isSelected(viewModel.getMasterRecordKey(record)));
  }

  function parseCurrency(value) {
    const text = String(value ?? '').trim();
    if (!text) return 0;

    const negative = /^\(.*\)$/.test(text);
    const numeric = Number(text.replace(/[$,\s()]/g, ''));
    if (!Number.isFinite(numeric)) return 0;
    return negative ? -numeric : numeric;
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function readSelections() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return stored && typeof stored.selectedByKey === 'object'
        ? { ...stored.selectedByKey }
        : {};
    } catch (error) {
      return {};
    }
  }

  function writeSelections() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        schema: 'DLE_OPERATIONS_PROJECTION_V1',
        version: '1.0',
        updatedAt: new Date().toLocaleString(),
        selectedByKey: state.selectedByKey
      }));
    } catch (error) {
      // Projection selection is a planning convenience; table state remains usable if browser storage is unavailable.
    }
  }

  window.OperationsCenter.projection = {
    initialize,
    isActive,
    setActive,
    toggleActive,
    isSelected,
    setSelected,
    getSelectedRecords,
    getSummary,
    formatCurrency,
    state
  };
})();
