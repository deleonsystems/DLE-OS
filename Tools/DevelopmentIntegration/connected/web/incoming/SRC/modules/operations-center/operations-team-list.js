(function () {
  'use strict';
  const oc = window.OperationsCenter;
  let selecting = false, snapshot = null, dialog;
  const columns = [['customer','Customer'],['salesOrder','Sales order'],['sequenceLine','Line'],['workOrder','Verified WO'],['partNumber','Assembly'],['revision','Rev'],['opQtyOpen','Qty remaining'],['customerDueDate','Customer due'],['dueDate','Estimated ship']];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const keys = () => Object.keys(oc.projection.state.selectedByKey).filter(k => oc.projection.isSelected(k));
  function refreshControls() {
    const button = document.getElementById('operationsTeamCreate');
    if (button) button.textContent = `Create Team List (${keys().length})`;
  }
  function initialize() {
    const toolbar = document.querySelector('.operations-center-toolbar');
    if (!toolbar || document.getElementById('operationsTeamCreate')) return;
    const group = document.createElement('div');
    group.className = 'operations-team-controls';
    group.innerHTML = '<button type="button" id="operationsTeamSelect" aria-pressed="false">Select orders</button><button type="button" id="operationsTeamCreate">Create Team List (0)</button>';
    toolbar.prepend(group);
    group.firstElementChild.addEventListener('click', event => {
      selecting = !selecting;
      event.currentTarget.setAttribute('aria-pressed', String(selecting));
      event.currentTarget.textContent = selecting ? 'Finish selecting' : 'Select orders';
      oc.table.renderTable();
    });
    group.lastElementChild.addEventListener('click', open);
    refreshControls();
  }
  function open() {
    const vm = oc.viewModel;
    const selected = keys();
    const visible = new Set(oc.table.getCurrentView().records.map(r => vm.getMasterRecordKey(r)));
    const records = oc.projection.getSelectedRecords(vm.getMasterRecords(), vm);
    const known = new Set(records.map(r => vm.getMasterRecordKey(r)));
    snapshot = {generated: new Date().toLocaleString(), rows: records.map(record => {
      const row = {key:vm.getMasterRecordKey(record), hidden:!visible.has(vm.getMasterRecordKey(record))};
      columns.forEach(([key]) => row[key] = vm.getOfficialField(record,key) ?? 'Not set');
      row.workOrder = vm.resolveGovernedWorkOrderNumber(record) || 'Not verified';
      row.revision = record.drawingRevision || record.bomRevision || 'Not recorded';
      return row;
    }), missing:selected.filter(k => !known.has(k))};
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'operations-team-dialog';
      dialog.setAttribute('aria-labelledby','operationsTeamHeading');
      dialog.innerHTML = '<header><h2 id="operationsTeamHeading">Team List</h2><button type="button" data-action="close" aria-label="Close Team List">Close</button></header><label>Title<input id="operationsTeamTitle" value="Team build list" maxlength="160"></label><label>Message<textarea id="operationsTeamMessage" rows="3" placeholder="Hey team — here are the orders we need status on."></textarea></label><p data-scope></p><p data-missing></p><div class="operations-team-scroll" data-preview></div><footer><button type="button" data-action="clear">Clear selection</button><button type="button" data-action="copy">Copy list</button><button type="button" data-action="print">Print / Save PDF</button></footer><p role="status" data-status></p>';
      document.body.append(dialog);
      dialog.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'close') dialog.close();
        if (action === 'clear') { [...snapshot.rows.map(r=>r.key),...snapshot.missing].forEach(k=>oc.projection.setSelected(k,false)); snapshot.rows=[];snapshot.missing=[];changed(); }
        if (action === 'remove') {oc.projection.setSelected(button.dataset.key,false);snapshot.rows=snapshot.rows.filter(r=>r.key!==button.dataset.key);changed();}
        if (action === 'missing') {snapshot.missing.forEach(k=>oc.projection.setSelected(k,false));snapshot.missing=[];changed();}
        if (action === 'print') print();
        if (action === 'copy') copy();
      });
    }
    dialog.querySelector('[data-status]').textContent='';
    render();dialog.showModal();
  }
  function changed() {render();refreshControls();oc.table.renderTable();oc.table.renderProjectionSummary();}
  function table(editable) {
    return '<table><thead><tr>'+columns.map(([,label])=>'<th>'+label+'</th>').join('')+(editable?'<th>Selection</th>':'')+'</tr></thead><tbody>'+snapshot.rows.map(row=>'<tr>'+columns.map(([key])=>'<td>'+escape(row[key])+'</td>').join('')+(editable?'<td><button type="button" data-action="remove" data-key="'+escape(row.key)+'" aria-label="Remove sales order '+escape(row.salesOrder)+' line '+escape(row.sequenceLine)+'">Remove</button></td>':'')+'</tr>').join('')+'</tbody></table>';
  }
  function render() {
    dialog.querySelector('[data-scope]').textContent = `${snapshot.rows.length} selected order lines • ${snapshot.rows.filter(r=>r.hidden).length} hidden by the current view/filter, included below • Generated ${snapshot.generated}. Selection is shared with Projections.`;
    dialog.querySelector('[data-missing]').innerHTML = snapshot.missing.length ? `${snapshot.missing.length} saved selections are unavailable and cannot be included. Review/clear these before exporting. <button type="button" data-action="missing">Remove unavailable selections</button>` : '';
    dialog.querySelector('[data-preview]').innerHTML = snapshot.rows.length ? table(true) : '<p>Select order lines using “Select orders”, then create your Team List.</p>';
    dialog.querySelectorAll('[data-action="print"],[data-action="copy"]').forEach(b=>b.disabled=!snapshot.rows.length || !!snapshot.missing.length);
  }
  function documentData() {
    return {title:dialog.querySelector('#operationsTeamTitle').value.trim() || 'Team List',message:dialog.querySelector('#operationsTeamMessage').value,generated:snapshot.generated,records:snapshot.rows.map(({key,hidden,...row})=>row)};
  }
  function definition() {
    const data=documentData();
    return {documentName:data.title,paperSize:'letter',orientation:'landscape',margins:'.35in',data,
      html:'<section class="operations-team-print"><h1>'+escape(data.title)+'</h1><p class="message">'+escape(data.message)+'</p><p>Generated '+escape(data.generated)+' • '+data.records.length+' order lines</p>'+table(false)+'</section>',
      css:'.operations-team-print{font:11px Arial,sans-serif;color:#111}.operations-team-print table{width:100%;border-collapse:collapse}.operations-team-print th,.operations-team-print td{border:1px solid #aaa;padding:7px;text-align:left;overflow-wrap:anywhere}.operations-team-print thead{display:table-header-group}.operations-team-print tr{break-inside:avoid}.operations-team-print .message{white-space:pre-wrap}'};
  }
  async function print() {if(!snapshot.rows.length || snapshot.missing.length)return;try{await DlePrintEngine.print(definition());}catch(error){dialog.querySelector('[data-status]').textContent='Unable to print: '+error.message;}}
  async function copy() {
    if(!snapshot.rows.length || snapshot.missing.length)return;
    const data=documentData();
    const text=[data.title,data.message,`Generated ${data.generated} • ${data.records.length} order lines`,'',columns.map(([,label])=>label).join('\t'),...data.records.map(row=>columns.map(([key])=>String(row[key]).replace(/[\t\r\n]+/g,' ')).join('\t'))].join('\n');
    try{await navigator.clipboard.writeText(text);dialog.querySelector('[data-status]').textContent='List copied.';}catch(error){dialog.querySelector('[data-status]').textContent='Clipboard unavailable. Select and copy the preview, or use Print / Save PDF.';}
  }
  oc.teamList={initialize,refreshControls,isSelecting:()=>selecting};
})();
