using System.Text.Json;
using System.Text.Json.Nodes;
var source=Path.GetFullPath(args[0]);var output=Path.GetFullPath(args[1]);Directory.CreateDirectory(output);
var root=Path.Combine(output,"isolated-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
foreach(var file in new[]{"rfq-intakes.json","rfq-lanes.json"})File.Copy(Path.Combine(source,"data",file),Path.Combine(root,"data",file));
var store=new SimRfqIntakeStore(root);var id="RFQI-SIM-0042";
void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS: "+name);}
async Task Reject(Func<Task> action,string code){try{await action();}catch(SimRfqIntakeProblem e){Check(e.Code==code,code);return;}throw new Exception("Expected "+code);}
var view=await store.ReadFinalReview(id);
Check(view.Blockers.Length==0&&!view.ApprovalCurrent&&view.Approvals.Length==0,"completed sources, unapproved checkpoint");
Check(view.Summary.Customer=="DLE-SIM-CUSTOMER"&&view.Summary.Assembly=="SIM-ASSY-001"&&view.Summary.Revision=="A"&&view.Summary.Quantity==10&&view.Summary.CombinedUnitPrice==70.64m&&view.Summary.Total==706.40m&&view.Summary.NreTotal==0,"exact E2E commercial values from completed outputs");
var answers=new SimFinalAnswers("",null,null,null,"","INTERNAL-SECRET","",null,"",3,"WEEKS");
var request=new SimFinalApproveRequest(view.SourceToken,0,answers);
var before=Directory.GetFiles(root,"*",SearchOption.AllDirectories).ToDictionary(p=>p,File.ReadAllText);
await Reject(()=>store.PreviewQuotationPdf(id,request with{SourceToken="stale"}),"FINAL_STALE");
await Reject(()=>store.PreviewQuotationPdf(id,request with{ExpectedApprovalCount=1}),"FINAL_STALE");
await Reject(()=>store.PreviewQuotationPdf(id,request with{Answers=answers with{DeliveryValue=-1}}),"FINAL_ANSWERS");
var pdf=await store.PreviewQuotationPdf(id,request);await File.WriteAllBytesAsync(Path.Combine(output,"preview.pdf"),pdf);
await File.WriteAllBytesAsync(Path.Combine(output,"preview-pages.json"),await store.PreviewQuotationPdf(id,request,true));
Check(before.All(p=>File.ReadAllText(p.Key)==p.Value)&&Directory.GetFiles(root,"*",SearchOption.AllDirectories).Length==before.Count,"preview writes no business files or approved PDF store");
var reopened=await store.ReadFinalReview(id);Check(reopened.Approvals.Length==0&&reopened.SourceToken==view.SourceToken,"preview leaves approvals and source token unchanged");
await Reject(()=>store.GenerateQuotationPdf(id,1),"QUOTE_NOT_APPROVED");
// Approval is exercised only in the disposable copy to prove the real final path.
var approved=await store.ApproveFinalReview(id,request,new("test","test","Isolated preview contract test","ACTIVE",[],[],true,"test"));
var approval=approved.Approvals.Single();
var final=JsonSerializer.SerializeToNode(SimQuotationPdf.CustomerProjection(approval))!;
var preview=JsonSerializer.SerializeToNode(SimQuotationPdf.CustomerProjection(approval.Summary,approval.Answers,"PREVIEW / "+id,approval.ApprovedAt,true))!;
foreach(var key in new[]{"quoteNumber","quoteDate","preview"}){final.AsObject().Remove(key);preview.AsObject().Remove(key);}
Check(JsonNode.DeepEquals(final,preview),"preview/final commercial projections exactly equal excluding state/reference/date");
Check(!final.ToJsonString().Contains("INTERNAL-SECRET")&&!final.AsObject().ContainsKey("materialUnitSale"),"internal notes and cost breakdown excluded");
var generated=await store.GenerateQuotationPdf(id,1);var repeated=await store.GenerateQuotationPdf(id,1);
Check(generated.Sha256==repeated.Sha256,"approved PDF cache remains immutable");
var finalBytes=await store.ReadQuotationPdf(id,1);await File.WriteAllBytesAsync(Path.Combine(output,"isolated-final.pdf"),finalBytes.Bytes);
var approvedPreview=await store.PreviewQuotationPdf(id,new(approved.SourceToken,1,answers with{DeliveryValue=99}));
await File.WriteAllBytesAsync(Path.Combine(output,"approved-preview.pdf"),approvedPreview);
Check((await store.ReadFinalReview(id)).Approvals.Length==1,"preview of approved version does not create another approval");
// Stress the same renderer across page breaks without manufacturing business state.
var longProjection=JsonSerializer.SerializeToNode(SimQuotationPdf.CustomerProjection(approval))!;
longProjection["nreLines"]=JsonSerializer.SerializeToNode(Enumerable.Range(1,70).Select(n=>new{label="Pagination fixture line "+n,amount=0}));
await File.WriteAllBytesAsync(Path.Combine(output,"multipage-final.pdf"),await SimQuotationPdf.Render(longProjection));
longProjection["preview"]=true;
await File.WriteAllBytesAsync(Path.Combine(output,"multipage-preview.pdf"),await SimQuotationPdf.Render(longProjection));
Console.WriteLine("PASS: isolated final generation, approved preview and multipage fixtures rendered; live source untouched.");
