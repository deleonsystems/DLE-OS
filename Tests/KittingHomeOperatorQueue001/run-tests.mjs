import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.html', 'utf8');
const script = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.js', 'utf8');
const styles = fs.readFileSync('SRC/workspaces/kitting/kitting-workspace.css', 'utf8');

assert.match(html, /data-kitting-lifecycle-tab="NEEDS_KITTING"/);
assert.match(html, /Kit Short \/ Awaiting Parts/);
assert.match(html, /data-kitting-lifecycle-tab="KIT_COMPLETE"/);
assert.doesNotMatch(html, /Resume \/ Needs Parts/);
assert.doesNotMatch(html, />Needs Resolution</);
assert.doesNotMatch(html, />RMA \/ Rework</);
assert.doesNotMatch(html, /kittingReadinessSummary/);
assert.match(html, /Search Work Order, Part, Customer, PO/);
assert.doesNotMatch(html, /kitting-filter-panel|kittingRelationshipFilter|kittingSort|>Filters</);
assert.match(html, /onclick="refreshKittingQueue\(\)"/);
assert.match(html, /↻ Refresh Queue/);
assert.match(script, /queues\.needsKitting/);
assert.match(script, /queues\.kittingInProgress/);
assert.match(script, /queues\.kitShort/);
assert.match(script, /queues\.kitComplete/);
assert.match(script, /\.\.\.\(queues\.needsKitting \|\| \[\]\)/);
assert.match(script, /\.\.\.\(queues\.kittingInProgress \|\| \[\]\)/);
assert.match(script, /"IN PROGRESS"/);
assert.match(script, /"KIT SHORT"/);
assert.match(script, /"KIT COMPLETE"/);
assert.match(script, /"NEW"/);
assert.match(script, /Searching all Kitting lifecycle states/);
assert.match(script, /Search Results/);
assert.match(script, /allKittingSearchRows/);
assert.doesNotMatch(script, /kittingRelationshipFilter|kittingSort/);
assert.match(script, /refreshKittingWorkspace\(\{ forceMaterialStatus: true \}\)/);
assert.match(script, /MaterialStatus\.invalidate\?\.\(workOrderNumbers, \{ notify: false \}\)/);
assert.match(script, /force: options\.force === true/);
assert.match(script, /!searchActive && button\.dataset\.kittingLifecycleTab/);
assert.match(script, /openKittingWorkOrder\(event\)/);
assert.match(script, /kitting-compact-assembly/);
assert.match(script, /kitting-compact-quantity/);
assert.match(script, /kitting-compact-due/);
assert.match(script, /<small>QTY<\/small>/);
assert.match(script, /<small>DUE<\/small>/);
assert.match(script, /function formatQueueDueDate\(value\)/);
assert.match(script, /\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$/);
assert.match(script, /`\$\{match\[2\]\}\/\$\{match\[3\]\}\/\$\{match\[1\]\}`/);
assert.match(script, /const dueDate = formatQueueDueDate\(row\.earliestDueDate\)/);
assert.match(script, /left\.earliestDueDateTime - right\.earliestDueDateTime/);

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const formatQueueDueDate = vm.runInNewContext(
  `const cleanText = value => String(value ?? '').trim();\n${extractFunction(script, 'formatQueueDueDate')}\nformatQueueDueDate`,
  { Date }
);
assert.equal(formatQueueDueDate('2026-08-05'), '08/05/2026');
assert.equal(formatQueueDueDate('2026-09-04'), '09/04/2026');
assert.equal(formatQueueDueDate('2025-01-27'), '01/27/2025');
assert.equal(formatQueueDueDate(''), 'N/A');
assert.equal(formatQueueDueDate('not-a-date'), 'not-a-date');
assert.equal(formatQueueDueDate('2026-02-30'), '2026-02-30');
assert.match(styles, /grid-template-columns:minmax\(118px,.7fr\).*minmax\(70px,.4fr\).*minmax\(112px,.55fr\)/);
assert.match(styles, /minmax\(170px,1fr\) 98px 24px/);
assert.match(styles, /\.kitting-compact-state\{[^}]*text-align:center/);
assert.match(styles, /\.kitting-compact-customer\{grid-column:2\/5;grid-row:2\}/);
assert.match(styles, /\.kitting-compact-customer\{grid-column:1\/-1;grid-row:4\}/);
assert.match(styles, /body\[data-workspace-view="kitting"\] main\{margin-top:12px\}/);
assert.match(styles, /\.kitting-workspace-header\{[^}]*min-height:0[^}]*background:transparent/);
assert.match(styles, /\.kitting-search-control\{margin-top:0\}/);
assert.match(styles, /\.kitting-search-control input\{[^}]*margin-top:0/);
assert.match(styles, /\.kitting-refresh\{[^}]*margin-top:0/);
assert.doesNotMatch(styles, /margin-top:-|transform:translateY\(-/);
assert.match(styles, /@media\(min-width:1281px\)/);
assert.match(styles, /body\[data-view-mode="desktop"\]\[data-workspace-view="kitting"\]>main\{padding-inline:clamp\(22px,2vw,32px\)\}/);
assert.match(styles, /body\[data-view-mode="desktop"\]\[data-workspace-view="kitting"\] \.kitting-workspace\{width:100%;max-width:none;margin-inline:0;padding-inline:0\}/);
assert.match(script, /preferredDashboardView: "standard"/);
assert.match(script, /preferredPresentation: "kitting-job"/);
assert.match(script, /KittingJobWorkspace\.open\(handoff\)/);
assert.doesNotMatch(script, /window\.go\("workOrderDashboardModule"\)/);
assert.match(script, /returnWorkspaceId: WORKSPACE_ID/);

console.log('Kitting Home operator queue structure and canonical handoff contracts: PASS');
