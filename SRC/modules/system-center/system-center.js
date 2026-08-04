(function () {
  'use strict';

  const SHIPMENT_HISTORY_VIEWER_PATH = 'DATA/shipment-history/shipment-history.json';
  const OPERATIONS_REFRESH_POLL_INTERVAL_MS = 3000;
  let platformRefreshCenterBusy = false;
  let operationsRefreshScheduleEnabled = false;
  let operationsRefreshPollTimer = null;
  let dailyOperationsSyncPollTimer = null;

  const shipmentHistoryDataViewerState = {
    dataset: null,
    records: [],
    selectedIndex: -1,
    fileHandle: null
  };

  const SHIPMENT_HISTORY_VIEWER_COLUMNS = [
    { label: 'Shipment ID', paths: ['shipmentId', 'identifiers.shipmentId'] },
    { label: 'Master Record Key', paths: ['masterRecordKey', 'identifiers.masterRecordKey'] },
    { label: 'Customer', paths: ['customerName', 'customer.customerName'] },
    { label: 'Sales Order', paths: ['salesOrder', 'order.salesOrder'] },
    { label: 'Line', paths: ['salesOrderLine', 'order.salesOrderLine'] },
    { label: 'Work Order', paths: ['workOrder', 'order.workOrder'] },
    { label: 'Part Number', paths: ['itemNumber', 'partNumber', 'item.partNumber'] },
    { label: 'Description', paths: ['description', 'item.description'] },
    { label: 'Quantity', paths: ['quantityShipped', 'order.quantityShipped'] },
    { label: 'Due Date', paths: ['dates.dueDate', 'dueDate', 'originalDueDate'] },
    { label: 'Ship Date', paths: ['dates.shipDate', 'shipDate', 'shipmentDateTime'] },
    { label: 'Unit Price', paths: ['unitPrice', 'financial.unitPrice'] },
    { label: 'Extended Price', paths: ['extendedPrice', 'financial.extendedPrice'] },
    { label: 'Approval Date', paths: ['approvalTimestamp', 'dates.approvalDate'] },
    { label: 'Archive Timestamp', paths: ['archivedAt', 'dates.archiveTimestamp'] }
  ];

  async function loadSystemCenterModule() {
    const placeholder = document.getElementById('systemCenter');
    if (!placeholder || placeholder.dataset.moduleLoaded === 'true') return;

    const response = await fetch('SRC/modules/system-center/system-center.html');
    if (!response.ok) {
      throw new Error('Unable to load System Center module.');
    }

    const html = await response.text();
    placeholder.outerHTML = html;

    if (typeof loadSystemCenterReconciliationWorkspace === 'function') {
      await loadSystemCenterReconciliationWorkspace();
    }

    await Promise.all([
      refreshPlatformRefreshCenter(),
      refreshDailyOperationsSyncStatus()
    ]);
    refreshShipmentHistoryDataViewer();
  }

  async function refreshPlatformRefreshCenter() {
    const summary = document.getElementById('platformRefreshCenterSummary');
    const grid = document.getElementById('platformRefreshCenterGrid');
    const warnings = document.getElementById('platformRefreshCenterWarnings');
    if (!summary || !grid || !warnings) return;
    summary.textContent = 'Loading governed refresh status…';
    try {
      const client = window.DleApiClient?.liveCanonical;
      if (!client?.getRefreshCenterStatus) {
        throw new Error('Refresh Center API client is unavailable.');
      }
      const [status, runs] = await Promise.all([
        client.getRefreshCenterStatus(),
        client.getRefreshCenterRuns().catch(() => [])
      ]);
      summary.textContent = [
        `Platform: ${status.overallPlatformState || 'Unavailable'}`,
        `Registry ${status.registryVersion || '—'}`,
        `Frontend ${status.frontendBuildId || 'Unavailable'}`,
        `Generated ${formatRefreshCenterDate(status.generatedAtUtc)}`
      ].join(' · ');
      const warningItems = Array.isArray(status.warnings) ? status.warnings : [];
      warnings.hidden = warningItems.length === 0;
      warnings.textContent = warningItems.length
        ? `Operator attention: ${warningItems.join(' · ')}`
        : '';
      renderPlatformRefreshDatasets(status.datasets || [], grid);
      renderPlatformRefreshRuns(runs || []);
      await refreshOperationsRefreshStatus();
    } catch (error) {
      summary.textContent = `Refresh Center unavailable: ${error.message || error}`;
      grid.innerHTML = '<div class="refresh-center-empty">Governed status could not be loaded. Existing Platform data remains read-only and unchanged.</div>';
      warnings.hidden = true;
    }
  }

  async function refreshDailyOperationsSyncStatus() {
    const state = document.getElementById('dailyOperationsSyncState');
    const facts = document.getElementById('dailyOperationsSyncFacts');
    const components = document.getElementById('dailyOperationsSyncComponents');
    const failure = document.getElementById('dailyOperationsSyncFailure');
    const button = document.getElementById('dailyOperationsSyncRunButton');
    if (!state || !facts || !components || !failure || !button) return;
    try {
      const client = window.DleApiClient.liveCanonical;
      const [status, latest, lastSuccessful] = await Promise.all([
        client.getDailyOperationsSyncStatus(),
        client.getDailyOperationsSyncLatest(),
        client.getDailyOperationsSyncLastSuccessful()
      ]);
      const current = status.RunId || status.runId ? status : latest;
      const overall = current.OverallStatus || current.overallStatus || 'READY';
      const running = overall === 'RUNNING';
      state.textContent = overall;
      button.disabled = running;
      button.textContent = running ? 'Synchronization Running…' : 'Run Daily Operations Synchronization';
      facts.innerHTML = `
        <div><span>Last successful synchronization</span><strong>${escapeShipmentHistoryViewerHtml(formatRefreshCenterDate(lastSuccessful.CompletedAtUtc || lastSuccessful.completedAtUtc))}</strong></div>
        <div><span>Run ID</span><strong>${escapeShipmentHistoryViewerHtml(current.RunId || current.runId || '—')}</strong></div>
        <div><span>Duration</span><strong>${escapeShipmentHistoryViewerHtml(formatOperationsRefreshDuration(current.DurationSeconds ?? current.durationSeconds))}</strong></div>
        <div><span>Import run ID</span><strong>${escapeShipmentHistoryViewerHtml(current.ImportRunId || current.importRunId || '—')}</strong></div>`;
      const items = current.Components || current.components || [];
      components.innerHTML = items.map(item => {
        const label = ({
          'customer-master': 'Customer Master', 'sales-orders': 'Sales Orders',
          'work-orders': 'Work Orders', 'relationships': 'Work Order Relationships',
          validation: 'Validation', promotion: 'SQL Promotion',
          'boundary-finalization': 'Qualified Boundary',
          'api-5042-readiness': 'Production API 5042',
          'api-5052-readiness': 'Development API 5052'
        })[item.Id || item.id] || item.Id || item.id || item;
        const itemState = item.Status || item.status || 'Pending';
        const count = item.RecordCount ?? item.recordCount;
        return `<div class="daily-operations-sync-component"><span>${escapeShipmentHistoryViewerHtml(label)}</span><strong data-state="${escapeShipmentHistoryViewerHtml(String(itemState).toLowerCase())}">${escapeShipmentHistoryViewerHtml(itemState)}${count == null ? '' : ` · ${Number(count).toLocaleString()} records`}</strong></div>`;
      }).join('') || '<div class="refresh-center-empty">No synchronization run recorded.</div>';
      const reason = current.FailureReason || current.failureReason;
      failure.hidden = !reason;
      const promotedFinalizationFailed =
        overall === 'PROMOTED_FINALIZATION_FAILED';
      failure.textContent = reason
        ? promotedFinalizationFailed
          ? `Data promotion succeeded; API readiness finalization failed: ${reason}`
          : `Not promoted: ${reason}`
        : '';
      if (dailyOperationsSyncPollTimer) clearTimeout(dailyOperationsSyncPollTimer);
      dailyOperationsSyncPollTimer = running
        ? setTimeout(refreshDailyOperationsSyncStatus, 2000)
        : null;
    } catch (error) {
      state.textContent = 'UNAVAILABLE';
      button.disabled = false;
      failure.hidden = false;
      failure.textContent = `Daily Operations Synchronization status unavailable: ${error.message || error}`;
    }
  }

  async function runDailyOperationsSynchronization() {
    const button = document.getElementById('dailyOperationsSyncRunButton');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await window.DleApiClient.liveCanonical.runDailyOperationsSync();
    } catch (error) {
      const failure = document.getElementById('dailyOperationsSyncFailure');
      if (failure) {
        failure.hidden = false;
        failure.textContent = error.message || String(error);
      }
    } finally {
      await refreshDailyOperationsSyncStatus();
    }
  }

  async function refreshOperationsRefreshStatus() {
    const state = document.getElementById('operationsRefreshState');
    const facts = document.getElementById('operationsRefreshFacts');
    const steps = document.getElementById('operationsRefreshSteps');
    const toggle = document.getElementById('operationsRefreshScheduleToggle');
    if (!state || !facts || !steps || !toggle) return;
    try {
      const status = await window.DleApiClient.liveCanonical.getOperationsRefreshStatus();
      const schedule = status.schedule || status.Schedule || {};
      const overallState =
        status.overallStatus || status.OverallStatus ||
        status.overallState || status.OverallState || 'NeverRun';
      const nextScheduledRun = status.nextScheduledRun || status.NextScheduledRun;
      const currentStep = status.currentStep || status.CurrentStep || '—';
      const currentStepNumber =
        Number(status.currentStepNumber ?? status.CurrentStepNumber ?? 0);
      const totalSteps = Number(status.totalSteps ?? status.TotalSteps ?? 3);
      const currentDataset =
        status.currentDataset || status.CurrentDataset || currentStep;
      const currentPhase = status.currentPhase || status.CurrentPhase || '—';
      const recordsProcessed =
        status.recordsProcessed ?? status.RecordsProcessed;
      const recordsExpected =
        status.recordsExpected ?? status.RecordsExpected;
      const elapsedSeconds =
        status.elapsedSeconds ?? status.ElapsedSeconds;
      const lastProgressAt =
        status.lastProgressAt || status.LastProgressAt;
      const startedAt = status.startedAt || status.StartedAt ||
        status.startedAtUtc || status.StartedAtUtc;
      const lastDuration =
        status.lastCompletedRunDurationSeconds ??
        status.LastCompletedRunDurationSeconds;
      const running = overallState.toLowerCase() === 'running';
      const operationsRefreshRunId =
        status.operationsRefreshRunId || status.OperationsRefreshRunId || '—';
      operationsRefreshScheduleEnabled = Boolean(schedule.automaticEnabled);
      state.textContent = overallState;
      facts.innerHTML = `
        <div><span>Schedule</span><strong>${escapeShipmentHistoryViewerHtml(schedule.schedule || '2:00 AM Monday–Friday')}</strong></div>
        <div><span>Quiet window</span><strong>${escapeShipmentHistoryViewerHtml(schedule.quietWindow || '00:00–05:59 Pacific')}</strong></div>
        <div><span>Automatic</span><strong>${operationsRefreshScheduleEnabled ? 'Enabled' : 'Disabled'}</strong></div>
        <div><span>Next run</span><strong>${escapeShipmentHistoryViewerHtml(formatRefreshCenterDate(nextScheduledRun))}</strong></div>
        <div><span>Run ID</span><strong>${escapeShipmentHistoryViewerHtml(operationsRefreshRunId)}</strong></div>
        <div><span>Last result</span><strong>${escapeShipmentHistoryViewerHtml(overallState)}</strong></div>
        <div><span>${running ? 'Started' : 'Last run'}</span><strong>${escapeShipmentHistoryViewerHtml(formatRefreshCenterDate(startedAt))}</strong></div>
        <div><span>${running ? 'Previous run duration' : 'Duration'}</span><strong>${escapeShipmentHistoryViewerHtml(formatOperationsRefreshDuration(lastDuration))}</strong></div>
        ${running ? `
          <div><span>Current step</span><strong>${escapeShipmentHistoryViewerHtml(`Step ${currentStepNumber} of ${totalSteps}: ${currentDataset}`)}</strong></div>
          <div><span>Phase</span><strong>${escapeShipmentHistoryViewerHtml(currentPhase)}</strong></div>
          <div><span>Records</span><strong>${escapeShipmentHistoryViewerHtml(formatOperationsRefreshRecords(recordsProcessed, recordsExpected))}</strong></div>
          <div><span>Elapsed</span><strong>${escapeShipmentHistoryViewerHtml(formatOperationsRefreshDuration(elapsedSeconds))}</strong></div>
          <div><span>Last progress</span><strong>${escapeShipmentHistoryViewerHtml(formatOperationsRefreshAge(lastProgressAt))}</strong></div>`
          : ''}`;
      toggle.textContent = operationsRefreshScheduleEnabled
        ? 'Disable Automatic Refresh'
        : 'Enable Automatic Refresh';
      const results = Array.isArray(status.stepResults)
        ? status.stepResults
        : (Array.isArray(status.StepResults) ? status.StepResults : []);
      const completedByDataset = new Map(results.map((result) => [
        result.dataset || result.Dataset,
        result
      ]));
      const datasets = [
        ['customer-master', 'Customer Master'],
        ['sales-order', 'Open Sales Orders'],
        ['invoice-history', 'Recent Invoice / Shipment History']
      ];
      steps.innerHTML = datasets.map(([id, label], index) => {
        const result = completedByDataset.get(id);
        if (result) {
          return `
            <div class="operations-refresh-step">
              <strong>${escapeShipmentHistoryViewerHtml(label)}</strong>
              <span>${escapeShipmentHistoryViewerHtml(result.result || result.Result || 'Unknown')}</span>
              <span>${escapeShipmentHistoryViewerHtml(formatOperationsRefreshDuration(
                Number(result.durationMilliseconds ?? result.DurationMilliseconds ?? 0) / 1000
              ))}</span>
            </div>`;
        }
        const isCurrent = running && currentStepNumber === index + 1;
        return `
          <div class="operations-refresh-step">
            <strong>${escapeShipmentHistoryViewerHtml(label)}</strong>
            <span>${isCurrent ? 'Running' : 'Waiting'}</span>
            ${isCurrent ? `<span>${escapeShipmentHistoryViewerHtml(currentPhase)}</span>` : ''}
          </div>`;
      }).join('');
      scheduleOperationsRefreshPoll(running);
    } catch (error) {
      state.textContent = 'Unavailable';
      steps.textContent = `Operations Refresh status unavailable: ${error.message || error}`;
      scheduleOperationsRefreshPoll(true);
    }
  }

  function scheduleOperationsRefreshPoll(active) {
    if (operationsRefreshPollTimer !== null) {
      window.clearTimeout(operationsRefreshPollTimer);
      operationsRefreshPollTimer = null;
    }
    if (!active || !document.getElementById('operationsRefreshState')) return;
    operationsRefreshPollTimer = window.setTimeout(() => {
      operationsRefreshPollTimer = null;
      refreshOperationsRefreshStatus();
    }, OPERATIONS_REFRESH_POLL_INTERVAL_MS);
  }

  function formatOperationsRefreshDuration(value) {
    const seconds = Math.max(0, Math.floor(Number(value)));
    if (!Number.isFinite(seconds)) return '—';
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
  }

  function formatOperationsRefreshAge(value) {
    if (!value) return '—';
    const age = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    return Number.isFinite(age) ? `${age} seconds ago` : '—';
  }

  function formatOperationsRefreshRecords(processed, expected) {
    if (processed === null || processed === undefined || processed === '') {
      return '—';
    }
    const current = Number(processed).toLocaleString();
    if (expected === null || expected === undefined || expected === '') {
      return `${current} processed`;
    }
    return `${current} of ${Number(expected).toLocaleString()} processed`;
  }

  async function runOperationsRefresh() {
    if (platformRefreshCenterBusy) return;
    const prompt = [
      'Run Operations Refresh now?',
      '',
      'Customer Master, focused Open Sales Orders, and the qualified 45-day Invoice History refresh run independently.',
      'This is not the force-full Core ERP qualification. Prior qualified data is retained if a step fails.',
      '',
      'Outside the automatic window, continue only when current ERP activity permits a consistent Open Sales Order read.'
    ].join('\n');
    if (!window.confirm(prompt)) return;
    platformRefreshCenterBusy = true;
    try {
      await window.DleApiClient.liveCanonical.runOperationsRefresh({
        quietWindowReady: true
      });
      window.alert('Operations Refresh was accepted. The status card will report each independent step.');
    } catch (error) {
      window.alert(`Operations Refresh was not started.\n\n${error.message || error}`);
    } finally {
      platformRefreshCenterBusy = false;
      await refreshOperationsRefreshStatus();
    }
  }

  async function toggleOperationsRefreshSchedule() {
    if (platformRefreshCenterBusy) return;
    const next = !operationsRefreshScheduleEnabled;
    if (!window.confirm(`${next ? 'Enable' : 'Disable'} the governed 2:00 AM Pacific weekday Operations Refresh schedule?`)) return;
    platformRefreshCenterBusy = true;
    try {
      await window.DleApiClient.liveCanonical.setOperationsRefreshScheduleEnabled(next);
    } catch (error) {
      window.alert(`The schedule was not changed.\n\n${error.message || error}`);
    } finally {
      platformRefreshCenterBusy = false;
      await refreshOperationsRefreshStatus();
    }
  }

  function renderPlatformRefreshDatasets(datasets, container) {
    container.innerHTML = datasets.map((dataset) => {
      const rowCount = totalRefreshCenterRows(dataset.rowCounts);
      const state = escapeShipmentHistoryViewerHtml(dataset.state || 'Unavailable');
      const sourceButton = dataset.supportsSourceCheck
        ? `<button type="button" onclick="runPlatformDatasetAction('${escapeShipmentHistoryViewerHtml(dataset.datasetId)}','check-source')">Check Source</button>`
        : '<button type="button" disabled title="This action requires separate qualification.">Check Source</button>';
      const refreshButton = dataset.supportsRoutineRefresh
        ? `<button type="button" onclick="runPlatformDatasetAction('${escapeShipmentHistoryViewerHtml(dataset.datasetId)}','refresh')">Refresh</button>`
        : '<button type="button" disabled title="Routine refresh is not qualified for this dataset.">Refresh</button>';
      return `
        <article class="refresh-center-dataset" data-refresh-dataset="${escapeShipmentHistoryViewerHtml(dataset.datasetId)}">
          <div class="refresh-center-dataset-header">
            <h4>${escapeShipmentHistoryViewerHtml(dataset.displayName)}</h4>
            <span class="refresh-center-state">${state}</span>
          </div>
          <p>${escapeShipmentHistoryViewerHtml(dataset.stateReason || dataset.operatorMessage || '')}</p>
          <div class="refresh-center-facts">
            <div><span>Rows</span><strong>${escapeShipmentHistoryViewerHtml(rowCount)}</strong></div>
            <div><span>Method</span><strong>${escapeShipmentHistoryViewerHtml(dataset.refreshMethod || '—')}</strong></div>
            <div><span>Snapshot/import</span><strong>${escapeShipmentHistoryViewerHtml(formatRefreshCenterDate(dataset.snapshotAsOfUtc))}</strong></div>
            <div><span>Source checked</span><strong>${escapeShipmentHistoryViewerHtml(formatRefreshCenterDate(dataset.lastSuccessfulSourceCheckUtc))}</strong></div>
            <div><span>Last result</span><strong>${escapeShipmentHistoryViewerHtml(dataset.lastResult || '—')}</strong></div>
            <div><span>Warnings</span><strong>${escapeShipmentHistoryViewerHtml(String(dataset.warningCount ?? 0))}</strong></div>
          </div>
          <div class="refresh-center-actions">
            ${sourceButton}
            ${refreshButton}
            <button type="button" disabled title="Reconciliation is not qualified for this dataset.">Reconcile</button>
          </div>
          <details class="refresh-center-details">
            <summary>Details</summary>
            <pre>${escapeShipmentHistoryViewerHtml(JSON.stringify({
              importRunId: dataset.activeImportRunId || null,
              packageHash: dataset.activePackageHash || null,
              lastQualification: dataset.lastFullQualificationUtc || null,
              unresolved: dataset.unresolvedCount || 0,
              ambiguous: dataset.ambiguousCount || 0,
              dependencies: dataset.dependencies || [],
              expectedDuration: dataset.estimatedDurationClass,
              sourceAccess: dataset.sourceAccessMode,
              quietWindowRecommended: Boolean(dataset.requiresQuietWindow),
              followOnMilestone: dataset.followOnMilestone || null
            }, null, 2))}</pre>
          </details>
        </article>`;
    }).join('');
  }

  async function runPlatformDatasetAction(datasetId, action) {
    if (platformRefreshCenterBusy) return;
    const prompts = {
      'customer-master': 'Refresh Customer Master with the qualified complete read? Prior qualified data remains active on failure.',
      'sales-order': 'Refresh Open Sales Orders with the focused indexed routine? This is not the force-full Core ERP qualification. Confirm the source window is suitable.',
      'invoice-history': 'Run the qualified 45-day overlapping Invoice History refresh? ERP access remains read-only and prior qualified data remains active on failure.'
    };
    const prompt = action === 'refresh'
      ? prompts[datasetId]
      : 'Check the qualified core ERP sources? If source metadata changed, this proceeds through the complete governed extraction and promotion path.';
    if (!window.confirm(prompt)) return;
    platformRefreshCenterBusy = true;
    try {
      const client = window.DleApiClient.liveCanonical;
      if (action === 'check-source') {
        await client.checkRefreshCenterDatasetSource(datasetId);
      } else {
        await client.refreshRefreshCenterDataset(datasetId, {
          quietWindowReady: datasetId === 'sales-order'
        });
      }
      window.alert('The governed operation was accepted. Refresh Center status will show its independent result.');
    } catch (error) {
      window.alert(`The governed operation was not started.\n\n${error.message || error}`);
    } finally {
      platformRefreshCenterBusy = false;
      await refreshPlatformRefreshCenter();
    }
  }

  async function runPlatformForceFullRefresh() {
    if (platformRefreshCenterBusy) return;
    const warning = [
      'Force-Full Core Snapshot',
      '',
      'This resource-intensive read-only ERP operation includes two complete WOE-03 passes.',
      'A quiet window is required. The prior snapshot stays active until validated promotion.',
      '',
      'Select OK only when the quiet window is ready.'
    ].join('\n');
    if (!window.confirm(warning)) return;
    const confirmation = window.prompt(
      'Type FORCE FULL ERP SNAPSHOT to confirm explicit force-full intent.'
    );
    if (confirmation !== 'FORCE FULL ERP SNAPSHOT') {
      window.alert('Force-full was not started. The exact confirmation was not entered.');
      return;
    }
    platformRefreshCenterBusy = true;
    try {
      await window.DleApiClient.liveCanonical.runRefreshCenterForceFull({
        forceFullIntent: true,
        quietWindowReady: true,
        confirmation
      });
      window.alert('The explicit governed force-full operation was accepted.');
    } catch (error) {
      window.alert(`Force-full was not started.\n\n${error.message || error}`);
    } finally {
      platformRefreshCenterBusy = false;
      await refreshPlatformRefreshCenter();
    }
  }

  function renderPlatformRefreshRuns(runs) {
    const container = document.getElementById('platformRefreshCenterRuns');
    if (!container) return;
    container.innerHTML = runs.length
      ? runs.slice(0, 20).map((run) => `
          <div class="refresh-center-run">
            <strong>${escapeShipmentHistoryViewerHtml(run.datasetId || 'core')}</strong>
            · ${escapeShipmentHistoryViewerHtml(run.action || 'operation')}
            · ${escapeShipmentHistoryViewerHtml(run.result || 'Unknown')}
            · ${escapeShipmentHistoryViewerHtml(formatRefreshCenterDate(run.requestedAtUtc))}
            · ${escapeShipmentHistoryViewerHtml(run.requestedBy || 'Unknown identity')}
          </div>`).join('')
      : 'No Refresh Center requests recorded.';
  }

  function totalRefreshCenterRows(counts) {
    if (!counts || typeof counts !== 'object') return '—';
    const values = Object.values(counts)
      .map(Number)
      .filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0).toLocaleString() : '—';
  }

  function formatRefreshCenterDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  async function refreshShipmentHistoryDataViewer() {
    const statusEl = document.getElementById('shipmentHistoryDataViewerStatus');
    const countEl = document.getElementById('shipmentHistoryDataViewerCount');
    const tableEl = document.getElementById('shipmentHistoryDataViewerTable');

    if (!statusEl || !countEl || !tableEl) return;

    statusEl.textContent = 'Loading...';
    shipmentHistoryDataViewerState.selectedIndex = -1;
    updateShipmentHistoryDataViewerSelection();
    tableEl.innerHTML = '<div class="shipment-history-data-viewer-empty">Loading persisted Shipment History records...</div>';

    try {
      syncShipmentHistoryDataViewerHandleFromShipmentHistoryModule();
      if (shipmentHistoryDataViewerState.fileHandle) {
        await loadShipmentHistoryDataViewerFromHandle(shipmentHistoryDataViewerState.fileHandle, {
          status: 'Loaded from connected file'
        });
      } else {
        const result = window.DleApiClient?.getJsonWithFallback
          ? await window.DleApiClient.getJsonWithFallback('shipmentHistory', SHIPMENT_HISTORY_VIEWER_PATH, {
            apiPersistenceMode: 'Loaded from DLE-OS-HOST API',
            fallbackPersistenceMode: 'Loaded from project JSON fallback'
          })
          : null;
        let dataset;
        let statusText;
        if (result) {
          dataset = result.data;
          statusText = recordsStatusText(normalizeShipmentHistoryViewerRecords(dataset), result.persistenceMode);
        } else {
          const response = await fetch(SHIPMENT_HISTORY_VIEWER_PATH, { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`Unable to load Shipment History JSON (${response.status}).`);
          }
          dataset = await response.json();
          statusText = recordsStatusText(normalizeShipmentHistoryViewerRecords(dataset), 'Loaded read-only');
        }
        setShipmentHistoryDataViewerDataset(dataset, {
          status: statusText
        });
      }
    } catch (error) {
      shipmentHistoryDataViewerState.dataset = null;
      shipmentHistoryDataViewerState.records = [];
      countEl.textContent = '0';
      statusEl.textContent = 'Load failed';
      tableEl.innerHTML = `<div class="shipment-history-data-viewer-empty">Unable to load persisted Shipment History records. ${escapeShipmentHistoryViewerHtml(error.message || error)}</div>`;
      updateShipmentHistoryDataViewerSelection();
      console.error('Shipment History Data Viewer failed to load persisted JSON.', error);
    }
  }

  async function connectShipmentHistoryDataViewerFile() {
    const statusEl = document.getElementById('shipmentHistoryDataViewerStatus');
    try {
      const handle = await promptForShipmentHistoryDataViewerFileHandle();
      shipmentHistoryDataViewerState.fileHandle = handle;
      await loadShipmentHistoryDataViewerFromHandle(handle, {
        status: 'Connected'
      });
      syncShipmentHistoryModuleHandle(handle);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (statusEl) statusEl.textContent = 'Connect failed';
      console.error('Shipment History Data Viewer file connection failed.', error);
      window.alert(`Shipment History JSON was not connected.\n\n${error.message || error}`);
    }
  }

  async function promptForShipmentHistoryDataViewerFileHandle() {
    if (!window.showOpenFilePicker) {
      throw new Error('This browser does not support opening a writable JSON file handle. Use Microsoft Edge with the File System Access API enabled.');
    }

    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'Shipment History JSON',
        accept: { 'application/json': ['.json'] }
      }]
    });

    const permission = await ensureShipmentHistoryDataViewerWritePermission(handle);
    if (permission !== 'granted') {
      throw new Error('Write permission was not granted for shipment-history.json.');
    }

    return handle;
  }

  async function ensureShipmentHistoryDataViewerWritePermission(handle) {
    if (!handle?.queryPermission || !handle?.requestPermission) return 'granted';

    const options = { mode: 'readwrite' };
    const current = await handle.queryPermission(options);
    if (current === 'granted') return current;
    return handle.requestPermission(options);
  }

  async function loadShipmentHistoryDataViewerFromHandle(handle, options = {}) {
    const file = await handle.getFile();
    const text = await file.text();
    const dataset = text.trim()
      ? JSON.parse(text)
      : { schema: 'DLE_SHIPMENT_HISTORY_V1', createdAt: '', lastUpdated: '', recordCount: 0, records: [] };

    setShipmentHistoryDataViewerDataset(dataset, {
      status: options.status || recordsStatusText(normalizeShipmentHistoryViewerRecords(dataset), 'Loaded from connected file')
    });
  }

  function setShipmentHistoryDataViewerDataset(dataset, options = {}) {
    const countEl = document.getElementById('shipmentHistoryDataViewerCount');
    const statusEl = document.getElementById('shipmentHistoryDataViewerStatus');
    const tableEl = document.getElementById('shipmentHistoryDataViewerTable');
    if (!countEl || !statusEl || !tableEl) return;

    const records = normalizeShipmentHistoryViewerRecords(dataset);
    shipmentHistoryDataViewerState.dataset = dataset;
    shipmentHistoryDataViewerState.records = records;
    if (shipmentHistoryDataViewerState.selectedIndex >= records.length) {
      shipmentHistoryDataViewerState.selectedIndex = -1;
    }
    countEl.textContent = String(records.length);
    statusEl.textContent = options.status || recordsStatusText(records, 'Loaded');
    renderShipmentHistoryDataViewerTable(records, tableEl);
    updateShipmentHistoryDataViewerSelection();
  }

  function recordsStatusText(records, loadedText) {
    return records.length ? loadedText : 'No records';
  }

  function normalizeShipmentHistoryViewerRecords(dataset) {
    if (Array.isArray(dataset)) return dataset;
    if (dataset && Array.isArray(dataset.records)) return dataset.records;
    return [];
  }

  function renderShipmentHistoryDataViewerTable(records, tableEl) {
    if (!records.length) {
      tableEl.innerHTML = '<div class="shipment-history-data-viewer-empty">No persisted Shipment History records found.</div>';
      return;
    }

    const headers = SHIPMENT_HISTORY_VIEWER_COLUMNS
      .map((column) => `<th>${escapeShipmentHistoryViewerHtml(column.label)}</th>`)
      .join('');

    const rows = records
      .map((record, index) => {
        const cells = SHIPMENT_HISTORY_VIEWER_COLUMNS
          .map((column) => `<td>${escapeShipmentHistoryViewerHtml(getShipmentHistoryViewerValue(record, column.paths))}</td>`)
          .join('');
        return `<tr data-shipment-history-viewer-index="${index}" onclick="selectShipmentHistoryDataViewerRecord(${index})">${cells}</tr>`;
      })
      .join('');

    tableEl.innerHTML = `
      <table class="shipment-history-data-viewer-table">
        <thead>
          <tr>${headers}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function selectShipmentHistoryDataViewerRecord(index) {
    const recordIndex = Number(index);
    if (!Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= shipmentHistoryDataViewerState.records.length) {
      shipmentHistoryDataViewerState.selectedIndex = -1;
    } else {
      shipmentHistoryDataViewerState.selectedIndex = recordIndex;
    }

    updateShipmentHistoryDataViewerSelection();
  }

  function updateShipmentHistoryDataViewerSelection() {
    const selectedIndex = shipmentHistoryDataViewerState.selectedIndex;
    const selectedRecord = selectedIndex >= 0 ? shipmentHistoryDataViewerState.records[selectedIndex] : null;
    const selectedEl = document.getElementById('shipmentHistoryDataViewerSelected');
    const deleteButton = document.getElementById('deleteShipmentHistoryDataViewerRecordButton');
    const writeAccessEl = document.getElementById('shipmentHistoryDataViewerWriteAccess');

    document
      .querySelectorAll('[data-shipment-history-viewer-index]')
      .forEach((row) => {
        row.classList.toggle('selected', Number(row.dataset.shipmentHistoryViewerIndex) === selectedIndex);
      });

    if (selectedEl) {
      selectedEl.textContent = selectedRecord
        ? getShipmentHistoryViewerValue(selectedRecord, ['shipmentId', 'identifiers.shipmentId', 'masterRecordKey', 'identifiers.masterRecordKey']) || 'Selected'
        : 'None';
    }

    if (deleteButton) {
      deleteButton.disabled = !selectedRecord;
    }

    if (writeAccessEl) {
      writeAccessEl.textContent = shipmentHistoryDataViewerState.fileHandle
        ? 'Connected'
        : 'Read-only';
    }
  }

  async function deleteSelectedShipmentHistoryDataViewerRecord() {
    let selectedIndex = shipmentHistoryDataViewerState.selectedIndex;
    let selectedRecord = selectedIndex >= 0 ? shipmentHistoryDataViewerState.records[selectedIndex] : null;
    const statusEl = document.getElementById('shipmentHistoryDataViewerStatus');

    if (!selectedRecord) {
      window.alert('Select one Shipment History record before deleting.');
      return;
    }

    try {
      const handle = await getShipmentHistoryDataViewerWritableHandle();
      if (handle) {
        const selectedRecordKey = getShipmentHistoryViewerRecordIdentity(selectedRecord);
        await loadShipmentHistoryDataViewerFromHandle(handle, {
          status: 'Connected'
        });
        selectedIndex = findShipmentHistoryViewerRecordIndex(selectedRecordKey);
        selectedRecord = selectedIndex >= 0 ? shipmentHistoryDataViewerState.records[selectedIndex] : null;
        shipmentHistoryDataViewerState.selectedIndex = selectedIndex;
        updateShipmentHistoryDataViewerSelection();
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (statusEl) statusEl.textContent = 'Delete failed';
      console.error('Shipment History Data Viewer writable handle failed.', error);
      window.alert(`Shipment History delete was not completed.\n\n${error.message || error}`);
      return;
    }

    if (!selectedRecord) {
      window.alert('The selected Shipment History record was not found in the connected JSON file. Refresh the viewer and try again.');
      return;
    }

    const shipmentId = getShipmentHistoryViewerValue(selectedRecord, ['shipmentId', 'identifiers.shipmentId']);
    const masterRecordKey = getShipmentHistoryViewerValue(selectedRecord, ['masterRecordKey', 'identifiers.masterRecordKey']);
    const label = shipmentId || masterRecordKey || `record ${selectedIndex + 1}`;
    const confirmed = window.confirm(`Delete Shipment History record "${label}"?\n\nThis only removes the archived Shipment History record. It does not modify Master Data, Shipment Staging, Reconciliation, or any other operational dataset.`);
    if (!confirmed) return;

    const dataset = shipmentHistoryDataViewerState.dataset || {};
    const remainingRecords = shipmentHistoryDataViewerState.records.filter((record, index) => index !== selectedIndex);
    const updatedDataset = {
      ...dataset,
      schema: dataset.schema || 'DLE_SHIPMENT_HISTORY_V1',
      createdAt: dataset.createdAt || '',
      lastUpdated: new Date().toLocaleString(),
      recordCount: remainingRecords.length,
      records: remainingRecords
    };

    try {
      if (statusEl) statusEl.textContent = 'Deleting...';
      await writeShipmentHistoryDataViewerDataset(updatedDataset);
      shipmentHistoryDataViewerState.dataset = updatedDataset;
      shipmentHistoryDataViewerState.records = remainingRecords;
      shipmentHistoryDataViewerState.selectedIndex = -1;
      if (typeof initializeShipmentHistory === 'function') {
        await initializeShipmentHistory();
      }
      await refreshShipmentHistoryDataViewer();
    } catch (error) {
      if (statusEl) statusEl.textContent = 'Delete failed';
      console.error('Shipment History Data Viewer delete failed.', error);
      window.alert(`Shipment History delete was not completed.\n\n${error.message || error}`);
    }
  }

  async function writeShipmentHistoryDataViewerDataset(dataset) {
    const handle = shipmentHistoryDataViewerState.fileHandle;
    if (!handle) {
      throw new Error('Shipment History JSON is not connected for writing.');
    }

    await writeShipmentHistoryDataViewerFileHandle(handle, dataset);
    syncShipmentHistoryModuleHandle(handle);
  }

  async function writeShipmentHistoryDataViewerFileHandle(handle, dataset) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(dataset, null, 2));
    await writable.close();
    await verifyShipmentHistoryDataViewerWrite(handle, dataset);
  }

  async function verifyShipmentHistoryDataViewerWrite(handle, expectedDataset) {
    if (!handle?.getFile) return;
    const file = await handle.getFile();
    const text = await file.text();
    const actualDataset = JSON.parse(text);
    const actualCount = Array.isArray(actualDataset.records) ? actualDataset.records.length : 0;
    const expectedCount = Array.isArray(expectedDataset.records) ? expectedDataset.records.length : 0;
    if (actualCount !== expectedCount) {
      throw new Error('Shipment History JSON verification failed after delete.');
    }
  }

  async function getShipmentHistoryDataViewerWritableHandle() {
    syncShipmentHistoryDataViewerHandleFromShipmentHistoryModule();
    if (shipmentHistoryDataViewerState.fileHandle) {
      const permission = await ensureShipmentHistoryDataViewerWritePermission(shipmentHistoryDataViewerState.fileHandle);
      if (permission !== 'granted') {
        throw new Error('Write permission was not granted for shipment-history.json.');
      }
      return shipmentHistoryDataViewerState.fileHandle;
    }

    const handle = await promptForShipmentHistoryDataViewerFileHandle();
    shipmentHistoryDataViewerState.fileHandle = handle;
    syncShipmentHistoryModuleHandle(handle);
    return handle;
  }

  function syncShipmentHistoryDataViewerHandleFromShipmentHistoryModule() {
    if (shipmentHistoryDataViewerState.fileHandle) return;
    if (window.shipmentHistoryState?.fileHandle) {
      shipmentHistoryDataViewerState.fileHandle = window.shipmentHistoryState.fileHandle;
    }
  }

  function syncShipmentHistoryModuleHandle(handle) {
    if (!window.shipmentHistoryState || !handle) return;
    window.shipmentHistoryState.fileHandle = handle;
    window.shipmentHistoryState.writable = true;
    window.shipmentHistoryState.sourceFile = handle.name || 'shipment-history.json';
    window.shipmentHistoryState.persistenceMode = 'Project JSON writable file handle';
  }

  function getShipmentHistoryViewerRecordIdentity(record) {
    return [
      getShipmentHistoryViewerValue(record, ['shipmentId', 'identifiers.shipmentId']),
      getShipmentHistoryViewerValue(record, ['masterRecordKey', 'identifiers.masterRecordKey']),
      getShipmentHistoryViewerValue(record, ['salesOrder', 'order.salesOrder']),
      getShipmentHistoryViewerValue(record, ['salesOrderLine', 'order.salesOrderLine']),
      getShipmentHistoryViewerValue(record, ['workOrder', 'order.workOrder'])
    ].join('|');
  }

  function findShipmentHistoryViewerRecordIndex(identity) {
    if (!identity) return -1;
    return shipmentHistoryDataViewerState.records.findIndex((record) => getShipmentHistoryViewerRecordIdentity(record) === identity);
  }

  function getShipmentHistoryViewerValue(record, paths) {
    for (const path of paths) {
      const value = getShipmentHistoryViewerPath(record, path);
      if (value !== undefined && value !== null && value !== '') {
        return String(value);
      }
    }
    return '';
  }

  function getShipmentHistoryViewerPath(record, path) {
    return path.split('.').reduce((current, part) => {
      if (current === undefined || current === null) return undefined;
      return current[part];
    }, record);
  }

  function escapeShipmentHistoryViewerHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.loadSystemCenterModule = loadSystemCenterModule;
  window.connectShipmentHistoryDataViewerFile = connectShipmentHistoryDataViewerFile;
  window.refreshShipmentHistoryDataViewer = refreshShipmentHistoryDataViewer;
  window.selectShipmentHistoryDataViewerRecord = selectShipmentHistoryDataViewerRecord;
  window.deleteSelectedShipmentHistoryDataViewerRecord = deleteSelectedShipmentHistoryDataViewerRecord;
  window.refreshPlatformRefreshCenter = refreshPlatformRefreshCenter;
  window.runPlatformDatasetAction = runPlatformDatasetAction;
  window.runPlatformForceFullRefresh = runPlatformForceFullRefresh;
  window.runOperationsRefresh = runOperationsRefresh;
  window.toggleOperationsRefreshSchedule = toggleOperationsRefreshSchedule;
  window.runDailyOperationsSynchronization = runDailyOperationsSynchronization;
})();

