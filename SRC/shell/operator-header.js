(function registerOperatorHeader(window, document) {
  'use strict';

  const FACTORY_TIME_ZONE = 'America/Los_Angeles';
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

  function initialize() {
    const toggle = document.getElementById('dleDevControlsToggle');
    const panel = document.getElementById('dleDevControlsPanel');
    const badge = document.getElementById('dleEnvironmentBadge');
    startFactoryClock();
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
    applyCapabilities(window.DleOsCapabilities);
  }

  initialize();
  window.DleOperatorHeader = Object.freeze({
    initialize,
    formatFactoryTime,
    factoryTimeZone: FACTORY_TIME_ZONE
  });
})(window, document);
