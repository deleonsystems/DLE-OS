using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);var root=Path.GetFullPath(args[2]);
if(Directory.Exists(root))throw new Exception("Fresh fixture required");
foreach(var f in Directory.GetFiles(source,"*",SearchOption.AllDirectories)){var to=Path.Combine(root,Path.GetRelativePath(source,f));Directory.CreateDirectory(Path.GetDirectoryName(to)!);File.Copy(f,to);}
var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);int count=0;
void Check(bool ok,string m){if(!ok)throw new Exception(m);count++;Console.WriteLine("PASS "+m);}
async Task Reject(Func<Task> f){try{await f();throw new Exception("Expected conflict");}catch(KittingCaseProblem){count++;}}
var state=new SimStateStore(root);await state.InitializeAsync();var store=new SimRfqIntakeStore(root);var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(state.Current.Metadata!);
var provider=new SimKittingRequirementsProvider(store,ops);var service=new SimKittingCases(state,ops,provider);var admin=SimPersonaCatalog.Default;var runtime=state.Current.Metadata!;
var before=(await ops.ReadSimKittingCase("0999998",runtime))!;
var release=await provider.ResolveAsync("0999998",runtime);
var process=await store.ReadBomProcess("RFQI-SIM-0036",admin);
var req=new SimProductionBomCorrectionRequest(before.CaseId,before.WorkingVersion,7,process.ContentToken,"Miguel authorized the bounded SIM production metadata correction.");
Check(before.WorkingVersion==2&&before.EditingSessionId is null,"saved case version 2 has no lease");
await Reject(()=>service.CorrectProductionBom("0999999",req,admin));
await Reject(()=>service.CorrectProductionBom("0999998",req with{ExpectedWorkingVersion=1},admin));
await Reject(()=>service.CorrectProductionBom("0999998",req with{ExpectedProcessRevision=6},admin));
await Reject(()=>service.CorrectProductionBom("0999998",req with{ExpectedProcessContentToken="wrong"},admin));
await Reject(()=>service.CorrectProductionBom("0999998",req with{CaseId=Guid.NewGuid()},admin));
try{await service.CorrectProductionBom("0999998",req,SimPersonaCatalog.Get("order-entry-operator")!);throw new Exception("permission expected");}catch(SimOrderEntryPermissionException){count++;}
using(var db=new SqliteConnection("Data Source="+Path.Combine(root,"data","dle-os-sim.db")))
{
    await db.OpenAsync();var command=db.CreateCommand();command.CommandText="UPDATE SimKittingCase SET PayloadJson=@json WHERE CaseId=@id";
    command.Parameters.AddWithValue("@id",before.CaseId.ToString());
    command.Parameters.AddWithValue("@json",JsonSerializer.Serialize(before with{EditingSessionId=Guid.NewGuid(),EditingExpiresAtUtc=DateTimeOffset.UtcNow.AddMinutes(10)},json));
    await command.ExecuteNonQueryAsync();
    await Reject(()=>service.CorrectProductionBom("0999998",req,admin));
    command.Parameters["@json"].Value=JsonSerializer.Serialize(before,json);await command.ExecuteNonQueryAsync();
}
var intakeBefore=File.ReadAllBytes(Path.Combine(root,"data","rfq-intakes.json"));
await service.CorrectProductionBom("0999998",req,admin);
var after=(await ops.ReadSimKittingCase("0999998",runtime))!;
var correction=after.ProductionBomCorrection!;
Check(correction is not null&&correction.Kind=="AUTHORIZED_SIM_BASELINE_CORRECTION","truthful persisted correction provenance");
Check(correction!.PriorDraft.GetRawText()==before.Draft.GetRawText()&&correction.PriorFrozenDraft.GetRawText()==before.FrozenDraft.GetRawText()&&correction.PriorLineage.GetRawText()==before.Lineage.GetRawText(),"complete original draft and lineage recoverable");
var a=JsonSerializer.SerializeToNode(after,json)!.AsObject();var b=JsonSerializer.SerializeToNode(before,json)!.AsObject();
foreach(var k in new[]{"draft","frozenDraft","lineage","productionBomCorrection"}){a.Remove(k);b.Remove(k);}
Check(JsonNode.DeepEquals(a,b),"all case fields including version, times, state, PO policy unchanged");
JsonNode Strip(JsonElement e){var n=JsonNode.Parse(e.GetRawText())!;n.AsObject().Remove("productionBomCorrection");foreach(var g in n["groups"]!.AsArray())g!.AsObject().Remove("process");return n;}
Check(JsonNode.DeepEquals(Strip(after.Draft),Strip(before.Draft)),"all original draft values including FAIR, quantities, parts and picks unchanged");
Check(JsonNode.DeepEquals(Strip(after.FrozenDraft),Strip(before.FrozenDraft)),"original frozen requirements unchanged");
Check(intakeBefore.SequenceEqual(File.ReadAllBytes(Path.Combine(root,"data","rfq-intakes.json"))),"accepted order untouched");
var types=after.Draft.GetProperty("groups").EnumerateArray().GroupBy(g=>g.GetProperty("process").GetProperty("componentType").GetString()).ToDictionary(g=>g.Key!,g=>g.Count());
Check(types["SMT"]==48&&types["TH"]==1&&types["PCB"]==1&&types["UNKNOWN"]==5,"55 exact production types");
await service.CorrectProductionBom("0999998",req,admin);
Check((await ops.ReadSimKittingCase("0999998",runtime))!.ProductionBomCorrection!.Id==correction.Id,"retry is idempotent");
var reopened=new SimOperationsDataStore(repo,root);await reopened.InitializeAsync(runtime);
var persistedRelease=await new SimKittingRequirementsProvider(new SimRfqIntakeStore(root),reopened).ResolveAsync("0999998",runtime);
Check(JsonNode.DeepEquals(Strip(persistedRelease.Draft),Strip(release.Draft)),"reopened release retains original requirements");
Check(persistedRelease.Draft.GetProperty("groups")[2].GetProperty("process").GetProperty("componentType").GetString()=="SMT","reopened release loads persisted correction");
await store.SaveBomProcess("RFQI-SIM-0036",new(process.ContentToken,7,process.Rows.Select(r=>r with{ComponentType="UNKNOWN"}).ToArray()),admin);
var unchanged=await provider.ResolveAsync("0999998",runtime);
Check(unchanged.Draft.GetRawText()==persistedRelease.Draft.GetRawText(),"later quote edits cannot change corrected release");
await Reject(()=>{SimKittingCases.RequireFrozen(after.FrozenDraft,before.Draft);return Task.CompletedTask;});
var invalid=JsonNode.Parse(after.Draft.GetRawText())!;invalid["groups"]![0]!["process"]!["componentType"]="SMT";
await Reject(()=>{SimKittingCases.RequireFrozen(after.FrozenDraft,JsonSerializer.SerializeToElement(invalid,json));return Task.CompletedTask;});
SimKittingCases.RequireFrozen(after.FrozenDraft,after.Draft);Check(true,"corrected draft remains editable with frozen metadata protection");
var wrong=correction with{Source=process with{Rows=process.Rows.Select((r,i)=>i==0?r with{Key="mismatch"}:r).ToArray()}};
await Reject(()=>{SimProductionBomRecovery.Annotate(before.Draft,before.Lineage,wrong);return Task.CompletedTask;});
await service.Resume("0999998",new(after.WorkingVersion),admin);
var editing=(await ops.ReadSimKittingCase("0999998",runtime))!;
await service.Save("0999998",new(editing.WorkingVersion,editing.EditingSessionId,editing.Draft),admin,true);
var saved=(await ops.ReadSimKittingCase("0999998",runtime))!;
Check(saved.EditingSessionId is null && saved.ProductionBomCorrection!.Id==correction.Id,"normal resume/save-exit retains correction");
Console.WriteLine($"PASS {count} checks");
