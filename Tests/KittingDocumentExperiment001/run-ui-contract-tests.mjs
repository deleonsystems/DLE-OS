import fs from 'node:fs';
import assert from 'node:assert/strict';

const dashboard = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.js', 'utf8');
const markup = fs.readFileSync('SRC/modules/work-order-dashboard/work-order-dashboard.html', 'utf8');
const host = fs.readFileSync('Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/Program.cs', 'utf8');
const kitting = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.js', 'utf8');
const sales = fs.readFileSync('SRC/modules/sales-order-dashboard/sales-order-dashboard.js', 'utf8');

assert.match(host, /api\/development\/kitting-documents\/v1\/work-orders/);
assert.match(host, /\\\\deleon-server\\Production\\KITTING\\KIT-SHORTAGES/);
assert.match(host, /\\\\deleon-server\\Production\\KITTING\\KIT-COMPLETE/);
assert.match(host, /context\.Request\.Query\.Count != 0/);
assert.doesNotMatch(host, /MapGet\(kittingDocumentRoute[^\n]*(?:browse|directory|path)/i);
assert.doesNotMatch(dashboard, /file:\/\//i);
assert.match(dashboard, /isActionableKittingDocumentHandoff\(selectedWorkOrder\)/);
assert.match(dashboard, /governingSource === 'EXACT' \|\| governingSource === 'APPROVED'/);
assert.match(dashboard, /\!\/\^\\d\+\$\/\.test\(workOrderNumber\)/);
assert.match(dashboard, /window\.open\(documentEvidence\.openUrl, '_blank', 'noopener'\)/);
assert.match(markup, /Open Prior Shortage/);
assert.match(dashboard, /No matching PDF exists in either approved Kitting folder/);

assert.match(kitting, /preferredDashboardView:\s*['"]kitting['"]/);
assert.match(sales, /preferredDashboardView:\s*['"]standard['"]/);
assert.match(dashboard, /supportedDashboardViews\.has\(preferredView\) \? preferredView : 'standard'/);

console.log('PASS: 15 endpoint, security, actionable-handoff, UI, and preferred-view contract assertions.');
