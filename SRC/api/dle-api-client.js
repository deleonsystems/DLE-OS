/* -----------------------------------------------------
   120 - JS: DLE API CLIENT
----------------------------------------------------- */

(function () {
  'use strict';

  const DEFAULT_BASE_URL = 'http://DLE-OS-HOST:5041';
  const DEFAULT_ENDPOINTS = Object.freeze({
    masterData: '/api/masterdata',
    operationsOverlay: '/api/operations/overlay',
    shipmentStaging: '/api/shipments/staging',
    shipmentHistory: '/api/shipments/history',
    platformReadiness: '/api/platform/v1/readiness',
    platformSnapshot: '/api/platform/v1/snapshot',
    canonicalWorkOrders: '/api/platform/v1/work-orders',
    canonicalInventoryItems: '/api/platform/v1/inventory-items',
    canonicalBillsOfMaterial: '/api/platform/v1/bills-of-material',
    canonicalGeneralLedgerAccounts: '/api/platform/v1/general-ledger-accounts'
  });
  const DEVELOPMENT_LIVE_CANONICAL_BASE_URL =
    window.location.protocol + '//' + window.location.hostname + ':5052';
  const LIVE_CANONICAL_BASE_URL = window.location.port === '5051'
    ? DEVELOPMENT_LIVE_CANONICAL_BASE_URL
    : 'http://DLE-OS-HOST:5042';
  const LIVE_SNAPSHOT_REFRESH_BASE_URL = 'http://DLE-OS-HOST:5043';
  const CUSTOMER_FILES_CONTROL_BASE_URL = 'http://DLE-OS-HOST:5053';
  const SHIPMENT_HISTORY_PATH = 'DATA/shipment-history/shipment-history.json';
  const LIVE_CANONICAL_ENDPOINTS = Object.freeze({
    platformReadiness: '/api/platform/live/v1/readiness',
    platformSnapshot: '/api/platform/live/v1/snapshot',
    canonicalWorkOrders: '/api/platform/live/v1/work-orders',
    canonicalInventoryItems: '/api/platform/live/v1/inventory-items',
    canonicalBillsOfMaterial: '/api/platform/live/v1/bills-of-material',
    canonicalGeneralLedgerAccounts: '/api/platform/live/v1/general-ledger-accounts',
    canonicalSalesOrders: '/api/platform/live/v1/sales-orders',
    canonicalSalesOrderWorkOrderRelationships: '/api/platform/live/v1/sales-order-work-order-relationships',
    canonicalInvoiceHistory: '/api/platform/live/v1/invoice-history',
    canonicalInvoiceHistoryMetadata: '/api/platform/live/v1/invoice-history/metadata',
    canonicalCustomerMaster: '/api/platform/live/v1/customer-master',
    canonicalCustomerMasterMetadata: '/api/platform/live/v1/customer-master/metadata',
    canonicalCustomerDirectory: '/api/platform/live/v1/customer-directory/search',
    canonicalVendorMaster: '/api/platform/live/v1/vendor-master',
    canonicalVendorMasterMetadata: '/api/platform/live/v1/vendor-master/metadata',
    canonicalPurchaseOrders: '/api/platform/live/v1/purchase-orders',
    canonicalPurchaseOrderMetadata: '/api/platform/live/v1/purchase-orders/metadata',
    canonicalReceivingHistory: '/api/platform/live/v1/receiving-history',
    canonicalReceivingHistoryMetadata: '/api/platform/live/v1/receiving-history/metadata',
    canonicalEmployeeReference: '/api/platform/live/v1/employee-reference',
    canonicalEmployeeReferenceMetadata: '/api/platform/live/v1/employee-reference/metadata',
    canonicalReferenceCodes: '/api/platform/live/v1/reference-codes',
    canonicalReferenceCodeMetadata: '/api/platform/live/v1/reference-codes/metadata'
  });

  const CANONICAL_FILTERS = Object.freeze({
    canonicalWorkOrders: Object.freeze(['workOrderNumber', 'itemNumber', 'status']),
    canonicalInventoryItems: Object.freeze(['itemNumber', 'itemDescription']),
    canonicalBillsOfMaterial: Object.freeze(['billNumber', 'drawingNumber', 'drawingRevision', 'bomRevision']),
    canonicalGeneralLedgerAccounts: Object.freeze(['accountNumber', 'accountDescription']),
    canonicalSalesOrders: Object.freeze([
      'customerNumber', 'customerName', 'salesOrderNumber',
      'customerPurchaseOrderNumber', 'itemNumber', 'workOrderNumber',
      'estimatedShipDate', 'negativeQuantity', 'unresolvedWorkOrder'
    ]),
    canonicalSalesOrderWorkOrderRelationships: Object.freeze([
      'customerNumber', 'salesOrderNumber', 'salesOrderLineNumber', 'workOrderNumber'
    ]),
    canonicalInvoiceHistory: Object.freeze([
      'invoiceDateFrom', 'invoiceDateTo', 'customerNumber',
      'invoiceNumber', 'salesOrderNumber', 'itemNumber', 'workOrderNumber'
    ]),
    canonicalCustomerMaster: Object.freeze([
      'customerNumber', 'customerName', 'postalCode', 'contactName',
      'salespersonCode', 'territoryCode'
    ]),
    canonicalVendorMaster: Object.freeze([
      'vendorNumber', 'vendorName', 'postalCode', 'contactName',
      'paymentTermsCode'
    ]),
    canonicalPurchaseOrders: Object.freeze([
      'purchaseOrderNumber', 'vendorNumber', 'vendorName', 'status',
      'openOnly', 'lineType', 'itemNumber', 'workOrderNumber', 'salesOrderNumber',
      'requiredFrom', 'requiredTo', 'promisedFrom', 'promisedTo'
    ]),
    canonicalReceivingHistory: Object.freeze([
      'receiverNumber', 'receiptFrom', 'receiptTo', 'purchaseOrderNumber',
      'purchaseOrderLineNumber', 'vendorNumber', 'vendorName', 'itemNumber',
      'packingSlipNumber', 'workOrderNumber', 'warehouseId',
      'inspectionStatus', 'rejectedOnly', 'returnedOnly'
    ]),
    canonicalEmployeeReference: Object.freeze([
      'employeeNumber', 'employeeName', 'department', 'jobTitle',
      'isActive', 'operationalCode', 'codeType'
    ]),
    canonicalReferenceCodes: Object.freeze([
      'codeDomain', 'codeType', 'codeValue', 'description',
      'resolutionStatus', 'sourceType'
    ])
  });

  // Qualified canonical SQL representations:
  // Customer.CustomerNumber is nvarchar(6);
  // SalesOrder.SalesOrderNumber and WorkOrder.WorkOrderNumber are nvarchar(7);
  // InventoryItem.ItemNumber and WorkOrder.ItemNumber are padding-preserved
  // nvarchar(20).
  const CANONICAL_FIELD_WIDTHS = Object.freeze({
    customerNumber: 6,
    vendorNumber: 6,
    receiverNumber: 7,
    purchaseOrderNumber: 7,
    purchaseOrderLineNumber: 3,
    salesOrderNumber: 7,
    salesOrderLineNumber: 3,
    workOrderNumber: 7,
    itemNumber: 20,
    employeeNumber: 9
  });

  function getConfig() {
    const runtimeConfig = window.DLE_API_CONFIG || {};
    const storedConfig = readStoredConfig();
    return {
      enabled: runtimeConfig.enabled ?? storedConfig.enabled ?? true,
      baseUrl: normalizeBaseUrl(runtimeConfig.baseUrl || storedConfig.baseUrl || getLocalDevelopmentBaseUrl() || DEFAULT_BASE_URL),
      endpoints: {
        ...DEFAULT_ENDPOINTS,
        ...(storedConfig.endpoints || {}),
        ...(runtimeConfig.endpoints || {})
      }
    };
  }

  function readStoredConfig() {
    try {
      return JSON.parse(localStorage.getItem('DLE_OS_API_CONFIG') || '{}');
    } catch (error) {
      return {};
    }
  }

  function normalizeBaseUrl(baseUrl) {
    const normalizedBaseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (/^https?:\/\/DLE-OS-HOST$/i.test(normalizedBaseUrl)) {
      return DEFAULT_BASE_URL;
    }
    return normalizedBaseUrl;
  }

  function buildUrl(endpoint) {
    if (/^https?:\/\//i.test(endpoint)) return endpoint;
    const config = getConfig();
    return config.baseUrl + '/' + String(endpoint || '').replace(/^\/+/, '');
  }

  async function getJson(endpointKey, options = {}) {
    const config = getConfig();
    if (!config.enabled) {
      throw new Error('DLE API client is disabled.');
    }

    const endpoint = options.endpoint || config.endpoints[endpointKey];
    if (!endpoint) {
      throw new Error('DLE API endpoint is not configured for ' + endpointKey + '.');
    }

    return requestJson(buildUrl(endpoint), endpointKey, options);
  }

  function getLiveJson(endpointKey, options = {}) {
    const endpoint = options.endpoint || LIVE_CANONICAL_ENDPOINTS[endpointKey];
    if (!endpoint) {
      throw new Error('LIVE canonical endpoint is not configured for ' + endpointKey + '.');
    }
    const configuredBaseUrl = window.DLE_API_CONFIG?.liveCanonicalBaseUrl;
    const baseUrl = normalizeBaseUrl(configuredBaseUrl || LIVE_CANONICAL_BASE_URL);
    const url = baseUrl + '/' + String(endpoint).replace(/^\/+/, '');
    return requestJson(url, 'liveCanonical.' + endpointKey, options);
  }

  async function requestLiveSnapshotRefresh(path, options = {}) {
    const response = await fetch(
      LIVE_SNAPSHOT_REFRESH_BASE_URL + '/' + String(path).replace(/^\/+/, ''),
      {
        method: options.method || 'GET',
        cache: 'no-store',
        credentials: 'include',
        signal: options.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined
            ? {}
            : { 'Content-Type': 'application/json' })
        },
        body: options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
      }
    );
    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
    if (!response.ok) {
      const requestError = new Error(
        typeof body?.message === 'string'
          ? body.message
          : 'The governed ERP snapshot refresh control returned HTTP ' + response.status + '.'
      );
      requestError.name = 'DleApiError';
      requestError.status = response.status;
      requestError.code = typeof body?.code === 'string' ? body.code : 'http_error';
      throw requestError;
    }
    return body;
  }

  async function requestWorkOrderApproval(path, options = {}) {
    const response = await fetch(
      LIVE_SNAPSHOT_REFRESH_BASE_URL + '/api/work-order-approvals/v2/' +
        String(path).replace(/^\/+/, ''),
      {
        method: options.method || 'GET',
        cache: 'no-store',
        credentials: 'include',
        signal: options.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      }
    );
    let body = null;
    try { body = await response.json(); } catch (error) { body = null; }
    if (!response.ok) {
      const requestError = new Error(body?.message ||
        'Work Order approval control returned HTTP ' + response.status + '.');
      requestError.name = 'DleApiError';
      requestError.status = response.status;
      requestError.code = body?.code || 'work_order_approval_http_error';
      throw requestError;
    }
    return body;
  }

  function buildWorkOrderApprovalLinePath(customerNumber, salesOrderNumber, lineNumber) {
    const normalize = (value, width, label) => {
      const text = String(value || '').trim();
      if (!new RegExp('^[0-9]{1,' + width + '}$').test(text)) {
        throw new TypeError(label + ' is malformed.');
      }
      return encodeURIComponent(text.padStart(width, '0'));
    };
    return 'sales-order-lines/' + [
      normalize(customerNumber, 6, 'Customer number'),
      normalize(salesOrderNumber, 7, 'Sales Order number'),
      normalize(lineNumber, 3, 'Sales Order line number')
    ].join('/');
  }

  async function requestKittingDisposition(workOrderNumber, suffix = '', options = {}) {
    const normalized = String(workOrderNumber || '').trim();
    if (!/^[0-9]{1,7}$/.test(normalized)) throw new TypeError('Work Order number is malformed.');
    const response = await fetch(
      LIVE_SNAPSHOT_REFRESH_BASE_URL + '/api/kitting-dispositions/v1/work-orders/' +
        encodeURIComponent(normalized.padStart(7, '0')) + suffix,
      {
        method: options.method || 'GET', cache: 'no-store', credentials: 'include', signal: options.signal,
        headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      }
    );
    let body = null;
    try { body = await response.json(); } catch (error) { body = null; }
    if (!response.ok) {
      const requestError = new Error(body?.message || 'Kitting disposition control returned HTTP ' + response.status + '.');
      requestError.name = 'DleApiError'; requestError.status = response.status;
      requestError.code = body?.code || 'kitting_disposition_http_error'; throw requestError;
    }
    return body;
  }

  async function requestRmaRework(path, options = {}) {
    const response = await fetch(
      LIVE_SNAPSHOT_REFRESH_BASE_URL + '/api/rma-rework/v1/' + String(path).replace(/^\/+/, ''),
      {
        method: options.method || 'GET', cache: 'no-store', credentials: 'include', signal: options.signal,
        headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      }
    );
    let body = null;
    try { body = await response.json(); } catch (error) { body = null; }
    if (!response.ok) {
      const requestError = new Error(body?.message || 'RMA/Rework case control returned HTTP ' + response.status + '.');
      requestError.name = 'DleApiError'; requestError.status = response.status;
      requestError.code = body?.code || 'rma_rework_http_error'; throw requestError;
    }
    return body;
  }

  async function requestCustomerFiles(path, options = {}) {
    const response = await fetch(
      CUSTOMER_FILES_CONTROL_BASE_URL + '/' + String(path).replace(/^\/+/, ''),
      {
        method: options.method || 'GET',
        cache: 'no-store',
        credentials: 'include',
        signal: options.signal,
        headers: {
          Accept: 'application/json'
        }
      }
    );
    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
    if (!response.ok) {
      const requestError = new Error(
        typeof body?.message === 'string'
          ? body.message
          : 'Customer Files control returned HTTP ' + response.status + '.'
      );
      requestError.name = 'DleApiError';
      requestError.status = response.status;
      requestError.code = typeof body?.code === 'string'
        ? body.code
        : 'customer_files_http_error';
      throw requestError;
    }
    return body;
  }

  async function searchHistoricalAssemblies(assemblyNumber, rfqCustomerNumber, options = {}) {
    const query = String(assemblyNumber || '').trim();
    if (!query || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) {
      throw new TypeError('A valid assembly number is required.');
    }
    if (!window.DleRfqAssemblyHistory?.buildSearchResponse) {
      throw new Error('RFQ historical assembly search is unavailable.');
    }
    const invoiceRecords = [];
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= 20) {
      const response = await liveCanonicalClient.getCanonicalInvoiceHistory({
        page,
        pageSize: 200,
        itemNumber: query,
        signal: options.signal
      });
      invoiceRecords.push(...(Array.isArray(response?.items) ? response.items : []));
      hasMore = Boolean(response?.hasMore);
      page += 1;
    }
    if (hasMore) throw new Error('Invoice History exceeded the bounded RFQ search limit.');
    const shipmentResponse = await fetch(SHIPMENT_HISTORY_PATH, {
      cache: 'no-store',
      signal: options.signal
    });
    if (!shipmentResponse.ok) {
      throw new Error('Qualified Shipment History is unavailable.');
    }
    const shipmentData = await shipmentResponse.json();
    return window.DleRfqAssemblyHistory.buildSearchResponse({
      assemblyNumber: query,
      rfqCustomerNumber,
      invoiceRecords,
      shipmentRecords: Array.isArray(shipmentData?.records)
        ? shipmentData.records
        : []
    });
  }

  async function requestJson(url, endpointKey, options) {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch (error) {
        body = null;
      }
      const requestError = new Error(
        typeof body?.message === 'string'
          ? body.message
          : 'DLE API request failed for ' + endpointKey + '. HTTP ' + response.status + '.'
      );
      requestError.name = 'DleApiError';
      requestError.status = response.status;
      requestError.code = typeof body?.code === 'string' ? body.code : 'http_error';
      throw requestError;
    }

    return response.json();
  }

  function getLocalDevelopmentBaseUrl() {
    const pageLocation = window.location;
    if (!pageLocation || !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(pageLocation.hostname || '')) {
      return '';
    }
    return pageLocation.origin || '';
  }

  function buildCanonicalListEndpoint(endpointKey, options = {}, endpoints = getConfig().endpoints) {
    const endpoint = endpoints[endpointKey];
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;

    if (!Number.isInteger(page) || page < 1) {
      throw new RangeError('Canonical page must be an integer of at least 1.');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw new RangeError('Canonical pageSize must be an integer between 1 and 200.');
    }

    const query = new URLSearchParams();
    query.set('page', String(page));
    query.set('pageSize', String(pageSize));
    CANONICAL_FILTERS[endpointKey].forEach(filterName => {
      const filterValue = normalizeCanonicalFilterValue(endpointKey, filterName, options[filterName]);
      if (filterValue !== undefined && filterValue !== null && filterValue !== '') {
        query.set(filterName, String(filterValue));
      }
    });
    return endpoint + '?' + query.toString();
  }

  function normalizeCanonicalFilterValue(endpointKey, filterName, value) {
    const isCustomerNumber =
      (
        endpointKey === 'canonicalSalesOrders' ||
        endpointKey === 'canonicalSalesOrderWorkOrderRelationships' ||
        endpointKey === 'canonicalInvoiceHistory' ||
        endpointKey === 'canonicalCustomerMaster'
      ) &&
      filterName === 'customerNumber';
    const isVendorNumber =
      (
        endpointKey === 'canonicalVendorMaster' ||
        endpointKey === 'canonicalPurchaseOrders' ||
        endpointKey === 'canonicalReceivingHistory'
      ) &&
      filterName === 'vendorNumber';
    const isPurchaseOrderNumber =
      (
        endpointKey === 'canonicalPurchaseOrders' ||
        endpointKey === 'canonicalReceivingHistory'
      ) &&
      filterName === 'purchaseOrderNumber';
    const isPurchaseOrderLineNumber =
      endpointKey === 'canonicalReceivingHistory' &&
      filterName === 'purchaseOrderLineNumber';
    const isReceiverNumber =
      endpointKey === 'canonicalReceivingHistory' &&
      filterName === 'receiverNumber';
    const isSalesOrderNumber =
      (
        endpointKey === 'canonicalSalesOrders' ||
        endpointKey === 'canonicalSalesOrderWorkOrderRelationships' ||
        endpointKey === 'canonicalInvoiceHistory' ||
        endpointKey === 'canonicalPurchaseOrders'
      ) &&
      filterName === 'salesOrderNumber';
    const isSalesOrderLineNumber =
      endpointKey === 'canonicalSalesOrderWorkOrderRelationships' &&
      filterName === 'salesOrderLineNumber';
    const isInvoiceNumber =
      endpointKey === 'canonicalInvoiceHistory' &&
      filterName === 'invoiceNumber';
    const isWorkOrderNumber =
      (
        endpointKey === 'canonicalWorkOrders' ||
        endpointKey === 'canonicalSalesOrderWorkOrderRelationships' ||
        endpointKey === 'canonicalInvoiceHistory' ||
        endpointKey === 'canonicalPurchaseOrders' ||
        endpointKey === 'canonicalReceivingHistory'
      ) &&
      filterName === 'workOrderNumber';
    const isItemNumber =
      filterName === 'itemNumber' &&
      (
        endpointKey === 'canonicalInventoryItems' ||
        endpointKey === 'canonicalWorkOrders'
      );
    const isEmployeeNumber =
      endpointKey === 'canonicalEmployeeReference' &&
      filterName === 'employeeNumber';
    if (!isCustomerNumber && !isVendorNumber && !isPurchaseOrderNumber &&
        !isPurchaseOrderLineNumber && !isReceiverNumber &&
        !isSalesOrderNumber && !isSalesOrderLineNumber && !isInvoiceNumber &&
        !isWorkOrderNumber && !isItemNumber && !isEmployeeNumber) {
      if ((endpointKey === 'canonicalCustomerMaster' ||
           endpointKey === 'canonicalVendorMaster' ||
           endpointKey === 'canonicalPurchaseOrders' ||
           endpointKey === 'canonicalReceivingHistory' ||
           endpointKey === 'canonicalEmployeeReference') &&
          value !== undefined && value !== null) {
        return String(value).trim();
      }
      return value;
    }
    if (value === undefined || value === null) return value;

    const normalizedValue = String(value).trim();
    if (isCustomerNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.customerNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isVendorNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.vendorNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isPurchaseOrderNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.purchaseOrderNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isPurchaseOrderLineNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.purchaseOrderLineNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isReceiverNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.receiverNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isSalesOrderNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.salesOrderNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isSalesOrderLineNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.salesOrderLineNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isInvoiceNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.salesOrderNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isWorkOrderNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.workOrderNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }
    if (isEmployeeNumber) {
      const canonicalWidth = CANONICAL_FIELD_WIDTHS.employeeNumber;
      if (/^\d+$/.test(normalizedValue) && normalizedValue.length < canonicalWidth) {
        return normalizedValue.padStart(canonicalWidth, '0');
      }
      return normalizedValue;
    }

    const canonicalWidth = CANONICAL_FIELD_WIDTHS.itemNumber;
    if (normalizedValue.length > 0 && normalizedValue.length < canonicalWidth) {
      return normalizedValue.padEnd(canonicalWidth, ' ');
    }
    return normalizedValue;
  }

  function encodeCanonicalIdentifier(value) {
    if (value === undefined || value === null) {
      throw new TypeError('A canonical identifier is required.');
    }
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, character => (
      '%' + character.charCodeAt(0).toString(16).toUpperCase()
    ));
  }

  function getCanonicalList(endpointKey, options = {}) {
    return getJson(endpointKey, {
      endpoint: buildCanonicalListEndpoint(endpointKey, options),
      signal: options.signal
    });
  }

  function getCanonicalRecord(endpointKey, identifier, options = {}) {
    const endpoint = getConfig().endpoints[endpointKey];
    const normalizedIdentifier = normalizeCanonicalRecordIdentifier(
      endpointKey,
      identifier
    );
    return getJson(endpointKey, {
      endpoint: endpoint + '/' + encodeCanonicalIdentifier(normalizedIdentifier),
      signal: options.signal
    });
  }

  function getLiveCanonicalList(endpointKey, options = {}) {
    return getLiveJson(endpointKey, {
      endpoint: buildCanonicalListEndpoint(endpointKey, options, LIVE_CANONICAL_ENDPOINTS),
      signal: options.signal
    });
  }

  function getLiveCanonicalRecord(endpointKey, identifier, options = {}) {
    const normalizedIdentifier = normalizeCanonicalRecordIdentifier(
      endpointKey,
      identifier
    );
    return getLiveJson(endpointKey, {
      endpoint: LIVE_CANONICAL_ENDPOINTS[endpointKey] + '/' +
        encodeCanonicalIdentifier(normalizedIdentifier),
      signal: options.signal
    });
  }

  function normalizeCanonicalRecordIdentifier(endpointKey, identifier) {
    if (endpointKey === 'canonicalWorkOrders') {
      return normalizeCanonicalFilterValue(
          endpointKey,
          'workOrderNumber',
          identifier
        );
    }
    if (endpointKey === 'canonicalInventoryItems') {
      return normalizeCanonicalFilterValue(
        endpointKey,
        'itemNumber',
        identifier
      );
    }
    return identifier;
  }

  async function getJsonWithFallback(endpointKey, fallbackPath, options = {}) {
    try {
      const data = await getJson(endpointKey, options);
      return {
        data,
        source: 'API: ' + buildUrl((getConfig().endpoints || {})[endpointKey]),
        persistenceMode: options.apiPersistenceMode || 'DLE-OS-HOST API'
      };
    } catch (apiError) {
      console.warn('DLE API load failed; using temporary local fallback for ' + endpointKey + '.', apiError);
      const response = await fetch(fallbackPath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Unable to load local fallback for ' + endpointKey + ' from ' + fallbackPath + '. HTTP ' + response.status + '. API error: ' + (apiError.message || apiError));
      }
      return {
        data: await response.json(),
        source: fallbackPath,
        persistenceMode: options.fallbackPersistenceMode || 'Project JSON fallback',
        apiError
      };
    }
  }

  const liveCanonicalClient = Object.freeze({
    getPlatformReadiness(options = {}) {
      return getLiveJson('platformReadiness', options);
    },
    getPlatformSnapshot(options = {}) {
      return getLiveJson('platformSnapshot', options);
    },
    getCanonicalWorkOrders(options = {}) {
      return getLiveCanonicalList('canonicalWorkOrders', options);
    },
    getCanonicalWorkOrder(workOrderNumber, options = {}) {
      return getLiveCanonicalRecord('canonicalWorkOrders', workOrderNumber, options);
    },
    getCanonicalInventoryItems(options = {}) {
      return getLiveCanonicalList('canonicalInventoryItems', options);
    },
    getCanonicalInventoryItem(itemNumber, options = {}) {
      return getLiveCanonicalRecord('canonicalInventoryItems', itemNumber, options);
    },
    getCanonicalBillsOfMaterial(options = {}) {
      return getLiveCanonicalList('canonicalBillsOfMaterial', options);
    },
    getCanonicalBillOfMaterial(billNumber, options = {}) {
      return getLiveCanonicalRecord('canonicalBillsOfMaterial', billNumber, options);
    },
    getCanonicalGeneralLedgerAccounts(options = {}) {
      return getLiveCanonicalList('canonicalGeneralLedgerAccounts', options);
    },
    getCanonicalGeneralLedgerAccount(accountNumber, options = {}) {
      return getLiveCanonicalRecord('canonicalGeneralLedgerAccounts', accountNumber, options);
    },
    getCanonicalSalesOrders(options = {}) {
      return getLiveCanonicalList('canonicalSalesOrders', options);
    },
    getCanonicalSalesOrder(salesOrderLineId, options = {}) {
      return getLiveCanonicalRecord('canonicalSalesOrders', salesOrderLineId, options);
    },
    getCanonicalSalesOrderWorkOrderRelationships(options = {}) {
      return getLiveCanonicalList('canonicalSalesOrderWorkOrderRelationships', options);
    },
    getCanonicalInvoiceHistory(options = {}) {
      return getLiveCanonicalList('canonicalInvoiceHistory', options);
    },
    getCanonicalInvoiceHistoryLine(invoiceHistoryLineId, options = {}) {
      return getLiveCanonicalRecord(
        'canonicalInvoiceHistory',
        invoiceHistoryLineId,
        options
      );
    },
    getCanonicalInvoiceHistoryMetadata(options = {}) {
      return getLiveJson('canonicalInvoiceHistoryMetadata', options);
    },
    getCanonicalCustomerMaster(options = {}) {
      return getLiveCanonicalList('canonicalCustomerMaster', options);
    },
    getCanonicalCustomer(customerMasterId, options = {}) {
      return getLiveCanonicalRecord(
        'canonicalCustomerMaster',
        customerMasterId,
        options
      );
    },
    getCanonicalCustomerAddresses(customerMasterId, options = {}) {
      return getLiveJson('canonicalCustomerMaster', {
        ...options,
        endpoint: LIVE_CANONICAL_ENDPOINTS.canonicalCustomerMaster + '/' +
          encodeCanonicalIdentifier(customerMasterId) + '/addresses'
      });
    },
    getCanonicalCustomerMasterMetadata(options = {}) {
      return getLiveJson('canonicalCustomerMasterMetadata', options);
    },
    searchCanonicalCustomers(query, options = {}) {
      const normalizedQuery = String(query || '').trim();
      const page = options.page === undefined ? 1 : Number(options.page);
      const pageSize = options.pageSize === undefined ? 25 : Number(options.pageSize);
      if (!Number.isInteger(page) || page < 1) {
        throw new RangeError('Customer directory page must be at least 1.');
      }
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
        throw new RangeError('Customer directory page size must be between 1 and 50.');
      }
      const parameters = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (normalizedQuery) parameters.set('q', normalizedQuery);
      return getLiveJson('canonicalCustomerDirectory', {
        ...options,
        endpoint: LIVE_CANONICAL_ENDPOINTS.canonicalCustomerDirectory +
          '?' + parameters.toString()
      });
    },
    getCanonicalVendorMaster(options = {}) {
      return getLiveCanonicalList('canonicalVendorMaster', options);
    },
    getCanonicalVendor(vendorMasterId, options = {}) {
      return getLiveCanonicalRecord(
        'canonicalVendorMaster',
        vendorMasterId,
        options
      );
    },
    getCanonicalVendorAddresses(vendorMasterId, options = {}) {
      return getLiveJson('canonicalVendorMaster', {
        ...options,
        endpoint: LIVE_CANONICAL_ENDPOINTS.canonicalVendorMaster + '/' +
          encodeCanonicalIdentifier(vendorMasterId) + '/addresses'
      });
    },
    getCanonicalVendorMasterMetadata(options = {}) {
      return getLiveJson('canonicalVendorMasterMetadata', options);
    },
    getCanonicalPurchaseOrders(options = {}) {
      return getLiveCanonicalList('canonicalPurchaseOrders', options);
    },
    getCanonicalPurchaseOrderLine(purchaseOrderLineId, options = {}) {
      const id = String(purchaseOrderLineId || '');
      if (!/^\d{18}$/.test(id)) {
        throw new TypeError(
          'Purchase Order line identifier must contain firm, vendor, PO, and line.'
        );
      }
      const path = [
        id.slice(0, 2), id.slice(2, 8), id.slice(8, 15),
        'lines', id.slice(15, 18)
      ].map(encodeCanonicalIdentifier).join('/');
      return getLiveJson('canonicalPurchaseOrders', {
        ...options,
        endpoint: LIVE_CANONICAL_ENDPOINTS.canonicalPurchaseOrders + '/' + path
      });
    },
    getCanonicalPurchaseOrderMetadata(options = {}) {
      return getLiveJson('canonicalPurchaseOrderMetadata', options);
    },
    getCanonicalReceivingHistory(options = {}) {
      return getLiveCanonicalList('canonicalReceivingHistory', options);
    },
    getCanonicalReceivingHistoryLine(purchaseReceiptLineId, options = {}) {
      const id = String(purchaseReceiptLineId || '').trim();
      if (!/^[0-9a-f]{50}$/i.test(id)) {
        throw new TypeError(
          'Receiving History line identifier must be the 50-character hexadecimal fixed-width source identity.'
        );
      }
      return getLiveCanonicalRecord(
        'canonicalReceivingHistory',
        id,
        options
      );
    },
    getCanonicalReceivingHistoryMetadata(options = {}) {
      return getLiveJson('canonicalReceivingHistoryMetadata', options);
    },
    getCanonicalEmployeeReference(options = {}) {
      return getLiveCanonicalList('canonicalEmployeeReference', options);
    },
    getCanonicalEmployee(employeeReferenceId, options = {}) {
      const id = String(employeeReferenceId || '').trim();
      if (!/^\d{11}$/.test(id)) {
        throw new TypeError(
          'Employee Reference identifier must contain firm and employee number.'
        );
      }
      return getLiveCanonicalRecord(
        'canonicalEmployeeReference',
        id,
        options
      );
    },
    getCanonicalEmployeeCodes(employeeReferenceId, options = {}) {
      const id = String(employeeReferenceId || '').trim();
      if (!/^\d{11}$/.test(id)) {
        throw new TypeError(
          'Employee Reference identifier must contain firm and employee number.'
        );
      }
      return getLiveJson('canonicalEmployeeReference', {
        ...options,
        endpoint: LIVE_CANONICAL_ENDPOINTS.canonicalEmployeeReference + '/' +
          encodeCanonicalIdentifier(id) + '/codes'
      });
    },
    getCanonicalEmployeeReferenceMetadata(options = {}) {
      return getLiveJson('canonicalEmployeeReferenceMetadata', options);
    },
    getCanonicalReferenceCodes(options = {}) {
      return getLiveCanonicalList('canonicalReferenceCodes', options);
    },
    getCanonicalReferenceCode(referenceCodeId, options = {}) {
      const id = String(referenceCodeId || '').trim();
      if (!/^[1-9]\d*$/.test(id)) {
        throw new TypeError(
          'Reference Code identifier must be a positive integer.'
        );
      }
      return getLiveCanonicalRecord(
        'canonicalReferenceCodes',
        id,
        options
      );
    },
    getCanonicalReferenceCodeMetadata(options = {}) {
      return getLiveJson('canonicalReferenceCodeMetadata', options);
    },
    getSnapshotRefreshStatus(options = {}) {
      return requestLiveSnapshotRefresh('/api/platform/refresh/v1/status', options);
    },
    runSnapshotRefresh(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh/v1/run',
        { ...options, method: 'POST' }
      );
    },
    getInvoiceHistoryRefreshStatus(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh/invoice-history/v1/status',
        options
      );
    },
    runInvoiceHistoryRefresh(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh/invoice-history/v1/run',
        { ...options, method: 'POST' }
      );
    },
    getRefreshCenterStatus(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh-center/v1/status',
        options
      );
    },
    getRefreshCenterDataset(datasetId, options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh-center/v1/datasets/' +
          encodeURIComponent(String(datasetId || '')),
        options
      );
    },
    getRefreshCenterRuns(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh-center/v1/runs',
        options
      );
    },
    checkRefreshCenterDatasetSource(datasetId, options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh-center/v1/datasets/' +
          encodeURIComponent(String(datasetId || '')) + '/check-source',
        { ...options, method: 'POST' }
      );
    },
    refreshRefreshCenterDataset(datasetId, request = {}, options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh-center/v1/datasets/' +
          encodeURIComponent(String(datasetId || '')) + '/refresh',
        { ...options, method: 'POST', body: request }
      );
    },
    runRefreshCenterForceFull(request, options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/refresh-center/v1/core/force-full',
        { ...options, method: 'POST', body: request }
      );
    },
    getOperationsRefreshStatus(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/operations-refresh/v1/status',
        options
      );
    },
    getOperationsRefreshRuns(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/operations-refresh/v1/runs',
        options
      );
    },
    runOperationsRefresh(request = {}, options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/operations-refresh/v1/run',
        { ...options, method: 'POST', body: request }
      );
    },
    getOperationsRefreshSchedule(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/operations-refresh/v1/schedule',
        options
      );
    },
    setOperationsRefreshScheduleEnabled(enabled, options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/operations-refresh/v1/schedule/' +
          (enabled ? 'enable' : 'disable'),
        { ...options, method: 'POST' }
      );
    },
    getDailyOperationsSyncStatus(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/daily-operations-sync/v1/status', options
      );
    },
    getDailyOperationsSyncLatest(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/daily-operations-sync/v1/latest', options
      );
    },
    getDailyOperationsSyncLastSuccessful(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/daily-operations-sync/v1/last-successful', options
      );
    },
    runDailyOperationsSync(options = {}) {
      return requestLiveSnapshotRefresh(
        '/api/platform/daily-operations-sync/v1/run',
        { ...options, method: 'POST' }
      );
    },
    baseUrl: LIVE_CANONICAL_BASE_URL,
    endpoints: LIVE_CANONICAL_ENDPOINTS
  });

  window.DleApiClient = Object.freeze({
    getConfig,
    getJson,
    getJsonWithFallback,
    getPlatformReadiness(options = {}) {
      return getJson('platformReadiness', options);
    },
    getPlatformSnapshot(options = {}) {
      return getJson('platformSnapshot', options);
    },
    getCanonicalWorkOrders(options = {}) {
      return getCanonicalList('canonicalWorkOrders', options);
    },
    getCanonicalWorkOrder(workOrderNumber, options = {}) {
      return getCanonicalRecord('canonicalWorkOrders', workOrderNumber, options);
    },
    getCanonicalInventoryItems(options = {}) {
      return getCanonicalList('canonicalInventoryItems', options);
    },
    getCanonicalInventoryItem(itemNumber, options = {}) {
      return getCanonicalRecord('canonicalInventoryItems', itemNumber, options);
    },
    getCanonicalBillsOfMaterial(options = {}) {
      return getCanonicalList('canonicalBillsOfMaterial', options);
    },
    getCanonicalBillOfMaterial(billNumber, options = {}) {
      return getCanonicalRecord('canonicalBillsOfMaterial', billNumber, options);
    },
    getCanonicalGeneralLedgerAccounts(options = {}) {
      return getCanonicalList('canonicalGeneralLedgerAccounts', options);
    },
    getCanonicalGeneralLedgerAccount(accountNumber, options = {}) {
      return getCanonicalRecord('canonicalGeneralLedgerAccounts', accountNumber, options);
    },
    searchCanonicalCustomers(query, options = {}) {
      return liveCanonicalClient.searchCanonicalCustomers(query, options);
    },
    searchHistoricalAssemblies,
    getWorkOrderApprovalReview(customerNumber, salesOrderNumber, lineNumber, options = {}) {
      return requestWorkOrderApproval(
        buildWorkOrderApprovalLinePath(customerNumber, salesOrderNumber, lineNumber), options
      );
    },
    submitWorkOrderApprovalAction(customerNumber, salesOrderNumber, lineNumber,
        action, request, options = {}) {
      if (!['approve', 'replace', 'revoke'].includes(action)) {
        throw new TypeError('Work Order approval action is invalid.');
      }
      return requestWorkOrderApproval(
        buildWorkOrderApprovalLinePath(customerNumber, salesOrderNumber, lineNumber) + '/' + action,
        { ...options, method: 'POST', body: request }
      );
    },
    getKittingDisposition(workOrderNumber, options = {}) {
      return requestKittingDisposition(workOrderNumber, '', options);
    },
    getKittingDispositionHistory(workOrderNumber, options = {}) {
      return requestKittingDisposition(workOrderNumber, '/history', options);
    },
    appendKittingDisposition(workOrderNumber, request, options = {}) {
      return requestKittingDisposition(workOrderNumber, '/events',
        { ...options, method: 'POST', body: request });
    },
    reviewRmaReworkCaseMembers(members, options = {}) {
      return requestRmaRework('case-candidates/review', {
        ...options, method: 'POST', body: { members }
      });
    },
    matchRmaReworkCase(request, options = {}) {
      return requestRmaRework('case-candidates/match', { ...options, method: 'POST', body: request });
    },
    createRmaReworkCase(request, options = {}) {
      return requestRmaRework('cases', { ...options, method: 'POST', body: request });
    },
    addRmaReworkCaseMember(caseId, request, options = {}) {
      return requestRmaRework('cases/' + encodeURIComponent(String(caseId || '')) + '/members', {
        ...options, method: 'POST', body: request
      });
    },
    getRmaReworkCases(options = {}) {
      const parameters = new URLSearchParams();
      Object.entries(options).forEach(([key, value]) => {
        if (key !== 'signal' && value !== undefined && value !== null && value !== '') parameters.set(key, String(value));
      });
      return requestRmaRework('cases' + (parameters.size ? '?' + parameters.toString() : ''), options);
    },
    getRmaReworkCase(caseId, options = {}) {
      return requestRmaRework('cases/' + encodeURIComponent(String(caseId || '')), options);
    },
    getRmaReworkCaseHistory(caseId, options = {}) {
      return requestRmaRework('cases/' + encodeURIComponent(String(caseId || '')) + '/history', options);
    },
    getCustomerFolderStatus(customerNumber, options = {}) {
      return requestCustomerFiles(
        '/api/customer-files/v1/customers/' +
          encodeURIComponent(String(customerNumber || '')) +
          '/folder',
        options
      );
    },
    createCustomerFolder(customerNumber, options = {}) {
      return requestCustomerFiles(
        '/api/customer-files/v1/customers/' +
          encodeURIComponent(String(customerNumber || '')) +
          '/folder',
        { ...options, method: 'POST' }
      );
    },
    getRequirementsComplianceFolderStatus(customerNumber, options = {}) {
      return requestCustomerFiles(
        '/api/customer-files/v1/customers/' +
          encodeURIComponent(String(customerNumber || '')) +
          '/requirements-compliance',
        options
      );
    },
    createRequirementsComplianceFolder(customerNumber, options = {}) {
      return requestCustomerFiles(
        '/api/customer-files/v1/customers/' +
          encodeURIComponent(String(customerNumber || '')) +
          '/requirements-compliance',
        { ...options, method: 'POST' }
      );
    },
    liveCanonical: liveCanonicalClient,
    endpoints: DEFAULT_ENDPOINTS
  });
})();
