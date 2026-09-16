using System.Text.Json;
internal static class CustomerSuppliedChecks {
 internal static async Task Run(string sourceRoot,string id,SimPersona persona) {
  var root=Path.Combine(Path.GetTempPath(),"customer-supplied-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
  foreach(var name in new[]{"rfq-intakes.json","rfq-lanes.json"})File.Copy(Path.Combine(sourceRoot,"data",name),Path.Combine(root,"data",name));
  var store=new SimRfqIntakeStore(root);var m=await store.ReadMaterials(id);var original=m.Plan.Rows;
  void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS: Customer Supplied "+message);}
  var rows=original.Select((r,i)=>r with{CustomerSupplied=i<2,Notes=i<2?"Customer provides material":r.Notes}).ToArray();
  m=await store.SaveMaterials(id,new(m.Plan.Revision,rows,false,m.Plan.MarkupPercent),persona);
  var v=await new SimRfqIntakeStore(root).ReadFinalReview(id);
  Check(v.Summary.CustomerSuppliedMaterial==true&&v.Summary.CustomerSuppliedItems!.Length==2,"saved draft derives multiple identities after reopen");
  foreach(var item in v.Summary.CustomerSuppliedItems!) {var bom=m.Rfq.Inputs.Materials.Candidate.Rows.Single(r=>r.Index==item.Index);Check(item.FindNo==bom.Values["lineNumber"]&&item.InternalPartNumber==bom.Values["partNumber"],"identity joins accepted BOM, not manufacturer P/N");}
  Check(v.Blockers.Length>0&&!v.ApprovalCurrent,"draft cannot reuse old approval");
  m=await store.SaveMaterials(id,new(m.Plan.Revision,rows,true,m.Plan.MarkupPercent),persona);v=await store.ReadFinalReview(id);
  var a=new SimFinalAnswers("4 Weeks",false,false,true,"LOW","","CLASS_2",false,"");
  v=await store.ApproveFinalReview(id,new(v.SourceToken,v.Approvals.Length,a),persona);
  var snapshot=JsonSerializer.Serialize(v.Approvals.Last());
  m=await store.SaveMaterials(id,new(m.Plan.Revision,original.Select(r=>r with{CustomerSupplied=false}).ToArray(),false,m.Plan.MarkupPercent),persona);
  v=await new SimRfqIntakeStore(root).ReadFinalReview(id);
  Check(v.Summary.CustomerSuppliedMaterial==false&&v.Summary.CustomerSuppliedItems!.Length==0,"zero flags derive No");
  Check(JsonSerializer.Serialize(v.Approvals.Last())==snapshot,"approved supplied identities immutable after edits and restart");
 }
}
