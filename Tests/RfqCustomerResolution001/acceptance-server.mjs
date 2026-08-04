import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.RFQ_ACCEPTANCE_PORT || 5096);

const knownCustomer = {
  customerNumber: "001148",
  customerName: "Hughey & Phillips",
  aliases: ["HUGHEY & PHILLIPS INC"],
  sources: ["Customer Master", "Open Orders", "Sales Orders", "Invoice History"],
  openOrderRecords: 4,
  salesOrderRecords: 4,
  invoiceHistoryRecords: 17,
  customerMasterRecords: 1,
  mostRecentActivityDate: "2026-07-15T00:00:00"
};
const alternateCustomer = {
  ...knownCustomer,
  customerNumber: "000777",
  customerName: "Acme Controls",
  aliases: ["ACME CONTROL SYSTEMS"],
  openOrderRecords: 2,
  salesOrderRecords: 2,
  invoiceHistoryRecords: 5
};
const customerDirectory = [
  knownCustomer,
  alternateCustomer,
  ...Array.from({ length: 28 }, (_, index) => ({
    ...knownCustomer,
    customerNumber: String(2000 + index).padStart(6, "0"),
    customerName: `Established Customer ${String(index + 1).padStart(2, "0")}`,
    aliases: [],
    openOrderRecords: index + 1,
    salesOrderRecords: index + 1,
    invoiceHistoryRecords: 0
  }))
].sort((left, right) => left.customerName.localeCompare(right.customerName));

http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/platform/live/v1/customer-directory/search") {
    const query = (url.searchParams.get("q") || "").trim();
    if (query === "API-FAIL") {
      json(response, 503, { code: "not_ready", message: "Controlled failure." });
      return;
    }
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") || 25)));
    const normalized = query.toLowerCase();
    const numeric = /^\d+$/.test(query) ? String(Number(query)) : "";
    const matching = customerDirectory.filter(customer =>
      !query ||
      customer.customerNumber.includes(query) ||
      (numeric && String(Number(customer.customerNumber)) === numeric) ||
      customer.customerName.toLowerCase().includes(normalized) ||
      customer.aliases.some(alias => alias.toLowerCase().includes(normalized))
    );
    const offset = (page - 1) * pageSize;
    const items = matching.slice(offset, offset + pageSize);
    const totalPages = Math.ceil(matching.length / pageSize);
    json(response, 200, {
      query: query || null,
      items,
      returnedCount: items.length,
      totalItems: matching.length,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages
    });
    return;
  }
  const relative = url.pathname === "/"
    ? "Tests/RfqCustomerResolution001/acceptance.html"
    : decodeURIComponent(url.pathname.slice(1));
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
  response.writeHead(200, { "Content-Type": types[path.extname(resolved)] || "application/octet-stream" });
  fs.createReadStream(resolved).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`RFQ acceptance server listening on http://127.0.0.1:${port}`);
});

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
