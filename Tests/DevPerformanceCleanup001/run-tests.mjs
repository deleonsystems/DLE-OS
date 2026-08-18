import assert from 'node:assert/strict';
import fs from 'node:fs';

const program = fs.readFileSync(
  'Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/Program.cs', 'utf8');
const shell = fs.readFileSync('DLE_Work_Center_v4.0.0.html', 'utf8');
const kitting = fs.readFileSync(
  'SRC/workspaces/kitting/kitting-workspace.js', 'utf8');

assert.match(program, /AddResponseCompression[\s\S]*EnableForHttps = true/,
  'authenticated HTTPS text assets use response compression');
assert.match(program, /UseResponseCompression\(\)/,
  'compression middleware is active');
assert.match(program,
  /UseStaticFiles[\s\S]*public, max-age=0, must-revalidate/,
  'static assets may validate from browser cache without becoming stale across deployments');
assert.match(shell,
  /await Promise\.all\(\[[\s\S]*loadSystemCenterModule[\s\S]*loadKittingJobWorkspace[\s\S]*loadWorkOrderDashboardModule/,
  'independent module templates load concurrently before fail-closed bootstrap completion');
assert.match(kitting,
  /hasEmbeddedProjections[\s\S]*buildEmbeddedRmaReworkMemberships[\s\S]*buildEmbeddedApprovalReviews/,
  'Kitting reuses the validated governed projections already returned by its canonical loader');
assert.match(kitting,
  /hasEmbeddedProjections && !forceMaterialStatus[\s\S]*loadMaterialStatuses\(workOrderNumbers, \{ force: forceMaterialStatus \}\)/,
  'manual Kitting refresh retains its force-refresh material-status behavior');

console.log('Generic DEV performance cleanup contracts: PASS');
