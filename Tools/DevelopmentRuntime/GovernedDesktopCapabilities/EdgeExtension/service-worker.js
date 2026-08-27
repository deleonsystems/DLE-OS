importScripts('contract.js');

const nativeHostName = 'com.dlemfg.dleos.dev.desktop_capabilities';
const serviceWorkerStartupUtc = new Date().toISOString();

function sendDiagnostic(sender, eventName, correlationId, errorCategory, timestampUtc) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) return;
  const diagnostic = {
    kind: 'dle-os-desktop-capability-diagnostic',
    timestampUtc: String(timestampUtc || new Date().toISOString()).slice(0, 40),
    correlationId: String(correlationId || 'not-provided').slice(0, 128),
    event: String(eventName || '').slice(0, 80)
  };
  const boundedCategory = String(errorCategory || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
  if (boundedCategory) diagnostic.errorCategory = boundedCategory;
  chrome.tabs.sendMessage(tabId, diagnostic, () => {
    void chrome.runtime.lastError;
  });
}

function normalizeNativeMessagingFailure(errorText) {
  const normalized = String(errorText || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (/host (?:is )?not found|host name is not registered|specified native messaging host not found/i.test(normalized)) {
    return 'HostNotFound';
  }
  if (/access to the specified native messaging host is forbidden|forbidden/i.test(normalized)) {
    return 'HostOriginRejected';
  }
  if (/failed to start|could not start|cannot start/i.test(normalized)) {
    return 'HostStartFailure';
  }
  if (/host has exited|native host.*exited/i.test(normalized)) {
    return 'HostExited';
  }
  if (/communicat(?:e|ing).*native messaging host|pipe|framing/i.test(normalized)) {
    return 'HostCommunicationFailure';
  }
  if (/invalid.*(?:host|manifest)|configuration/i.test(normalized)) {
    return 'HostConfigurationInvalid';
  }
  if (!normalized) return 'HostNoResponse';
  return 'NativeMessagingOther';
}

function recordNativeMessagingFailure(correlationId, errorText) {
  const boundedError = String(errorText || 'No response was returned by the native messaging host.')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 240);
  console.warn('[DLE-OS Native Messaging Diagnostic]', JSON.stringify({
    timestampUtc: new Date().toISOString(),
    correlationId: String(correlationId || 'not-provided').slice(0, 128),
    category: normalizeNativeMessagingFailure(boundedError),
    edgeError: boundedError
  }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const correlationId = typeof message?.correlationId === 'string'
    ? message.correlationId : 'not-provided';
  sendDiagnostic(sender, 'service-worker-startup', correlationId, '', serviceWorkerStartupUtc);
  sendDiagnostic(sender, 'service-worker-message-received', correlationId);
  sendDiagnostic(sender, 'service-worker-handler-start', correlationId);
  if (!DleDesktopContract.isApprovedSender(sender) || !DleDesktopContract.isExactRequest(message)) {
    sendDiagnostic(sender, 'service-worker-response-sent', correlationId, 'RejectedByExtension');
    sendResponse({
      version: DleDesktopContract.version,
      operation: DleDesktopContract.operation,
      correlationId,
      success: false,
      category: 'RejectedByExtension',
      message: 'Desktop folder access is unavailable.'
    });
    return false;
  }

  sendDiagnostic(sender, 'native-messaging-call-start', message.correlationId);
  chrome.runtime.sendNativeMessage(nativeHostName, message, response => {
    const nativeMessagingError = chrome.runtime.lastError?.message || '';
    if (nativeMessagingError || !response || typeof response !== 'object') {
      const errorCategory = normalizeNativeMessagingFailure(nativeMessagingError);
      sendDiagnostic(sender, 'native-messaging-callback-error', message.correlationId, errorCategory);
      recordNativeMessagingFailure(message.correlationId, nativeMessagingError);
      sendDiagnostic(sender, 'service-worker-response-sent', message.correlationId,
        'NativeHostUnavailable');
      sendResponse({
        version: DleDesktopContract.version,
        operation: DleDesktopContract.operation,
        correlationId: message.correlationId,
        success: false,
        category: 'NativeHostUnavailable',
        message: 'Desktop folder access is unavailable.'
      });
      return;
    }
    sendDiagnostic(sender, 'native-messaging-callback-success', message.correlationId);
    const bounded = {
      version: response.version,
      operation: response.operation,
      correlationId: response.correlationId,
      success: response.success === true,
      category: String(response.category || '').slice(0, 80),
      message: String(response.message || '').slice(0, 160)
    };
    if (bounded.version !== DleDesktopContract.version ||
        bounded.operation !== DleDesktopContract.operation ||
        bounded.correlationId !== message.correlationId) {
      bounded.success = false;
      bounded.category = 'InvalidNativeHostResponse';
      bounded.message = 'Desktop folder access is unavailable.';
    }
    sendDiagnostic(sender, 'service-worker-response-sent', message.correlationId,
      bounded.success ? '' : bounded.category);
    sendResponse(bounded);
  });
  return true;
});
