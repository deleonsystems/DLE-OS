(function (scope) {
  'use strict';

  const version = 1;
  const operation = 'open-drawing-folder';
  const approvedOrigin = 'https://dev.dle-os.internal.dlemfg.com';
  const capabilityPattern = /^dlecap1_[A-Za-z0-9_-]{43}$/;

  function validCorrelationId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
      !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  }

  function createRequest(capability, correlationId) {
    if (!capabilityPattern.test(String(capability || '')) || !validCorrelationId(correlationId)) return null;
    return { version, operation, capability, correlationId };
  }

  function isApprovedSender(sender) {
    if (sender?.frameId !== 0 || typeof sender?.tab?.url !== 'string') return false;
    try {
      return new URL(sender.tab.url).origin === approvedOrigin;
    } catch {
      return false;
    }
  }

  function isExactRequest(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    const keys = Object.keys(message).sort().join(',');
    return keys === 'capability,correlationId,operation,version' &&
      message.version === version && message.operation === operation &&
      capabilityPattern.test(String(message.capability || '')) &&
      validCorrelationId(message.correlationId);
  }

  scope.DleDesktopContract = Object.freeze({
    version,
    operation,
    approvedOrigin,
    createRequest,
    isApprovedSender,
    isExactRequest
  });
})(globalThis);
