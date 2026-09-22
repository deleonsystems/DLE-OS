internal static class MaterialSourcingChecks
{
 internal static async Task Run(SimRfqIntakeStore store,string id,SimPersona persona,int rowIndex=0)
 {
  var view=await store.ReadMaterials(id);var original=view.Plan.Rows;var row=original.Single(r=>r.Index==rowIndex) with {MfgPartNumber=null,MfgPartNumberSource=null};
  async Task Save(SimMaterialRow next){var rows=view.Plan.Rows.Select(r=>r.Index==row.Index?next:r).ToArray();view=await store.SaveMaterials(id,new(view.Plan.Revision,rows,false,view.Plan.MarkupPercent,2,1),persona);}
  async Task Block(SimMaterialRow next){try{await Save(next);throw new Exception("Sourcing guard failed");}catch(SimRfqIntakeProblem){}}
  await Block(row with{SourcingStatus="BOGUS"});
  await Save(row with{SourcingStatus="SOURCED"});
  view=await store.ReadMaterials(id);var locked=view.Plan.Rows.Single(r=>r.Index==row.Index);
  if(locked.SourcingStatus!="SOURCED"||locked.UnitPrice!=row.UnitPrice)throw new Exception("Sourced persistence changed values");
  await Block(locked with{UnitPrice=locked.UnitPrice+1});await Block(locked with{SourcingStatus="OPEN",Vendor="Changed"});
  await Save(locked with{SourcingStatus="OPEN"});
  await Save(row with{SourcingStatus="UNABLE_TO_SOURCE",Vendor="",VendorSource=null,UnitPrice=null,LeadDays=null,LeadTimeMode=null,LeadTimeValue=null});
  view=await store.ReadMaterials(id);locked=view.Plan.Rows.Single(r=>r.Index==row.Index);
  if(locked.SourcingStatus!="UNABLE_TO_SOURCE"||locked.UnitPrice!=null||locked.Vendor!="")throw new Exception("Exception fabricated sourcing");
  await Save(locked with{SourcingStatus="OPEN"});
  await Save(row with{MfgPartNumber="SYNTHETIC-UNAPPROVED",MfgPartNumberSource="MANUAL_QUOTE_ONLY",SourcingStatus="SOURCED"});
  view=await store.ReadMaterials(id);locked=view.Plan.Rows.Single(r=>r.Index==row.Index);
  if(locked.SourcingStatus!="SOURCED")throw new Exception("Manual identity must not infer a sourcing exception");
  await Save(locked with{SourcingStatus="OPEN"});await Save(locked with{SourcingStatus="NEEDS_ALTERNATE"});
  view=await store.ReadMaterials(id);locked=view.Plan.Rows.Single(r=>r.Index==row.Index);
  if(locked.SourcingStatus!="NEEDS_ALTERNATE")throw new Exception("Explicit exception failed");
  await Save(locked with{SourcingStatus="OPEN"});await Save(row with{SourcingStatus="CUSTOMER_SUPPLIED",OrderQuantity=999,OrderQuantityMode="MANUAL",Vendor="",VendorSource=null,UnitPrice=12,LeadDays=null,LeadTimeMode=null,LeadTimeValue=null,Notes="",Evidence=null});
  view=await store.ReadMaterials(id);locked=view.Plan.Rows.Single(r=>r.Index==row.Index);
  var calculated=view.Rows.Single(r=>r.Quote.Index==row.Index);
  if(!locked.CustomerSupplied||locked.SourcingStatus!="CUSTOMER_SUPPLIED"||locked.UnitPrice!=null||locked.Vendor!=""||calculated.ExtendedCost!=0||calculated.Issues.Length!=0||locked.OrderQuantity!=calculated.RequiredQuantity||locked.OrderQuantityMode!="AUTO")throw new Exception("Customer supply must exclude purchased cost without fabricated fields or notes");
  await Save(locked with{SourcingStatus="OPEN"});
  if(view.Rows.Single(r=>r.Quote.Index==row.Index).Issues.Length==0)throw new Exception("Clearing must restore ordinary completion requirements");
  if(view.Plan.Rows.Single(r=>r.Index==row.Index).UnitPrice!=null)throw new Exception("Clearing must not resurrect supplier cost");
  if(view.Plan.Rows.Single(r=>r.Index==row.Index).CustomerSupplied)throw new Exception("Clearing must restore normal supply responsibility");
  await Save(original.Single(r=>r.Index==rowIndex));
  Console.WriteLine("PASS: sourcing statuses persist, lock guards reject edits, reopen preserves values, exceptions stay blank and exceptions remain explicit.");
 }
}
