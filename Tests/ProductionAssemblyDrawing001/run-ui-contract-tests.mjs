import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const dashboard = read('SRC/modules/work-order-dashboard/work-order-dashboard.js');
const markup = read('SRC/modules/work-order-dashboard/work-order-dashboard.html');
const host = read('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/Program.cs');
const resolver = read('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/DrawingPrintsResolver.cs');
const launcher = read('Tools/DevelopmentRuntime/DrawingPrintsLauncher/Invoke-DrawingPrintsProtocol.ps1');

assert.match(markup, /<a id="workOrderDashboardAssemblyDrawing"[^>]*aria-disabled="true"/);
assert.doesNotMatch(markup, /id="workOrderDashboardAssemblyDrawing"[^>]*onclick=/);
assert.match(markup, /id="workOrderDashboardAssemblyDrawingDialog"/);
assert.match(dashboard, /canonical\.drawingRevision \|\| canonical\.bomRevision/);
assert.match(dashboard, /originCustomerName \|\| canonical\.customerName/);
assert.match(dashboard, /assemblyDrawingEndpoint \+ '\?' \+ parameters\.toString\(\)/);
assert.match(dashboard, /cache:\s*'no-store'/);
assert.match(dashboard, /credentials:\s*'same-origin'/);
assert.doesNotMatch(dashboard, /launchAssemblyDrawingUri|window\.location\.assign\(value\)/);
assert.match(dashboard, /link\.setAttribute\('href', href\)/);
assert.match(dashboard, /data-dle-desktop-operation/);
assert.match(dashboard, /Desktop folder access unavailable/);
assert.match(dashboard, /return true;\s*}\s*if \(!\['REVISION_SELECTION_REQUIRED'/);
assert.match(dashboard, /\^dle-drawing-prints:/);
assert.doesNotMatch(dashboard, /DeLeon-Server|\\\\[^'"\s]+\\Production\\Drawing-Prints|explorer\.exe/i);

assert.match(host, /api\/development\/drawing-prints\/v1\/resolve/);
assert.match(host, /Only governed manufacturing identity parameters are supported/);
assert.match(resolver, /\\\\DeLeon-Server\\Production\\Drawing-Prints/);
assert.match(resolver, /ASSEMBLY_SELECTION_REQUIRED/);
assert.match(resolver, /REVISION_SELECTION_REQUIRED/);
assert.match(resolver, /CUSTOMER_ONLY/);
assert.doesNotMatch(resolver, /CreateDirectory|Delete|Move|WriteAll|FileStream/);

assert.match(launcher, /approvedComputer = 'DLE-OS-HOST'/);
assert.match(launcher, /approvedRoot = '\\\\DeLeon-Server\\Production\\Drawing-Prints'/);
assert.match(launcher, /\[IO\.Path\]::IsPathRooted\(\$relative\)/);
assert.match(launcher, /StartsWith\(\$root \+ '\\', \[StringComparison\]::OrdinalIgnoreCase\)/);
assert.match(launcher, /ReparsePoint/);
assert.match(launcher, /Test-Path -LiteralPath \$cursor -PathType Container/);
assert.match(launcher, /explorer\.exe/);
assert.doesNotMatch(launcher, /param\([\s\S]*?\[string\]\s+\$(?:Path|Folder|Root)/i);

const element = initial => {
  const attributes = new Map();
  return {
    hidden: false,
    textContent: '',
    dataset: {},
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); },
    ...initial
  };
};
const dialog = element({
  open: false,
  showModal() { this.open = true; },
  close() { this.open = false; }
});
const elements = new Map([
  ['workOrderDashboardModule', element()],
  ['workOrderDashboardModuleStatus', element()],
  ['workOrderDashboardAssemblyDrawing', element()],
  ['workOrderDashboardAssemblyDrawingMessage', element()],
  ['workOrderDashboardAssemblyDrawingDialog', dialog],
  ['workOrderDashboardAssemblyDrawingIdentity', element()],
  ['workOrderDashboardAssemblyDrawingStatus', element()],
  ['workOrderDashboardAssemblyDrawingChoices', element({ innerHTML: '' })],
  ['workOrderDashboardAssemblyDrawingDeepest', element({ hidden: true })]
]);
const resolutions = [];
const context = {
  window: {
    OperationsCenter: {},
    DleOsRuntimeConfig: { environment: 'ISOLATED_DEVELOPMENT' },
    location: {}
  },
  document: {
    documentElement: {
      getAttribute(name) {
        return name === 'data-dle-os-desktop-capabilities' ? 'ready' : null;
      }
    },
    addEventListener() {},
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll() { return []; }
  },
  fetch: async url => {
    if (!String(url).startsWith('/api/development/drawing-prints/v1/resolve?')) {
      return { ok: false, json: async () => ({}) };
    }
    return { ok: true, json: async () => resolutions.shift() };
  },
  URLSearchParams,
  structuredClone: value => JSON.parse(JSON.stringify(value)),
  console
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(dashboard, context);
const module = context.window.WorkOrderDashboardModule;
const handoff = () => ({
  canonicalWorkOrder: {
    workOrderNumber: '0115244',
    itemNumber: 'H24589',
    drawingRevision: 'J'
  },
  workOrderNumber: '0115244',
  originCustomerName: 'Meggitt',
  governingSource: 'EXACT',
  preferredDashboardView: 'production',
  preferredPresentation: 'dashboard',
  originRow: { official: { workOrder: '0115244' } },
  relatedRows: []
});
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
};

resolutions.push({
  status: 'RESOLVED',
  message: 'Assembly Drawing folder resolved.',
  openUri: 'dle-drawing-prints://open/TWVnZ2l0dFxIMjQ1ODktU0ZNXHJldiBq',
  desktopCapability: 'dlecap1_' + 'A'.repeat(43),
  capabilityCorrelationId: 'correlation-direct'
});
module.setSelectedWorkOrder(handoff());
await settle();
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('aria-disabled'), 'false');
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('href'), 'dle-drawing-prints://open/TWVnZ2l0dFxIMjQ1ODktU0ZNXHJldiBq');
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('onclick'), null);
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('data-dle-desktop-operation'),
  'open-drawing-folder');
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('data-dle-desktop-capability'),
  'dlecap1_' + 'A'.repeat(43));
assert.equal(elements.get('workOrderDashboardAssemblyDrawingMessage').textContent, 'Open Drawing Folder');
let prevented = false;
assert.equal(module.openAssemblyDrawing({
  currentTarget: elements.get('workOrderDashboardAssemblyDrawing'),
  preventDefault() { prevented = true; }
}), true);
assert.equal(prevented, false);

resolutions.push({
  status: 'REVISION_SELECTION_REQUIRED',
  message: 'Select a confirmed revision folder.',
  deepestOpenUri: 'dle-drawing-prints://open/TWVnZ2l0dFxIMjQ1ODktU0ZN',
  deepestDesktopCapability: 'dlecap1_' + 'B'.repeat(43),
  capabilityCorrelationId: 'correlation-choices',
  choices: [
    {
      label: 'REV J',
      openUri: 'dle-drawing-prints://open/TWVnZ2l0dFxIMjQ1ODktU0ZNXFJFViBK',
      desktopCapability: 'dlecap1_' + 'C'.repeat(43)
    },
    {
      label: 'REV G (OBSOLETE)',
      openUri: 'dle-drawing-prints://open/TWVnZ2l0dFxIMjQ1ODktU0ZNXFJFViBH',
      desktopCapability: 'dlecap1_' + 'D'.repeat(43)
    }
  ]
});
module.setSelectedWorkOrder(handoff());
await settle();
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('onclick'),
  'return openWorkOrderDashboardAssemblyDrawing(event)');
assert.equal(module.openAssemblyDrawing(), true);
assert.equal(dialog.open, true);
assert.equal(elements.get('workOrderDashboardAssemblyDrawingDeepest').hidden, false);
assert.match(elements.get('workOrderDashboardAssemblyDrawingChoices').innerHTML,
  /data-dle-desktop-operation="open-drawing-folder"/);
assert.equal(elements.get('workOrderDashboardAssemblyDrawingDeepest').getAttribute('href'),
  'dle-drawing-prints://open/TWVnZ2l0dFxIMjQ1ODktU0ZN');

resolutions.push({ status: 'UNRESOLVED', message: 'Assembly Drawing is unavailable.' });
module.setSelectedWorkOrder(handoff());
await settle();
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('aria-disabled'), 'true');
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('href'), null);
assert.equal(elements.get('workOrderDashboardAssemblyDrawing').getAttribute('onclick'), null);
assert.equal(module.openAssemblyDrawing(), false);

console.log('Production Assembly Drawing UI, endpoint, and launcher boundary contracts: PASS');
