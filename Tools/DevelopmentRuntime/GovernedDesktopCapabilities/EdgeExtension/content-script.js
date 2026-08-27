(function () {
  'use strict';

  if (location.origin !== DleDesktopContract.approvedOrigin) return;

  const diagnosticAttribute = 'data-dle-os-desktop-capability-diagnostics';
  const diagnosticEvents = new Set([
    'content-script-send-start',
    'content-script-send-complete',
    'content-script-send-error',
    'service-worker-startup',
    'service-worker-message-received',
    'service-worker-handler-start',
    'native-messaging-call-start',
    'native-messaging-callback-success',
    'native-messaging-callback-error',
    'service-worker-response-sent',
    'content-script-response-received'
  ]);
  const diagnosticTrace = [];

  function recordDiagnostic(eventName, correlationId, errorCategory, timestampUtc) {
    if (!diagnosticEvents.has(eventName)) return;
    const record = {
      timestampUtc: String(timestampUtc || new Date().toISOString()).slice(0, 40),
      correlationId: String(correlationId || 'not-provided').slice(0, 128),
      event: eventName
    };
    const boundedCategory = String(errorCategory || '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
    if (boundedCategory) record.errorCategory = boundedCategory;
    diagnosticTrace.push(record);
    if (diagnosticTrace.length > 20) diagnosticTrace.shift();
    document.documentElement?.setAttribute(diagnosticAttribute, JSON.stringify(diagnosticTrace));
    document.dispatchEvent(new CustomEvent('dle-os-desktop-capability-diagnostic', {
      detail: record
    }));
  }

  function announceReady() {
    document.documentElement?.setAttribute('data-dle-os-desktop-capabilities', 'ready');
    document.dispatchEvent(new CustomEvent('dle-os-desktop-capabilities-ready'));
  }

  function announceResult(detail) {
    document.dispatchEvent(new CustomEvent('dle-os-desktop-capability-result', {
      detail: {
        operation: DleDesktopContract.operation,
        correlationId: String(detail?.correlationId || '').slice(0, 128),
        success: detail?.success === true,
        category: String(detail?.category || '').slice(0, 80),
        message: String(detail?.message || 'Desktop folder access is unavailable.').slice(0, 160)
      }
    }));
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-dle-desktop-operation="open-drawing-folder"]')
      : null;
    if (!target) return;
    const request = DleDesktopContract.createRequest(
      target.getAttribute('data-dle-desktop-capability'),
      target.getAttribute('data-dle-desktop-correlation-id'));
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!request) {
      announceResult({ success: false, category: 'InvalidPageCapability' });
      return;
    }
    announceResult({
      correlationId: request.correlationId,
      success: false,
      category: 'Opening',
      message: 'Opening drawing folder...'
    });
    recordDiagnostic('content-script-send-start', request.correlationId);
    chrome.runtime.sendMessage(request, response => {
      const runtimeError = chrome.runtime.lastError?.message || '';
      if (runtimeError || !response) {
        recordDiagnostic('content-script-send-error', request.correlationId,
          runtimeError ? 'RuntimeMessageError' : 'NoResponse');
        announceResult({
          correlationId: request.correlationId,
          success: false,
          category: 'ExtensionUnavailable'
        });
        return;
      }
      recordDiagnostic('content-script-response-received', request.correlationId);
      recordDiagnostic('content-script-send-complete', request.correlationId);
      announceResult(response);
    });
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.kind !== 'dle-os-desktop-capability-diagnostic') return false;
    recordDiagnostic(
      String(message.event || ''),
      String(message.correlationId || ''),
      String(message.errorCategory || ''),
      String(message.timestampUtc || ''));
    return false;
  });

  if (document.documentElement) announceReady();
  else document.addEventListener('DOMContentLoaded', announceReady, { once: true });
})();
