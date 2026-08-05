import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(
  path.join(root, 'SRC', 'workspaces', 'kitting', 'kitting-read-model.js'), 'utf8');
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const model = context.window.KittingReadModel.buildReadModel({
  lines: input.lines,
  approvalsByLineKey: input.approvalsByLineKey,
  workOrdersByNumber: input.workOrdersByNumber,
  documentsByWorkOrder: input.documentsByWorkOrder
});
console.log(JSON.stringify({
  generatedAt: model.generatedAt,
  counts: model.counts,
  queueWorkOrders: model.queues.notClassified.map(row => row.workOrderNumber),
  needsResolutionKeys: model.queues.needsResolution.map(row => row.queueKey)
}, null, 2));
