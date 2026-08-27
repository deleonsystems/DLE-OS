(function registerOperatorHeader(window, document) {
  'use strict';

  const FACTORY_TIME_ZONE = 'America/Los_Angeles';
  const DESKTOP_VIEW_MODE = 'desktop';
  const MOBILE_VIEW_MODE = 'mobile';
  let viewMode = DESKTOP_VIEW_MODE;
  const factoryTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: FACTORY_TIME_ZONE,
    weekday: 'long',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  function formatFactoryTime(value) {
    const parts = Object.fromEntries(factoryTimeFormatter.formatToParts(value).map(part => [part.type, part.value]));
    return `${parts.weekday}, ${parts.month}/${parts.day}/${parts.year} · ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod}`;
  }

  function startFactoryClock() {
    const clock = document.getElementById('dleFactoryClock');
    if (!clock || clock.dataset.initialized === 'true') return;
    clock.dataset.initialized = 'true';
    const render = () => {
      const now = new Date();
      clock.textContent = formatFactoryTime(now);
      clock.dateTime = now.toISOString();
      clock.title = 'De Leon factory time · ' + FACTORY_TIME_ZONE;
    };
    render();
    window.setInterval(render, 1000);
  }

  function getViewMode() {
    return viewMode;
  }

  function updateViewModeToggle() {
    const select = document.getElementById('dleViewModeSelect');
    if (select) select.value = viewMode;
  }

  function ensureViewModeToggle() {
    if (typeof document.querySelector !== 'function' || typeof document.createElement !== 'function') return;
    if (document.getElementById('dleViewModeToggle')) return;
    const header = document.querySelector('.dle-operator-header');
    const navigation = header?.querySelector('.dle-operator-nav');
    if (!header || !navigation) return;

    const toggle = document.createElement('label');
    toggle.id = 'dleViewModeToggle';
    toggle.className = 'dle-view-mode-toggle';
    toggle.setAttribute('for', 'dleViewModeSelect');

    const label = document.createElement('span');
    label.className = 'dle-view-mode-label';
    label.textContent = 'View:';

    const select = document.createElement('select');
    select.id = 'dleViewModeSelect';
    select.setAttribute('aria-label', 'DLE-OS view mode');
    [
      [DESKTOP_VIEW_MODE, 'Desktop View'],
      [MOBILE_VIEW_MODE, 'Mobile View']
    ].forEach(([mode, label]) => {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = label;
      select.append(option);
    });
    select.addEventListener('change', () => setViewMode(select.value));
    toggle.append(label, select);
    navigation.insertAdjacentElement('afterend', toggle);
    updateViewModeToggle();
  }

  function ensureMobileViewFallback() {
    if (typeof document.querySelector !== 'function' || typeof document.createElement !== 'function') return null;
    let fallback = document.getElementById('dleMobileViewFallback');
    if (fallback) return fallback;
    const main = document.querySelector('body > main');
    if (!main) return null;

    fallback = document.createElement('section');
    fallback.id = 'dleMobileViewFallback';
    fallback.className = 'dle-mobile-view-fallback';
    fallback.hidden = true;
    fallback.setAttribute('aria-live', 'polite');
    fallback.innerHTML = '<div><strong>Mobile View Coming Soon</strong><span id="dleMobileViewFallbackWorkspace"></span></div>';
    main.append(fallback);
    return fallback;
  }

  function syncOperationsCenterViewMode() {
    document.getElementById('operationsCenterMobileViewToggle')?.remove();
    if (typeof document.querySelector === 'function') {
      document.querySelector('.operations-center-mobile-search-row > button')?.remove();
    }
    const toggle = window.OperationsCenter?.toggleMobileView || window.toggleOperationsCenterMobileView;
    if (typeof toggle === 'function') toggle(viewMode === MOBILE_VIEW_MODE);
  }

  function applyWorkspaceViewMode() {
    if (document.body?.dataset) document.body.dataset.viewMode = viewMode;
    const workspaceId = document.body?.dataset?.workspaceView || 'dle-home';
    const homeActive = workspaceId === 'dle-home';
    const operationsCenterActive = workspaceId === 'operations-center';
    const invoiceHistoryActive = workspaceId === 'invoice-history';
    const fallback = ensureMobileViewFallback();
    if (fallback) {
      const showFallback = viewMode === MOBILE_VIEW_MODE && !homeActive && !operationsCenterActive && !invoiceHistoryActive;
      fallback.hidden = !showFallback;
      const label = document.getElementById('dleMobileViewFallbackWorkspace');
      if (label) label.textContent = showFallback ? (document.body?.dataset?.workspaceLabel || '') : '';
    }
    if (homeActive) window.DleWorkAreaHome?.render?.();
    if (operationsCenterActive) syncOperationsCenterViewMode();
  }

  function setViewMode(value) {
    const nextMode = value === MOBILE_VIEW_MODE ? MOBILE_VIEW_MODE : DESKTOP_VIEW_MODE;
    const changed = nextMode !== viewMode;
    viewMode = nextMode;
    updateViewModeToggle();
    applyWorkspaceViewMode();
    if (changed && typeof document.dispatchEvent === 'function') {
      document.dispatchEvent(new CustomEvent('dle:view-mode-change', { detail: { mode: viewMode } }));
    }
    return viewMode;
  }

  function getSyncOperationsButton() {
    return document.getElementById('syncOperationsButton');
  }

  function getSyncOperationsStatusPanel() {
    return document.getElementById('syncOperationsStatus');
  }

  function canShowOperationsCenterSyncAction(capabilities = window.DleOsCapabilities) {
    return document.body?.dataset?.workspaceView === 'operations-center' &&
      capabilities?.can?.('sync.operations') !== false &&
      capabilities?.isSuperAdmin === true;
  }

  function updateOperationsCenterDevActionVisibility(capabilities = window.DleOsCapabilities) {
    const visible = canShowOperationsCenterSyncAction(capabilities);
    const button = getSyncOperationsButton();
    const status = getSyncOperationsStatusPanel();
    if (button) button.hidden = !visible;
    if (status) status.hidden = !visible;
  }

  function invokeOperationsCenterSync() {
    const start = window.OperationsCenter?.startSyncOperations || window.startSyncOperations;
    if (typeof start === 'function') start();
  }

  function ensureOperationsCenterDevControls() {
    const utilities = document.getElementById('dleDevControlsUtilities');
    if (!utilities) return;

    if (!getSyncOperationsButton()) {
      const button = document.createElement('button');
      button.id = 'syncOperationsButton';
      button.type = 'button';
      button.textContent = 'Sync Operations';
      button.hidden = true;
      button.addEventListener('click', invokeOperationsCenterSync);
      utilities.append(button);
    }

    if (!getSyncOperationsStatusPanel()) {
      const status = document.createElement('section');
      status.id = 'syncOperationsStatus';
      status.className = 'sync-operations-status';
      status.setAttribute('aria-live', 'polite');
      status.hidden = true;
      status.innerHTML = '<strong>Sync Operations</strong><span>Loading governed synchronization status&hellip;</span>';
      utilities.append(status);
    }

    updateOperationsCenterDevActionVisibility();
  }
  function initialize() {
    const toggle = document.getElementById('dleDevControlsToggle');
    const panel = document.getElementById('dleDevControlsPanel');
    const badge = document.getElementById('dleEnvironmentBadge');
    startFactoryClock();
    ensureViewModeToggle();
    applyWorkspaceViewMode();
    if (!toggle || !panel || !badge || toggle.dataset.initialized === 'true') return;
    toggle.dataset.initialized = 'true';

    const collapse = () => {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = 'DEV <span aria-hidden="true">▾</span>';
    };
    const applyCapabilities = capabilities => {
      const authorized = capabilities?.isSuperAdmin === true;
      toggle.hidden = !authorized;
      badge.hidden = authorized;
      if (!authorized) collapse();
      ensureOperationsCenterDevControls();
      updateOperationsCenterDevActionVisibility(capabilities);
    };
    toggle.addEventListener('click', () => {
      if (window.DleOsCapabilities?.isSuperAdmin !== true) return;
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      panel.hidden = expanded;
      toggle.setAttribute('aria-expanded', String(!expanded));
      toggle.innerHTML = expanded
        ? 'DEV <span aria-hidden="true">▾</span>'
        : 'DEV <span aria-hidden="true">▴</span>';
    });
    document.addEventListener('dle:capabilities-ready', event => applyCapabilities(event.detail));
    document.addEventListener('dle:workspace-change', () => {
      updateOperationsCenterDevActionVisibility();
      applyWorkspaceViewMode();
    });
    ensureOperationsCenterDevControls();
    applyCapabilities(window.DleOsCapabilities);
  }

  initialize();
  window.DleOperatorHeader = Object.freeze({
    initialize,
    formatFactoryTime,
    factoryTimeZone: FACTORY_TIME_ZONE,
    getViewMode,
    setViewMode,
    isDesktopView: () => viewMode === DESKTOP_VIEW_MODE,
    isMobileView: () => viewMode === MOBILE_VIEW_MODE
  });
})(window, document);
