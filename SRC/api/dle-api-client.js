/* -----------------------------------------------------
   120 - JS: DLE API CLIENT
----------------------------------------------------- */

(function () {
  'use strict';

  const DEFAULT_BASE_URL = 'http://DLE-OS-HOST';
  const DEFAULT_ENDPOINTS = Object.freeze({
    masterData: '/api/master-data',
    operationsOverlay: '/api/operations/overlay',
    shipmentStaging: '/api/shipments/staging',
    shipmentHistory: '/api/shipments/history'
  });

  function getConfig() {
    const runtimeConfig = window.DLE_API_CONFIG || {};
    const storedConfig = readStoredConfig();
    return {
      enabled: runtimeConfig.enabled ?? storedConfig.enabled ?? true,
      baseUrl: normalizeBaseUrl(runtimeConfig.baseUrl || storedConfig.baseUrl || DEFAULT_BASE_URL),
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
    return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
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

    const response = await fetch(buildUrl(endpoint), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error('DLE API request failed for ' + endpointKey + '. HTTP ' + response.status + '.');
    }

    return response.json();
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

  window.DleApiClient = Object.freeze({
    getConfig,
    getJson,
    getJsonWithFallback,
    endpoints: DEFAULT_ENDPOINTS
  });
})();
