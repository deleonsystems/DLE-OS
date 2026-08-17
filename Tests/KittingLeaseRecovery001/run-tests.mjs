import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const dashboard = fs.readFileSync(
  path.join(root, 'SRC/modules/work-order-dashboard/work-order-dashboard.js'), 'utf8');
const styles = fs.readFileSync(
  path.join(root, 'SRC/modules/work-order-dashboard/work-order-dashboard.css'), 'utf8');
const api = fs.readFileSync(path.join(root, 'SRC/api/dle-api-client.js'), 'utf8');

assert.match(api, /requestError\.authenticationRequired\s*=/,
  'Kitting API errors classify authentication-required responses');
assert.match(api, /X-DLE-OS-Authentication-Required'\) === 'true'/,
  'BFF authentication marker is preserved for Kitting calls');

assert.match(dashboard, /function isKittingLeaseExpiredError\(error\)/,
  'Kitting lease failure has a focused classifier');
assert.match(dashboard, /error\?\.status === 409 && error\?\.code === 'editing_lease_required'/,
  'only backend editing_lease_required 409 enters stale-lease recovery');
assert.match(dashboard, /function isKittingAuthenticationRequiredError\(error\)/,
  'authentication expiry is distinguished from lease expiry');
assert.match(dashboard, /!activeKittingRecovery && activeKittingEditable/,
  'editing ownership fails closed while recovery is active');

const stopBody = dashboard.match(/function stopActiveKittingEditing[\s\S]*?\n  }/)?.[0] ?? '';
assert.match(stopBody, /window\.clearTimeout\(activeKittingAutosaveTimer\)/,
  'recovery stops pending autosave timers');
assert.match(stopBody, /activeKittingEditable = false/,
  'recovery disables editing');
assert.match(stopBody, /draft: activeKittingTrialDraft \? structuredClone\(activeKittingTrialDraft\) : null/,
  'recovery preserves the local draft');

const reconnectBody = dashboard.match(/async function reconnectActiveKitting[\s\S]*?\n  }/)?.[0] ?? '';
assert.match(reconnectBody, /ensureKittingCase\(true\)/,
  'reconnect forces a fresh backend Kitting Case read');
assert.match(reconnectBody, /resumeKittingCase\(releasedBomPrototypeWorkOrder/,
  'free lease reacquisition uses the governed resume endpoint');
assert.match(reconnectBody, /kittingCaseReview\.isEditing[\s\S]*isSameKittingOperator\(kittingCaseReview\.editingOwner\)/,
  'same authenticated operator can safely resume an active owned lease');
assert.match(reconnectBody, /kind: 'LEASE_OWNED'/,
  'another user active lease remains read-only instead of being stolen');
assert.match(reconnectBody, /retainedDraft \|\| structuredClone\(kittingCaseReview\.draft\)/,
  'reconnect keeps local operator input when available');

assert.match(dashboard, /handleActiveKittingApiFailure\(error, 'Autosave failed\.'\)/,
  'autosave failures enter the recovery classifier');
assert.match(dashboard, /handleActiveKittingApiFailure\(error, 'Kitting submission failed\.'\)/,
  'submit failures enter the recovery classifier');
assert.match(dashboard, /handleActiveKittingApiFailure\(error, 'Traceability policy change failed\.'\)/,
  'policy-save failures enter the recovery classifier');

assert.match(dashboard, /document\.addEventListener\('visibilitychange', verify\)/,
  'iPad/browser foregrounding uses visibilitychange verification');
assert.match(dashboard, /window\.addEventListener\('pageshow', verify\)/,
  'iPad/browser page restoration uses pageshow verification');
assert.match(dashboard, /verifyActiveKittingAfterBrowserResume/,
  'browser resume verifies Kitting state before continued editing');
assert.match(dashboard, /current\.editingSessionId !== expectedSessionId/,
  'resume verification detects lost or changed editing leases');

assert.match(dashboard, /Resume \/ Reconnect Kitting/,
  'recoverable lease state exposes a reconnect action');
assert.match(dashboard, /Sign In Again/,
  'authentication recovery exposes the governed sign-in action');
assert.match(styles, /active-kitting-recovery/,
  'recovery state has a visible operator-facing banner');

const submitBody = dashboard.match(/function submitActiveKittingRow[\s\S]*?\n  }/)?.[0] ?? '';
assert.match(submitBody, /if \(!submitted\)[\s\S]*return false/,
  'validation failure does not run next-row positioning');
assert.match(submitBody, /positionNextActiveKittingRow\(sequence\)/,
  'next-row positioning remains limited to successful row submission');

console.log('Kitting lease/auth recovery source contracts: PASS');
