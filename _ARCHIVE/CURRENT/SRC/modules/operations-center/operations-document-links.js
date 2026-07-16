/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER DOCUMENT LINKS
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const documentTypes = {
    kitShort: {
      label: 'Kit Short',
      enabled: true,
      basePath: 'P:\\KITTING\\KIT-SHORTAGES',
      directoryPickerId: 'dle-kit-short-documents',
      buildFileName(workOrder) {
        return normalizeWorkOrder(workOrder) + '.pdf';
      }
    },
    purchasingComplete: {
      label: 'Purchasing Complete',
      enabled: true,
      basePath: 'P:\\Workstation Folder Shortcuts\\Purchasing\\Complete-Shortages',
      directoryPickerId: 'dle-purch-complete-docs',
      buildFileName(workOrder) {
        return normalizeWorkOrder(workOrder) + '.pdf';
      }
    },
    kitComplete: {
      label: 'Kit Complete',
      enabled: true,
      basePath: 'Kit Complete folder selected at runtime',
      directoryPickerId: 'dle-kit-complete-docs',
      buildFileName(workOrder) {
        return normalizeWorkOrder(workOrder) + '.pdf';
      }
    }
  };

  const documentState = {};

  function getTypeState(typeKey) {
    if (!documentState[typeKey]) {
      documentState[typeKey] = {
        connected: false,
        sourceName: '',
        fileByName: new Map()
      };
    }
    return documentState[typeKey];
  }

  function normalizeWorkOrder(workOrder) {
    return String(workOrder || '').trim();
  }

  function isUsableWorkOrder(workOrder) {
    const normalized = normalizeWorkOrder(workOrder);
    return !!normalized && normalized.toUpperCase() !== 'UNKNOWN';
  }

  function getWorkOrderAliases(workOrder) {
    const normalized = normalizeWorkOrder(workOrder);
    if (!isUsableWorkOrder(normalized)) return [];

    const aliases = [normalized];
    const withoutLeadingZeros = normalized.replace(/^0+/, '');
    if (withoutLeadingZeros && withoutLeadingZeros !== normalized) aliases.push(withoutLeadingZeros);
    return aliases;
  }

  function getCandidateFileNames(config, workOrder) {
    const candidates = [];
    getWorkOrderAliases(workOrder).forEach(alias => {
      const fileName = config.buildFileName(alias);
      if (fileName && !candidates.includes(fileName)) candidates.push(fileName);
    });
    return candidates;
  }

  async function connectType(typeKey) {
    const config = documentTypes[typeKey];
    if (!config) throw new Error('Unknown document link type: ' + typeKey);

    if (!config.enabled) {
      setStatus(config.label + ' document folder registration is reserved for a future phase.', '');
      return;
    }

    setStatus('Select the ' + config.label + ' folder: ' + config.basePath + '.', '');

    if (window.showDirectoryPicker) {
      const handle = await window.showDirectoryPicker({
        id: getDirectoryPickerId(typeKey, config),
        mode: 'read'
      });
      await indexDirectoryHandle(typeKey, handle);
      return;
    }

    const files = await promptForDirectoryFiles(config);
    indexFileList(typeKey, files, config.label);
  }

  function getDirectoryPickerId(typeKey, config) {
    const pickerId = String(config.directoryPickerId || typeKey || 'documents');
    return pickerId.length <= 32 ? pickerId : pickerId.slice(0, 32);
  }

  async function indexDirectoryHandle(typeKey, directoryHandle) {
    const state = getTypeState(typeKey);
    state.fileByName = new Map();

    for await (const [name, handle] of directoryHandle.entries()) {
      if (handle.kind === 'file') {
        state.fileByName.set(name.toUpperCase(), { fileHandle: handle });
      }
    }

    state.connected = true;
    state.sourceName = directoryHandle.name || documentTypes[typeKey].basePath;
    setStatus(buildConnectedMessage(typeKey), 'saved');
  }

  function indexFileList(typeKey, files, sourceName) {
    const state = getTypeState(typeKey);
    state.fileByName = new Map();

    Array.from(files || []).forEach(file => {
      if (file?.name) state.fileByName.set(file.name.toUpperCase(), { file });
    });

    state.connected = true;
    state.sourceName = sourceName || documentTypes[typeKey].basePath;
    setStatus(buildConnectedMessage(typeKey), 'saved');
  }

  function promptForDirectoryFiles(config) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'application/pdf,.pdf';
      input.setAttribute('webkitdirectory', '');
      input.style.display = 'none';

      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      });

      input.addEventListener('cancel', () => {
        input.remove();
        reject(new Error(config.label + ' folder selection was cancelled.'));
      });

      document.body.appendChild(input);
      input.click();
    });
  }

  function getDocumentState(typeKey, workOrder) {
    const config = documentTypes[typeKey];
    const state = getTypeState(typeKey);
    const normalizedWorkOrder = normalizeWorkOrder(workOrder);

    if (!config || !state.connected || !isUsableWorkOrder(normalizedWorkOrder)) {
      return {
        connected: state.connected,
        exists: false,
        fileName: '',
        candidateFileNames: []
      };
    }

    const candidateFileNames = getCandidateFileNames(config, normalizedWorkOrder);
    const match = candidateFileNames
      .map(fileName => ({
        fileName,
        entry: state.fileByName.get(fileName.toUpperCase())
      }))
      .find(candidate => candidate.entry);

    return {
      connected: state.connected,
      exists: !!match,
      fileName: match?.fileName || '',
      candidateFileNames,
      entry: match?.entry
    };
  }

  async function openDocument(typeKey, workOrder) {
    const config = documentTypes[typeKey];
    const result = getDocumentState(typeKey, workOrder);
    if (!config || !result.exists) {
      setStatus((config?.label || 'Document') + ' PDF was not found for this Work Order.', 'error');
      return;
    }

    const file = result.entry.file || await result.entry.fileHandle.getFile();
    const url = URL.createObjectURL(file);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function buildConnectedMessage(typeKey) {
    const config = documentTypes[typeKey];
    const state = getTypeState(typeKey);
    const count = state.fileByName.size;
    return config.label + ' folder connected. ' + count + ' PDF file' + (count === 1 ? '' : 's') + ' indexed.';
  }

  function getStatus(typeKey) {
    const config = documentTypes[typeKey];
    const state = getTypeState(typeKey);
    if (!config) return '';
    if (!config.enabled) return config.label + ' document folder support is reserved for a future phase.';
    if (!state.connected) return config.label + ' folder not connected. Expected source: ' + config.basePath + '.';
    return buildConnectedMessage(typeKey);
  }

  function getDocumentTypes() {
    return Object.entries(documentTypes).map(([key, config]) => ({
      key,
      label: config.label,
      enabled: !!config.enabled
    }));
  }

  function setStatus(message, stateClass) {
    const status = document.getElementById('operationsCenterDocumentStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.remove('dirty', 'saved', 'error');
    if (stateClass) status.classList.add(stateClass);
  }

  window.OperationsCenter.documentLinks = {
    connectType,
    getCandidateFileNames,
    getDocumentState,
    getDocumentTypes,
    getWorkOrderAliases,
    getStatus,
    openDocument,
    normalizeWorkOrder
  };
})();
