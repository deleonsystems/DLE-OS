import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", ".."
);
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const viewer = read(
  "SRC/modules/canonical-data-viewer/canonical-data-viewer.js"
);
const html = read(
  "SRC/modules/canonical-data-viewer/canonical-data-viewer.html"
);
const client = read("SRC/api/dle-api-client.js");
const control = read(
  "Tools/LiveSnapshotRefresh/ControlHost/Program.cs"
);
const runner = read(
  "Tools/InvoiceHistory/Invoke-InvoiceHistoryRefresh.ps1"
);
const source = read(
  "Tools/InvoiceHistory/VPro/INVOICE_HISTORY_BOUNDED_WINDOW_PROBE.src"
);
const importer = read(
  "Tools/InvoiceHistory/Import-InvoiceHistoryRefresh.ps1"
);
const schema = read(
  "Tools/InvoiceHistory/Database/020_AddInvoiceHistoryRefresh.sql"
);
const existingRefresh = read(
  "Tools/LiveSnapshotRefresh/Invoke-LiveSnapshotRefresh.ps1"
);
const erpRefreshLauncher = read(
  "Tools/LiveSnapshotRefresh/Start-LiveSnapshotRefresh.cmd"
);

assert.match(source, /ART03\$="X:\\AON\\ADATA\\ART-03"/);
assert.match(source, /ART13\$="X:\\AON\\ADATA\\ART-13"/);
assert.equal((source.match(/MODE="O_RDONLY"/g) || []).length >= 4, true);
assert.match(source, /FOR LN=0 TO 999/);
assert.match(source, /READ RECORD\(12,KEY=LKEY\$,DOM=3090\)/);
assert.doesNotMatch(source, /\b(?:WRITE RECORD|EXTRACT|INITFILE|ERASE)\b/);

assert.match(runner, /AddDays\(-44\)/);
assert.match(runner, /FileMode\]::CreateNew/);
assert.match(runner, /ALREADY_RUNNING/);
assert.match(runner, /non-elevated \$approvedIdentity/);
assert.match(runner, /\\\\deleon-server\\Add-ON\\AON\\ADATA/);
assert.doesNotMatch(runner, /\\\\(?!deleon-server\\Add-ON\\AON\\ADATA)[A-Za-z0-9._-]+\\/i);
assert.doesNotMatch(runner, /Register-ScheduledTask|New-ScheduledTask/);

assert.match(schema, /platform\.InvoiceHistoryRefreshRun/);
assert.match(schema, /LastInvoiceHistoryRefreshRunId/);
assert.match(importer, /IsolationLevel\]::Serializable/);
assert.match(importer, /function Get-InvoiceHistoryFileSha256/);
assert.match(importer, /Security\.Cryptography\.SHA256\]::Create\(\)/);
assert.doesNotMatch(importer, /Get-FileHash/);
assert.match(importer, /MissingFromSource/);
assert.doesNotMatch(importer, /DELETE FROM canonical\.CustomerInvoice/);
assert.match(importer, /Controlled Invoice History refresh rollback/);
assert.match(importer, /NO_SOURCE_CHANGES/);
assert.match(importer, /SUCCESS_WITH_CLARIFICATIONS/);

assert.match(
  control,
  /\/api\/platform\/refresh\/invoice-history\/v1\/status/
);
assert.match(
  control,
  /\/api\/platform\/refresh\/invoice-history\/v1\/run/
);
assert.match(control, /DLE-OS-HOST\\DLE-OS/);
assert.match(control, /WithOrigins\(allowedOrigins\)/);
assert.match(control, /RequireAuthorization\("SnapshotRefreshOperator"\)/);
assert.match(control, /erpRefreshLauncherPath/);
assert.match(control, /ErpRefreshIsRunning/);
assert.match(
  control,
  /explorer\.exe[\s\S]*erpRefreshLauncherPath/
);
assert.match(
  erpRefreshLauncher,
  /C:\\DLE-OS\\Canonical\\LiveMirror\\Refresh\\Invoke-LiveSnapshotRefresh\.ps1/
);

assert.match(html, />\s*Refresh Invoice History\s*</);
assert.match(html, /data-invoice-history-refresh-control/);
assert.match(viewer, /runInvoiceHistoryRefresh/);
assert.match(
  viewer,
  /state\.activeEntity !== "invoiceHistory"/
);
assert.doesNotMatch(
  viewer,
  /runInvoiceHistoryRefresh[\s\S]{0,1800}location\.reload/
);
assert.doesNotMatch(existingRefresh, /InvoiceHistory|CustomerInvoice/i);

const calls = [];
const context = {
  URL,
  window: {
    location: {
      hostname: "DLE-OS-HOST",
      origin: "http://DLE-OS-HOST:5041"
    },
    localStorage: { getItem: () => null },
    DLE_API_CONFIG: {}
  },
  localStorage: { getItem: () => null },
  console,
  URLSearchParams,
  fetch: async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: "READY" })
    };
  }
};
vm.createContext(context);
vm.runInContext(client, context);
await context.window.DleApiClient.liveCanonical
  .getInvoiceHistoryRefreshStatus();
await context.window.DleApiClient.liveCanonical
  .runInvoiceHistoryRefresh();
assert.match(
  calls[0].url,
  /\/api\/platform\/refresh\/invoice-history\/v1\/status$/
);
assert.match(
  calls[1].url,
  /\/api\/platform\/refresh\/invoice-history\/v1\/run$/
);
assert.equal(calls[0].options.method, "GET");
assert.equal(calls[1].options.method, "POST");
assert.equal(calls[0].options.credentials, "include");
assert.equal(calls[1].options.credentials, "include");

console.log(
  "INVOICE-HISTORY-REFRESH-001 automated tests: PASS (43 assertions)"
);
