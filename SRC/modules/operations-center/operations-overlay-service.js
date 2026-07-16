/* -----------------------------------------------------
   460 - JS: OPERATIONS OVERLAY SERVICE
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const overlaySchema = window.OperationsCenter.overlaySchema;
  const state = window.OperationsCenter.state;
  const stateActions = window.OperationsCenter.stateActions;

  async function initializeOverlay() {
    let loaded = false;

    try {
      const result = window.DleApiClient?.getJsonWithFallback
        ? await window.DleApiClient.getJsonWithFallback('operationsOverlay', overlaySchema.dataPath, {
          apiPersistenceMode: 'DLE-OS-HOST API read-only',
          fallbackPersistenceMode: 'Project JSON fallback read-only'
        })
        : null;

      if (result) {
        stateActions.setOverlayDataset(result.data, {
          sourceFile: result.source,
          persistenceMode: result.persistenceMode
        });
        loaded = true;
      } else {
        const response = await fetch(overlaySchema.dataPath, { cache: 'no-store' });
        if (response.ok) {
          const dataset = await response.json();
          stateActions.setOverlayDataset(dataset, {
            sourceFile: overlaySchema.dataPath,
            persistenceMode: 'Project JSON loaded read-only'
          });
          loaded = true;
        }
      }
    } catch (error) {
      loaded = false;
    }

    if (!loaded) {
      const stored = readLocalStorageDataset();
      if (stored) {
        stateActions.setOverlayDataset(stored, {
          sourceFile: 'Browser storage fallback',
          persistenceMode: 'Browser storage fallback'
        });
        loaded = true;
      }
    }

    if (!loaded) {
      stateActions.setOverlayDataset(overlaySchema.createEmptyDataset(), {
        sourceFile: overlaySchema.dataPath,
        persistenceMode: 'Initialized empty overlay'
      });
    }

    state.loaded = true;
  }

  async function saveOverlay() {
    const pendingOverlayByKey = stateActions.buildPendingOverlayByKey();
    const dataset = overlaySchema.buildDatasetForWrite(pendingOverlayByKey, {
      createdAt: state.createdAt
    });

    const result = await writeDataset(dataset);
    stateActions.commitSavedOverlay(pendingOverlayByKey, dataset, result);
    return dataset;
  }

  async function writeDataset(dataset) {
    if (state.fileHandle) {
      await writeFileHandle(state.fileHandle, dataset);
      writeLocalStorageDataset(dataset);
      return {
        fileHandle: state.fileHandle,
        sourceFile: state.sourceFile,
        writable: true,
        persistenceMode: 'Writable file handle'
      };
    }

    if (!window.showSaveFilePicker) {
      writeLocalStorageDataset(dataset);
      return {
        sourceFile: 'Browser storage fallback',
        writable: false,
        persistenceMode: 'Browser storage fallback'
      };
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: 'operations-overlay.json',
      types: [{
        description: 'Operations Overlay JSON',
        accept: { 'application/json': ['.json'] }
      }]
    });

    await writeFileHandle(handle, dataset);
    writeLocalStorageDataset(dataset);
    return {
      fileHandle: handle,
      sourceFile: handle.name || 'operations-overlay.json',
      writable: true,
      persistenceMode: 'Writable file handle'
    };
  }

  async function writeFileHandle(handle, dataset) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(dataset, null, 2));
    await writable.close();
    await verifyFileWrite(handle, dataset);
  }

  async function verifyFileWrite(handle, expectedDataset) {
    if (!handle?.getFile) return;
    const file = await handle.getFile();
    const text = await file.text();
    const actualDataset = JSON.parse(text);
    const actualCount = Array.isArray(actualDataset.records) ? actualDataset.records.length : 0;
    if (actualDataset.schema !== overlaySchema.schemaName || actualCount !== expectedDataset.records.length) {
      throw new Error('Operations Overlay JSON verification failed after write.');
    }
  }

  function writeLocalStorageDataset(dataset) {
    try {
      localStorage.setItem(overlaySchema.storageKey, JSON.stringify(dataset));
    } catch (error) {
      // Browser storage is a convenience fallback. File writes remain the preferred persistence path.
    }
  }

  function readLocalStorageDataset() {
    try {
      const stored = localStorage.getItem(overlaySchema.storageKey);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      return null;
    }
  }

  window.OperationsCenter.overlayService = {
    initializeOverlay,
    saveOverlay
  };
})();
