using System.Text.Json;
using System.Text.RegularExpressions;

internal static partial class SimShellRenderer
{
    internal static string Render(
        string repositoryRoot,
        string applicationOrigin,
        bool lanMode,
        string? safeUrl)
    {
        var shellPath = Path.Combine(repositoryRoot, "DLE_Work_Center_v4.0.0.html");
        var html = File.ReadAllText(shellPath);
        var runtime = JsonSerializer.Serialize(new
        {
            authenticatedBffBaseUrl = applicationOrigin,
            environment = SimRuntimeOptions.EnvironmentMarker,
            environmentName = "Simulation",
            environmentLabel = SimRuntimeOptions.EnvironmentLabel,
            syntheticData = true,
            lanMode,
            safeUrl,
            operationsCenterMode = "SIM_STATEFUL_VERIFIED_STATUS"
        });

        html = TitlePattern().Replace(html, "<title>DLE-OS SIM — SYNTHETIC DATA</title>", 1);
        var head = html.IndexOf("<head>", StringComparison.OrdinalIgnoreCase);
        if (head < 0) throw new InvalidOperationException("The shared DLE-OS shell head is absent.");
        html = html.Insert(head + "<head>".Length,
            "<script>window.DleOsRuntimeConfig=" + runtime + ";</script>" +
            "<script src=\"SRC/modules/work-order-dashboard/kitting-kit-id-label.js\"></script>" +
            SimStyles + SimParityScript);

        html = BodyPattern().Replace(html, match =>
            match.Value.Insert(match.Value.Length - 1, " data-sim-runtime=\"true\""), 1);
        html = EnvironmentBadgePattern().Replace(html,
            "<span id=\"dleEnvironmentBadge\" class=\"dle-environment-badge\" role=\"status\" " +
            "title=\"Local simulation using synthetic data\">SIM</span>", 1);
        html = EnvironmentIndicatorPattern().Replace(html,
            "<span class=\"development-read-only-indicator\" role=\"status\">" +
            SimRuntimeOptions.EnvironmentLabel +
            (lanMode ? " · LAN MODE · " + System.Net.WebUtility.HtmlEncode(safeUrl) : string.Empty) +
            "</span>", 1);

        return DevelopmentIdentityUi.Inject(html);
    }

    private const string SimStyles = """
<style id="dle-sim-runtime-style">
  body[data-sim-runtime="true"] #dleEnvironmentBadge {
    display: inline-flex !important; border-color: rgba(45,212,191,.72);
    color: #ccfbf1; background: rgba(13,148,136,.18);
  }
  body[data-sim-runtime="true"] #dleDevControlsToggle,
  body[data-sim-runtime="true"] #dleDevControlsPanel { display: none !important; }
  body[data-sim-runtime="true"] .development-read-only-indicator { display: inline-flex !important; }
  body[data-sim-runtime="true"] #invoiceHistorySyncButton,
  body[data-sim-runtime="true"] #syncOperationsButton,
  body[data-sim-runtime="true"] .refresh-center-force-button,
  body[data-sim-runtime="true"] #dailyOperationsSyncRunButton,
  body[data-sim-runtime="true"] #workOrderDashboardKitReleasedBom,
  body[data-sim-runtime="true"] #workOrderDashboardSetDisposition,
  body[data-sim-runtime="true"] #activeKittingSaveExit,
  body[data-sim-runtime="true"] [onclick="runOperationsRefresh()"],
  body[data-sim-runtime="true"] #operationsRefreshScheduleToggle,
  body[data-sim-runtime="true"] [onclick="runPrintEngineQualification()"],
  body[data-sim-runtime="true"] [onclick="startMasterDataReconciliation()"] { display: none !important; }
  body[data-sim-runtime="true"] #dleSimWorkspaceToggle { display: inline-flex; align-items: center; justify-content: center; }
  body[data-sim-runtime="true"] #dleSimWorkspacePanel { padding-block: 8px; }
  body[data-sim-runtime="true"] #dleSimWorkspacePanel .dle-sim-controls-row { display:flex;align-items:center;gap:10px;flex-wrap:wrap }
  body[data-sim-runtime="true"] #dleSimWorkspacePanel .workspace-selector { width: min(100%, 430px); }
  body[data-sim-runtime="true"] #dleSimWorkspacePanel .workspace-selector select { flex: 1 1 auto; min-width: 0; }
  .dle-sim-persona-selector { display:grid;grid-template-columns:auto minmax(150px,260px);align-items:center;gap:6px 10px }
  .dle-sim-persona-selector label { color:var(--muted,#94a3b8);font:700 12px/1.2 system-ui,sans-serif }
  .dle-sim-persona-selector select { min-height:36px;border:1px solid rgba(47,140,255,.32);border-radius:8px;
    background:#111d2b;color:#f8fafc;padding:6px 9px;font:650 12px/1.2 system-ui,sans-serif }
  .dle-sim-persona-status { grid-column:1/-1;color:#a7f3d0;font:600 11px/1.35 system-ui,sans-serif }
  .dle-sim-fault-selector { display:grid;grid-template-columns:auto minmax(180px,300px);align-items:center;gap:6px 10px;
    padding-left:10px;border-left:1px solid rgba(148,163,184,.24) }
  .dle-sim-fault-selector label { color:var(--muted,#94a3b8);font:700 12px/1.2 system-ui,sans-serif }
  .dle-sim-fault-selector select { min-height:36px;border:1px solid rgba(251,191,36,.38);border-radius:8px;
    background:#111d2b;color:#fef3c7;padding:6px 9px;font:650 12px/1.2 system-ui,sans-serif }
  .dle-sim-fault-status { grid-column:1/-1;color:#fde68a;font:600 11px/1.35 system-ui,sans-serif }
  .dle-sim-state-control { display:grid;grid-template-columns:minmax(150px,1fr) auto;align-items:center;gap:6px 10px;
    min-width:min(100%,310px);padding-left:10px;border-left:1px solid rgba(148,163,184,.24) }
  .dle-sim-state-summary { color:#ccfbf1;font:700 12px/1.3 system-ui,sans-serif }
  .dle-sim-reset-button { min-height:34px;border:1px solid rgba(248,113,113,.55);border-radius:8px;padding:6px 10px;
    background:rgba(127,29,29,.24);color:#fecaca;font:700 11px/1.2 system-ui,sans-serif;cursor:pointer }
  .dle-sim-reset-button:disabled { opacity:.55;cursor:wait }
  .dle-sim-state-status { grid-column:1/-1;color:#94a3b8;font:600 11px/1.35 system-ui,sans-serif }
  #dle-authorization-bootstrap .dle-sim-persona-selector { margin-top:14px;padding:12px;border:1px solid rgba(45,212,191,.35);
    border-radius:9px;background:rgba(15,23,42,.92);text-align:left }
</style>
""";

    private const string SimParityScript = """
<script id="dle-sim-parity-script">
(() => {
  'use strict';
  function initializeSimShellParity() {
    const slot = document.querySelector('.dle-dev-secondary-slot');
    const originalSelector = document.querySelector('#dleDevControlsPanel .workspace-selector');
    const header = document.querySelector('header.dle-app-header');
    if (!slot || !originalSelector || !header || document.getElementById('dleSimWorkspaceToggle')) return;

    const toggle = document.createElement('button');
    toggle.id = 'dleSimWorkspaceToggle';
    toggle.className = 'dle-dev-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', 'dleSimWorkspacePanel');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open SIM controls');
    toggle.innerHTML = 'SIM <span aria-hidden="true">\u25be</span>';

    const panel = document.createElement('section');
    panel.id = 'dleSimWorkspacePanel';
    panel.className = 'dle-dev-controls dle-sim-workspace-panel';
    panel.setAttribute('aria-label', 'Simulation controls');
    panel.hidden = true;
    const controls = document.createElement('div');
    controls.className = 'dle-sim-controls-row';
    controls.append(createPersonaControl('dleSimPersonaControl'), originalSelector,
      createFaultControl(), createStateControl());
    panel.append(controls);
    header.append(panel);
    slot.append(toggle);

    const setExpanded = expanded => {
      panel.hidden = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.innerHTML = 'SIM <span aria-hidden="true">' + (expanded ? '\u25b4' : '\u25be') + '</span>';
    };
    toggle.addEventListener('click', () => setExpanded(panel.hidden));
    originalSelector.querySelector('select')?.addEventListener('change', () => setExpanded(false));

    const recoveryHost = document.querySelector('#dle-authorization-bootstrap > div');
    if (recoveryHost && !document.getElementById('dleSimPersonaRecovery')) {
      recoveryHost.append(createPersonaControl('dleSimPersonaRecovery'));
    }
    loadPersonas();
    loadFaults();
    loadSimState();
  }

  function createPersonaControl(id) {
    const root = document.createElement('div');
    root.id = id;
    root.className = 'dle-sim-persona-selector';
    root.innerHTML = '<label for="' + id + 'Select">SIM Persona</label>' +
      '<select id="' + id + 'Select" aria-label="SIM Persona" disabled><option>Loading personas…</option></select>' +
      '<small class="dle-sim-persona-status" aria-live="polite">Synthetic identity</small>';
    return root;
  }

  function createStateControl() {
    const root = document.createElement('div');
    root.id = 'dleSimStateControl';
    root.className = 'dle-sim-state-control';
    root.innerHTML = '<strong class="dle-sim-state-summary">Loading SIM state…</strong>' +
      '<button type="button" class="dle-sim-reset-button" disabled>Reset SIM</button>' +
      '<small class="dle-sim-state-status" aria-live="polite">Checking local state…</small>';
    return root;
  }

  function createFaultControl() {
    const root = document.createElement('div');
    root.id = 'dleSimFaultControl';
    root.className = 'dle-sim-fault-selector';
    root.innerHTML = '<label for="dleSimFaultControlSelect">Fault</label>' +
      '<select id="dleSimFaultControlSelect" aria-label="SIM Fault" disabled><option>Loading faults…</option></select>' +
      '<small class="dle-sim-fault-status" aria-live="polite">SIM-only deterministic overlay</small>';
    return root;
  }

  async function loadPersonas() {
    let catalog;
    try {
      const response = await fetch('/api/sim/personas', {
        credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      if (!response.ok) return showPersonaError('Persona catalog unavailable.');
      catalog = await response.json();
    } catch (_error) {
      return showPersonaError('Persona catalog unavailable.');
    }
    document.querySelectorAll('.dle-sim-persona-selector').forEach(root => {
      const select = root.querySelector('select');
      const status = root.querySelector('.dle-sim-persona-status');
      select.replaceChildren(...catalog.personas.map(persona => {
        const option = document.createElement('option');
        option.value = persona.id;
        option.textContent = persona.displayName;
        option.selected = persona.id === catalog.currentPersonaId;
        return option;
      }));
      select.disabled = false;
      const current = catalog.personas.find(persona => persona.id === catalog.currentPersonaId);
      if (status && current) {
        status.textContent = (current.roles[0] || 'DLE-OS USER') + ' · ' +
          current.permissions.length + ' explicit permissions · Synthetic';
      }
      select.addEventListener('change', () => selectPersona(select, status));
    });
  }

  async function loadSimState() {
    const root = document.getElementById('dleSimStateControl');
    if (!root) return;
    const summary = root.querySelector('.dle-sim-state-summary');
    const status = root.querySelector('.dle-sim-state-status');
    const button = root.querySelector('.dle-sim-reset-button');
    try {
      const response = await fetch('/api/sim/state', {
        credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      const state = await response.json();
      if (response.ok) {
        summary.textContent = 'SIM ' + state.scenarioId + ' · Generation ' + state.generation;
        status.textContent = 'Scenario v' + state.scenarioVersion + ' · State v' + state.stateVersion;
        await synchronizeBrowserGeneration(state);
      } else {
        summary.textContent = 'SIM state requires reset';
        status.textContent = state.message || 'State metadata is unavailable.';
      }
      button.disabled = false;
      bindReset(button, summary, status);
    } catch (_error) {
      summary.textContent = 'SIM state unavailable';
      status.textContent = 'Could not inspect local SIM state.';
    }
  }

  async function loadFaults() {
    const root = document.getElementById('dleSimFaultControl');
    if (!root) return;
    const select = root.querySelector('select');
    const status = root.querySelector('.dle-sim-fault-status');
    try {
      const response = await fetch('/api/sim/faults', {
        credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      const catalog = await response.json();
      if (!response.ok) throw new Error(catalog.message || 'Fault catalog unavailable.');
      select.replaceChildren(...catalog.profiles.map(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.label;
        option.selected = profile.id === catalog.activeFaultId;
        return option;
      }));
      select.disabled = false;
      renderFaultState(status, catalog.state);
      select.addEventListener('change', () => selectFault(select, status));
    } catch (error) {
      status.textContent = error.message || 'Fault catalog unavailable.';
    }
  }

  function renderFaultState(status, state) {
    if (!status || !state) return;
    status.textContent = state.status + ' · ' + state.occurrence + ' · triggers ' + state.triggerCount;
  }

  async function selectFault(select, status) {
    select.disabled = true;
    if (status) status.textContent = 'Selecting local SIM fault…';
    try {
      const response = await fetch('/api/sim/fault', {
        method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ faultId: select.value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Fault selection failed.');
      renderFaultState(status, result.state);
    } catch (error) {
      if (status) status.textContent = error.message || 'Fault selection failed.';
      await loadFaults();
    } finally {
      select.disabled = false;
    }
  }

  function bindReset(button, summary, status) {
    let armed = false;
    let disarmTimer = 0;
    button.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        button.textContent = 'Confirm reset';
        status.textContent = 'Click Confirm reset again to rebuild local SIM state.';
        clearTimeout(disarmTimer);
        disarmTimer = setTimeout(() => {
          armed = false; button.textContent = 'Reset SIM';
          status.textContent = 'Reset confirmation expired; no state was changed.';
        }, 8000);
        return;
      }
      clearTimeout(disarmTimer);
      button.disabled = true;
      summary.textContent = 'Resetting SIM…';
      status.textContent = 'Rebuilding baseline state and clearing scoped browser state…';
      try {
        const response = await fetch('/api/sim/reset', {
          method: 'POST', credentials: 'same-origin',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: 'RESET SIM', requestId: crypto.randomUUID() })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'SIM reset failed.');
        await clearScopedBrowserState(result.browserStorage, result.browserResetGeneration);
        summary.textContent = 'SIM ' + result.scenarioId + ' · Generation ' + result.generation;
        status.textContent = 'Reset complete. Reloading as SIM Administrator…';
        window.location.reload();
      } catch (error) {
        armed = false;
        button.disabled = false;
        button.textContent = 'Reset SIM';
        summary.textContent = 'SIM reset did not complete';
        status.textContent = error.message || 'SIM reset failed safely.';
      }
    });
  }

  async function synchronizeBrowserGeneration(state) {
    const contract = state.browserStorage;
    if (!contract) return;
    let stored = null;
    try { stored = localStorage.getItem(contract.generationKey); } catch (_error) { }
    if (stored !== String(state.browserResetGeneration)) {
      await clearScopedBrowserState(contract, state.browserResetGeneration);
    }
  }

  async function clearScopedBrowserState(contract, generation) {
    if (!contract) return;
    try {
      contract.localStorageKeys.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(contract.generationKey, String(generation));
    } catch (_error) { }
    try {
      const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
      keys.filter(Boolean).forEach(key => {
        if (contract.sessionStoragePrefixes.some(prefix => key.startsWith(prefix))) sessionStorage.removeItem(key);
      });
    } catch (_error) { }
    if (window.indexedDB) {
      await Promise.all(contract.indexedDbNames.map(name => new Promise(resolve => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
      })));
    }
  }

  async function selectPersona(select, status) {
    const personaId = select.value;
    document.querySelectorAll('.dle-sim-persona-selector select').forEach(control => control.disabled = true);
    if (status) status.textContent = 'Switching synthetic identity…';
    try {
      const response = await fetch('/api/sim/persona', {
        method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId })
      });
      if (!response.ok) throw new Error('Persona selection failed.');
      window.location.reload();
    } catch (error) {
      showPersonaError(error.message || 'Persona selection failed.');
    }
  }

  function showPersonaError(message) {
    document.querySelectorAll('.dle-sim-persona-selector').forEach(root => {
      const status = root.querySelector('.dle-sim-persona-status');
      if (status) status.textContent = message;
      const select = root.querySelector('select');
      if (select) select.disabled = false;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSimShellParity, { once: true });
  } else {
    initializeSimShellParity();
  }
})();
</script>
""";

    [GeneratedRegex("<title>.*?</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex TitlePattern();

    [GeneratedRegex("<body(?:\\s[^>]*)?>", RegexOptions.IgnoreCase)]
    private static partial Regex BodyPattern();

    [GeneratedRegex("<span\\s+id=\"dleEnvironmentBadge\"[^>]*>.*?</span>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex EnvironmentBadgePattern();

    [GeneratedRegex("<span\\s+class=\"development-read-only-indicator\"[^>]*>.*?</span>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex EnvironmentIndicatorPattern();
}
