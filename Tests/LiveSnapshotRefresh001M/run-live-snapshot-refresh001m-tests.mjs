import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const results = [];

async function test(name, action) {
  try {
    await action();
    results.push({ name, verdict: "PASS" });
    console.log("PASS", name);
  } catch (error) {
    results.push({ name, verdict: "FAIL", error: error.message });
    console.error("FAIL", name, error);
    process.exitCode = 1;
  }
}

const html = read("SRC/modules/canonical-data-viewer/canonical-data-viewer.html");
const viewer = read("SRC/modules/canonical-data-viewer/canonical-data-viewer.js");
const clientSource = read("SRC/api/dle-api-client.js");
const control = read("Tools/LiveSnapshotRefresh/ControlHost/Program.cs");
const runner = read("Tools/LiveSnapshotRefresh/Invoke-LiveSnapshotRefresh.ps1");
const promoter = read("Tools/LiveSnapshotRefresh/Promote-QualifiedSnapshotBoundary.ps1");
const promotionHost = read("Tools/LiveSnapshotRefresh/PromotionHost/Program.cs");
const salesHelper = read("Tools/LiveSnapshotRefresh/sales_order_refresh.py");

await test("01_separate_refresh_actions", () => {
  assert.match(html, />\s*Refresh View\s*</);
  assert.match(html, />\s*Run ERP Snapshot Refresh\s*</);
  assert.match(html, /data-canonical-refresh-control/);
});

await test("02_confirmation_and_no_forced_reload", () => {
  assert.match(viewer, /The current snapshot will remain active unless the refresh completes successfully/);
  assert.match(viewer, /runErpSnapshotRefresh/);
  assert.doesNotMatch(viewer, /runErpSnapshotRefresh[\s\S]{0,1600}location\.reload/);
  assert.match(viewer, /button\.disabled = state\.refresh\.running/);
});

await test("03_windows_auth_and_operator_allowlist", () => {
  assert.match(control, /AuthenticationSchemes\.Negotiate/);
  assert.match(control, /AuthenticationSchemes\.NTLM/);
  assert.match(control, /DLE-OS-HOST\\DLE-OS/);
  assert.match(control, /RequireAuthorization\("SnapshotRefreshOperator"\)/);
  assert.match(control, /MapPost\(/);
});

await test("04_exact_origin_credentialed_control", () => {
  assert.match(control, /http:\/\/dle-os-host:5041/);
  assert.match(control, /http:\/\/dle-os-host:5051/);
  assert.match(control, /WithOrigins\(allowedOrigins\)/);
  assert.doesNotMatch(control, /AllowAnyOrigin/);
  assert.match(control, /AllowCredentials/);
  assert.match(clientSource, /credentials: 'include'/);
  assert.match(clientSource, /http:\/\/DLE-OS-HOST:5043/);
});

await test("05_fixed_sources_and_no_unc", () => {
  for (const source of [
    "BMM-01", "IVM-01", "WOE-01", "GLM-01",
    "ARE-03", "ARE-13", "ARM-01", "ARM-10", "WOE-03"
  ]) {
    assert.match(runner, new RegExp(source));
  }
  assert.doesNotMatch(runner, /\\\\DeLeon-Server/i);
  assert.doesNotMatch(runner, /New-ScheduledTask|Register-ScheduledTask|schtasks/i);
});

await test("06_lock_change_and_failure_controls", () => {
  assert.match(runner, /FileMode\]::CreateNew/);
  assert.match(runner, /ALREADY_RUNNING/);
  assert.match(runner, /NO_SOURCE_CHANGES/);
  assert.match(runner, /QualificationInduceFailure/);
  assert.match(runner, /Restore-DirectorySnapshot/);
});

await test("07_atomic_protected_boundary", () => {
  assert.match(promoter, /current-qualified-snapshot\.json/);
  assert.match(promoter, /previous-qualified-snapshot\.json/);
  assert.match(promoter, /\[IO\.File\]::Replace/);
  assert.match(promoter, /SQL metadata does not match the promoted, hashed canonical package/);
});

await test("08_client_request_shape", async () => {
  const calls = [];
  const context = {
    window: {
      location: { hostname: "DLE-OS-HOST", origin: "http://DLE-OS-HOST:5041" },
      localStorage: { getItem: () => null },
      DLE_API_CONFIG: {}
    },
    localStorage: { getItem: () => null },
    console,
    URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ status: "READY" }) };
    }
  };
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  await context.window.DleApiClient.liveCanonical.getSnapshotRefreshStatus();
  await context.window.DleApiClient.liveCanonical.runSnapshotRefresh();
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[1].options.credentials, "include");
});

await test("09_local_elevated_promotion_boundary", () => {
  assert.match(promotionHost, /http:\/\/localhost:5044/);
  assert.match(promotionHost, /DLE-OS-HOST\\DLE-OS/);
  assert.match(promotionHost, /sourceAccess = "NONE"/);
  assert.doesNotMatch(promotionHost, /UseCors|WithOrigins|AllowAnyOrigin/);
  assert.match(runner, /http:\/\/localhost:5044\/api\/platform\/refresh\/v1\/promote/);
});

await test("10_sales_qualifier_literal_paths_and_bounded_timeout", () => {
  assert.match(salesHelper, /lambda _: f'0060 LET ROOT\$=/);
  assert.match(salesHelper, /compiled_source_name\.replace\(program\)/);
  assert.match(salesHelper, /timeout=7200/);
  assert.match(salesHelper, /MODE="O_RDONLY"/);
});

const output = {
  mission: "LIVE-SNAPSHOT-REFRESH-001M2",
  testedAtUtc: new Date().toISOString(),
  verdict: results.every(result => result.verdict === "PASS") ? "PASS" : "FAIL",
  results
};
const outputRoot = path.join(root, "Artifacts", "LiveSnapshotRefresh001M");
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(
  path.join(outputRoot, "frontend-static-test-results.json"),
  JSON.stringify(output, null, 2) + "\n"
);
if (process.exitCode) process.exit(process.exitCode);
