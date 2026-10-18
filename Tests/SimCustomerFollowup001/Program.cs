using System.Text.Json;
using Microsoft.Data.Sqlite;
try {
var repo=Path.GetFullPath(args[0]);var snapshot=Path.GetFullPath(args[1]);var root=Path.GetFullPath(args[2]);
if(Directory.Exists(root))throw new Exception("Fixture must be fresh");
foreach(var folder in new[]{"data","state"})foreach(var f in Directory.EnumerateFiles(Path.Combine(snapshot,folder),"*",SearchOption.AllDirectories)){
 var dest=Path.Combine(root,Path.GetRelativePath(snapshot,f));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(f,dest);
}
var state=new SimStateStore(root);await state.InitializeAsync();var runtime=state.Current.Metadata!;
var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(runtime);
var actor=new SimPersona("administrator","administrator","Fixture Buyer","ACTIVE",[],[],true,"isolated");
var service=new SimPurchasingService(state,ops);var json=SimPurchasingService.Json;int checks=0;
void Check(bool b,string label){if(!b)throw new Exception(label);checks++;Console.WriteLine("PASS "+label);}
async Task Block(Func<Task> action,string label){try{await action();}catch(SimPurchasingProblem){Check(true,label);return;}throw new Exception("Not blocked: "+label);}
async Task<Dictionary<string,string>> Tables(){using var c=new SqliteConnection($"Data Source={ops.DatabasePath};Mode=ReadOnly");await c.OpenAsync();using var list=c.CreateCommand();list.CommandText="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";var names=new List<string>();using(var rd=await list.ExecuteReaderAsync())while(await rd.ReadAsync())names.Add(rd.GetString(0));var result=new Dictionary<string,string>();foreach(var name in names){using var q=c.CreateCommand();q.CommandText="SELECT * FROM \""+name.Replace("\"","\"\"")+"\" ORDER BY rowid";if(name=="sqlite_sequence")q.CommandText="SELECT * FROM sqlite_sequence WHERE name <> 'SimPurchasingEvent' ORDER BY rowid";using var rd=await q.ExecuteReaderAsync();var rows=new List<object[]>();while(await rd.ReadAsync()){var a=new object[rd.FieldCount];rd.GetValues(a);rows.Add(a);}result[name]=JsonSerializer.Serialize(rows);}return result;}
var view=await service.Read(actor);await File.WriteAllTextAsync(Path.Combine(root,"buyer-before.json"),JsonSerializer.Serialize(view,json));
var before=await Tables();var target=view.Demands.Single(d=>d.WorkOrderNumber=="0999997"&&d.CustomerSupply?.CustomerPartNumber=="E8X001");
Check(target.CustomerPoNumber=="SIM-PO-0045-20261017-C72EE3","canonical customer PO projected");
Check(target.ApprovedPartNumber=="B82801C565A100"&&target.CustomerSupply!.CustomerPartNumber=="E8X001","customer PN distinct from approved MPN");
Check(target.ShortQuantity==50&&target.SourceCurrent,"current short quantity preserved");
SimCustomerContactRequest Request(SimPurchasingDemand d,string date="")=>new(d.Version,Guid.NewGuid(),d.CurrentSubmissionId??d.SubmissionId,d.SourceFingerprint,d.RemainingShortQuantity??d.ShortQuantity,date);
var request=Request(target);var at=DateTimeOffset.Parse("2026-10-18T02:00:00Z");service.UtcNow=()=>at;
var saved=await service.MarkCustomerContacted(target.DemandId,request,actor);
Check(saved.CustomerContact is {ExpectedDate:"",ActorId:"administrator",Actor:"Fixture Buyer"}&&saved.CustomerContact.AtUtc==at,"durable actor/time with optional date omitted");
Check(saved.Version==target.Version+1&&saved.State==target.State&&saved.AcceptedAtUtc==target.AcceptedAtUtc,"contact changes version without accepting/resolving demand");
Check(JsonSerializer.Serialize(saved with {Version=target.Version,CustomerContact=null},json)==JsonSerializer.Serialize(target,json),"all non-contact demand fields unchanged");
var replay=await service.MarkCustomerContacted(target.DemandId,request,actor);Check(replay.Version==saved.Version,"idempotent retry");
await Block(()=>service.MarkCustomerContacted(target.DemandId,request with{ExpectedDate="2026-10-23"},actor),"request UUID reuse rejected");
await Block(()=>service.MarkCustomerContacted(target.DemandId,Request(target),actor),"stale buyer version rejected");
await Block(()=>service.MarkCustomerContacted(target.DemandId,Request(saved) with{ExpectedSubmissionId=Guid.NewGuid()},actor),"stale submission rejected");
await Block(()=>service.MarkCustomerContacted(target.DemandId,Request(saved) with{ExpectedSourceFingerprint="old"},actor),"stale source identity rejected");
await Block(()=>service.MarkCustomerContacted(target.DemandId,Request(saved) with{ExpectedShortQuantity=49},actor),"stale quantity rejected");
await Block(()=>service.MarkCustomerContacted(target.DemandId,Request(saved,"2026-02-30"),actor),"invalid date rejected");
var buyerOnly=new SimPersona("viewer","viewer","Read Only","ACTIVE",[],[],false,"isolated");
try{await service.MarkCustomerContacted(target.DemandId,Request(saved),buyerOnly);throw new Exception("Missing permission guard");}catch(SimOrderEntryPermissionException){Check(true,"permission guard");}
var next=await service.MarkCustomerContacted(target.DemandId,Request(saved,"2026-10-23"),actor);
Check(next.CustomerContact?.ExpectedDate=="2026-10-23","optional expected date retained");
var concurrent=Request(next);var outcomes=await Task.WhenAll(Enumerable.Range(0,2).Select(async _=>{try{await service.MarkCustomerContacted(target.DemandId,concurrent with{RequestId=Guid.NewGuid()},actor);return true;}catch(SimPurchasingProblem){return false;}}));
Check(outcomes.Count(x=>x)==1,"concurrent contact has exactly one winner");
var freshOps=new SimOperationsDataStore(repo,root);await freshOps.InitializeAsync(runtime);var fresh=new SimPurchasingService(state,freshOps);
var reloaded=(await fresh.Read(actor)).Demands.Single(d=>d.DemandId==target.DemandId);
Check(reloaded.CustomerContact is not null&&reloaded.Version==next.Version+1,"contact survives store reopen");
Check((await fresh.History(actor)).Count(e=>e.EventType=="CUSTOMER_CONTACTED"&&e.EntityId==target.DemandId)==3,"repeated contacts append audit; retries and rejections add none");
var after=await Tables();foreach(var table in before.Keys.Where(t=>!new[]{"SimPurchasingDemand","SimPurchasingEvent","SimPurchasingCommand"}.Contains(t)))Check(before[table]==after[table],"unchanged table "+table);
var sub=reloaded.CurrentSubmissionId!.Value;var supply=reloaded.CustomerSupply;
Check(SimPurchasingService.CurrentContact(reloaded,Guid.NewGuid(),supply)==null,"new submission cannot inherit contact");
Check(SimPurchasingService.CurrentContact(reloaded with{RemainingShortQuantity=49},sub,supply)==null,"changed shortage cannot inherit contact");
Check(SimPurchasingService.CurrentContact(reloaded with{SourceCurrent=false},sub,supply)==null,"stale source cannot display contact");
Check(SimPurchasingService.CurrentContact(reloaded with{RemainingShortQuantity=0},sub,supply)==null,"resolved shortage cannot display contact");
Check(SimPurchasingService.CurrentContact(reloaded,sub,null)==null,"purchased balance cannot display contact");
var bought=await fresh.SetBalanceSource(target.DemandId,new(reloaded.Version,Guid.NewGuid(),"PURCHASED"),actor);
Check(bought.CustomerContact==null,"balance switch clears old contact");
await Block(()=>fresh.MarkCustomerContacted(target.DemandId,Request(bought),actor),"non-CS contact rejected");
var customer=await fresh.SetBalanceSource(target.DemandId,new(bought.Version,Guid.NewGuid(),"CUSTOMER_SUPPLIED"),actor);
var returned=(await fresh.Read(actor)).Demands.Single(d=>d.DemandId==target.DemandId);
Check(returned.CustomerContact==null&&returned.CustomerSupply is not null,"switch back does not resurrect contact");
Check(returned.CustomerPoNumber==target.CustomerPoNumber&&returned.CustomerSupply!.CustomerPartNumber=="E8X001","mixed-source roundtrip preserves customer identity");
Check((await ops.ReadSimKittingCase("0999997",runtime))!.WorkingVersion==19,"kit remains version19 after contact and balance actions");
await File.WriteAllTextAsync(Path.Combine(root,"buyer-after.json"),JsonSerializer.Serialize(await fresh.Read(actor),json));
Console.WriteLine($"PASS {checks} checks; isolated fixture {root}");
}catch(Exception e){Console.Error.WriteLine(e);Environment.ExitCode=1;}
