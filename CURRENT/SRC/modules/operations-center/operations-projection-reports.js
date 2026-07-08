/* -----------------------------------------------------
   460 - JS: OPERATIONS CENTER PROJECTION REPORTS
----------------------------------------------------- */

(function () {
  'use strict';

  window.OperationsCenter = window.OperationsCenter || {};

  const reportColumns = [
    { key: 'customer', label: 'Customer', width: '13%' },
    { key: 'customerPo', label: 'Customer P/O', width: '12%' },
    { key: 'salesOrder', label: 'Sales Order #', width: '9%' },
    { key: 'workOrder', label: 'Work Order', width: '9%' },
    { key: 'qtyOpen', label: 'Quantity Open', width: '7%' },
    { key: 'partNumber', label: 'Item #', width: '10%' },
    { key: 'description', label: 'Description', width: '21%' },
    { key: 'dueDate', label: 'Due Date', width: '8%' },
    { key: 'productionShipping', label: 'Production / Shipping', width: '11%', manualEntry: true }
  ];

  function printProductionProjectionReport() {
    const definition = buildProductionProjectionPrintDefinition();
    if (!definition.data.records.length) {
      window.alert('Select at least one work order in Projection Mode before printing the Production Projection Report.');
      return;
    }

    DlePrintEngine.print(definition).catch(error => {
      window.alert('Unable to print Production Projection Report: ' + (error?.message || error));
    });
  }

  function buildProductionProjectionPrintDefinition() {
    const records = getSelectedProjectionReportRecords();
    return {
      documentName: 'Production Projection Report',
      paperSize: 'letter',
      orientation: 'landscape',
      margins: '.35in',
      html: buildProductionProjectionHtml(records),
      css: buildProductionProjectionCss(),
      data: {
        reportType: 'productionProjection',
        records
      }
    };
  }

  function getSelectedProjectionReportRecords() {
    const projection = window.OperationsCenter.projection;
    const viewModel = window.OperationsCenter.viewModel;
    const selectedRecords = projection.getSelectedRecords(viewModel.getMasterRecords(), viewModel);

    return selectedRecords.map(record => {
      return reportColumns.reduce((reportRecord, column) => {
        reportRecord[column.key] = column.manualEntry
          ? ''
          : viewModel.getOfficialField(record, column.key);
        return reportRecord;
      }, {});
    });
  }

  function buildProductionProjectionHtml(records) {
    return [
      '<section class="dle-controlled-document production-projection-report">',
      '<header class="production-projection-header">',
      '<div>',
      '<h1>Production Projection Report</h1>',
      '<p>Selected work orders from Operations Center Projection Mode</p>',
      '</div>',
      '<div class="production-projection-meta">',
      '<strong>Generated:</strong><span>',
      escapeReportHtml(new Date().toLocaleString()),
      '</span>',
      '<strong>Selected Jobs:</strong><span>',
      escapeReportHtml(records.length),
      '</span>',
      '<strong>Page:</strong><span class="production-projection-page-number"></span>',
      '</div>',
      '</header>',
      '<table class="production-projection-table">',
      '<thead><tr>',
      reportColumns.map(column => '<th style="width: ' + column.width + ';">' + escapeReportHtml(column.label) + '</th>').join(''),
      '</tr></thead>',
      '<tbody>',
      records.length
        ? records.map(record => buildProductionProjectionRow(record)).join('')
        : '<tr><td colspan="' + reportColumns.length + '" class="production-projection-empty">No selected work orders.</td></tr>',
      '</tbody>',
      '</table>',
      '</section>'
    ].join('');
  }

  function buildProductionProjectionRow(record) {
    return [
      '<tr>',
      reportColumns.map(column => '<td class="' + (column.manualEntry ? 'production-projection-write-in-cell' : '') + '">' + escapeReportHtml(record[column.key]) + '</td>').join(''),
      '</tr>'
    ].join('');
  }

  function buildProductionProjectionCss() {
    return `
.production-projection-report {
  width: 100%;
}

.production-projection-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 2px solid #111827;
  padding-bottom: 8px;
  margin-bottom: 12px;
  break-after: avoid;
  page-break-after: avoid;
}

.production-projection-header h1 {
  margin: 0;
  color: #111827;
  font-size: 20px;
}

.production-projection-header p {
  margin: 4px 0 0;
  color: #374151;
  font-size: 11px;
}

.production-projection-meta {
  display: grid;
  grid-template-columns: auto auto;
  gap: 4px 12px;
  align-content: start;
  font-size: 10px;
  white-space: nowrap;
}

.production-projection-page-number::after {
  content: "Page " counter(page) " of " counter(pages);
}

.production-projection-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 9px;
  color: #111827;
}

.production-projection-table thead {
  display: table-header-group;
}

.production-projection-table th,
.production-projection-table td {
  border: 1px solid #9ca3af;
  padding: 6px;
  vertical-align: top;
  text-align: left;
  overflow-wrap: anywhere;
}

.production-projection-table th {
  background: #dbeafe;
  color: #111827;
  font-weight: 800;
}

.production-projection-table tbody tr:nth-child(even) td {
  background: #f8fafc;
}

.production-projection-write-in-cell {
  min-height: .32in;
  height: .32in;
}

.production-projection-empty {
  text-align: center;
  color: #6b7280;
  padding: 18px;
}
`;
  }

  function escapeReportHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]));
  }

  window.OperationsCenter.projectionReports = {
    printProductionProjectionReport,
    buildProductionProjectionPrintDefinition,
    getSelectedProjectionReportRecords
  };

  window.printProductionProjectionReport = printProductionProjectionReport;
})();
