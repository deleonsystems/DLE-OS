import assert from 'node:assert/strict';
import fs from 'node:fs';

const program = fs.readFileSync(
  'Tools/DevelopmentRuntime/DleOs.DevelopmentFrontend/Program.cs', 'utf8');
const shell = fs.readFileSync('DLE_Work_Center_v4.0.0.html', 'utf8');

assert.match(program, /AddResponseCompression[\s\S]*EnableForHttps = true/,
  'authenticated HTTPS text assets use response compression');
assert.match(program, /UseResponseCompression\(\)/,
  'compression middleware is active');
assert.match(program,
  /UseStaticFiles[\s\S]*public, max-age=0, must-revalidate/,
  'static assets may validate from browser cache without becoming stale across deployments');
assert.match(shell,
  /await Promise\.all\(\[[\s\S]*loadSystemCenterModule[\s\S]*loadWorkOrderDashboardModule/,
  'independent module templates load concurrently before fail-closed bootstrap completion');

console.log('Generic DEV performance cleanup contracts: PASS');
