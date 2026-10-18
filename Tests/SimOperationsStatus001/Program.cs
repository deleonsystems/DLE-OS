using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
try {
var repo=Path.GetFullPath(args[0]);var snapshot=Path.GetFullPath(args[1]);var root=Path.GetFullPath(args[2]);
if(Directory.Exists(root))throw new Exception("Fixture root must be fresh");
foreach(var folder in new[]{"data","state"})foreach(var f in Directory.EnumerateFiles(Path.Combine(snapshot,folder),"*",SearchOption.AllDirectories)){
 var dest=Path.Combine(root,Path.GetRelativePath(snapshot,f));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(f,dest);
}
var state=new SimStateStore(root);await state.InitializeAsync();var runtime=state.Current.Metadata!;
var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(runtime);
var json=SimOperationsDataStore.PacketJson;int checks=0;
void Check(bool b,string label){if(!b)throw new Exception(label);checks++;Console.WriteLine("PASS "+label);}
JsonElement E(object? x)=>JsonSerializer.SerializeToElement(x,json);
async Task<JsonElement> Row(string so="0099997")=>E((await ops.ReadSalesOrderLinesAsync(new QueryCollection(new Dictionary<string,StringValues>{{"salesOrderNumber",so}}),runtime.Generation)).Items.Single());
async Task Sql(string text,params (string,object)[] values){using var c=new SqliteConnection($"Data Source={ops.DatabasePath};Foreign Keys=False");await c.OpenAsync();using var q=c.CreateCommand();q.CommandText=text;foreach(var(k,v)in values)q.Parameters.AddWithValue(k,v);await q.ExecuteNonQueryAsync();}
async Task<string> Value(string table){using var c=new SqliteConnection($"Data Source={ops.DatabasePath};Mode=ReadOnly");await c.OpenAsync();using var q=c.CreateCommand();q.CommandText=$"SELECT PayloadJson FROM {table} WHERE WorkOrderNumber='0999997'";return (string)(await q.ExecuteScalarAsync())!;}
var original=await Value("SimKittingCase");var release=await Value("SimQualityRelease");var imported=await Value("WorkOrder");
var baseline=await Row();Check(baseline.GetProperty("materialStatus").GetProperty("machineValue").GetString()=="KIT_SHORT","actual snapshot Kit Short projection");
Check(baseline.GetProperty("releaseState").GetString()=="RELEASED","current Quality release overrides import hold in projection");
Check(baseline.GetProperty("productionExecution").GetProperty("machineValue").GetString()=="NOT_STARTED","Kit Short does not become production readiness/status");
Check((await ops.ReadSimKittingCase("0999997",runtime))!.WorkingVersion==19,"snapshot version19 intact");
var outputs=new Dictionary<string,JsonElement>{{"KIT_SHORT",baseline}};
// Isolated SQL arrangements exercise read projections; they never touch the user's database.
await Sql("INSERT INTO KittingReadState VALUES('fixture','0999997','KIT_COMPLETE',@p)",("@p","{\"materialStatus\":{\"machineValue\":\"KIT_COMPLETE\",\"label\":\"Kit Complete\",\"source\":\"LEGACY_KITTING_EVIDENCE\"}}"));
foreach(var status in new[]{"KITTING_IN_PROGRESS","KIT_COMPLETE","KIT_SHORT"}){
 var node=JsonNode.Parse(original)!;node["state"]=status;node["runNumber"]=2;
 await Sql("UPDATE SimKittingCase SET PayloadJson=@p WHERE WorkOrderNumber='0999997'",("@p",node.ToJsonString()));
 var row=await Row();outputs[status]=row;
 Check(row.GetProperty("materialStatus").GetProperty("machineValue").GetString()==status,"live/re-kit "+status+" overrides old legacy completion");
 Check(row.GetProperty("productionExecution").GetProperty("machineValue").GetString()=="NOT_STARTED",status+" keeps independent production baseline");
}
await Sql("UPDATE SimKittingCase SET Generation=Generation-1 WHERE WorkOrderNumber='0999997'");
Check((await Row()).GetProperty("materialStatus").GetProperty("source").GetString()=="LEGACY_KITTING_EVIDENCE","stale-generation case ignored; legacy fallback retained");
await Sql("DELETE FROM KittingReadState WHERE WorkOrderNumber='0999997';DELETE FROM SimKittingCase WHERE WorkOrderNumber='0999997'");
var needs=await Row();outputs["NEEDS_KITTING"]=needs;Check(needs.GetProperty("materialStatus").GetProperty("machineValue").GetString()=="NEEDS_KITTING","released without current case Needs Kitting");
await Sql("DROP TRIGGER IF EXISTS SimQualityReleaseNoUpdate;DROP TRIGGER IF EXISTS SimQualityReleaseNoDelete;UPDATE SimQualityRelease SET Generation=Generation-1 WHERE WorkOrderNumber='0999997'");
var held=await Row();outputs["AWAITING_RELEASE"]=held;Check(held.GetProperty("materialStatus").GetProperty("machineValue").GetString()=="AWAITING_RELEASE","stale release cannot clear current hold");
Check(held.GetProperty("productionExecution").GetProperty("machineValue").GetString()=="NOT_STARTED","held job remains unstarted in production");
Check(await ops.ReadKittingCaseAsync("0999997",runtime.Generation) is null,"held job still has no actionable Kitting case");
await Sql("UPDATE SimQualityRelease SET Generation=@g WHERE WorkOrderNumber='0999997';INSERT INTO SimKittingCase VALUES(json_extract(@p,'$.caseId'),'0999997',json_extract(@p,'$.releasedBomIdentity'),@g,@p)",("@g",runtime.Generation),("@p",original));
await Sql("CREATE TABLE FixtureProductionExecution(WorkOrderNumber TEXT);INSERT INTO FixtureProductionExecution VALUES('0999998')");
Check((await Row()).GetProperty("productionExecution").GetProperty("machineValue").GetString()=="NOT_STARTED","another WO execution cannot change target baseline");
await Sql("INSERT INTO FixtureProductionExecution VALUES('0999997')");
var executing=await Row();outputs["EXECUTION_RECORDED"]=executing;
Check(executing.GetProperty("productionExecution").GetProperty("machineValue").GetString()=="EXECUTION_RECORDED","genuine execution is never overwritten as Not Started");
Check(executing.GetProperty("materialStatus").GetProperty("machineValue").GetString()=="KIT_SHORT","execution cannot promote material status");
await Sql("DROP TABLE FixtureProductionExecution");
var bound = new { id=Guid.NewGuid(),workOrderNumber="0999997",generation=runtime.Generation,operations=new[]{new{executionState="IN_PROGRESS"}},frozenPackage=new{} };
await Sql("INSERT INTO SimWoTraveler VALUES(@id,'0999997',@g,@p)",("@id",bound.id.ToString()),("@g",runtime.Generation),("@p",JsonSerializer.Serialize(bound,json)));
var progressing=await Row();outputs["IN_PROGRESS"]=progressing;
Check(progressing.GetProperty("productionExecution").GetProperty("machineValue").GetString()=="IN_PROGRESS","known execution progress remains visible");

Check(await Value("WorkOrder")==imported,"import evidence unchanged by all projections");
Check(await Value("SimKittingCase")==original,"original kit snapshot restored in test fixture");
// Compare every existing legacy row against its retained material evidence.
using(var c=new SqliteConnection($"Data Source={ops.DatabasePath};Mode=ReadOnly")){await c.OpenAsync();using var q=c.CreateCommand();q.CommandText="SELECT WorkOrderNumber,PayloadJson FROM KittingReadState";using var rd=await q.ExecuteReaderAsync();while(await rd.ReadAsync()){
 var expected=JsonDocument.Parse(rd.GetString(1)).RootElement.GetProperty("materialStatus");var actual=E(await ops.ReadKittingCaseAsync(rd.GetString(0),runtime.Generation));
 Check(actual.GetProperty("hasPersistentKittingHistory").GetBoolean()==expected.GetProperty("hasPersistentKittingHistory").GetBoolean(),"legacy read preserved "+rd.GetString(0));
 using var lookup=c.CreateCommand();lookup.CommandText="SELECT SalesOrderNumber FROM SalesOrderWorkOrderRelationship WHERE ActionableWorkOrderNumber=@wo LIMIT 1";lookup.Parameters.AddWithValue("@wo",rd.GetString(0));
 var so=(string)(await lookup.ExecuteScalarAsync())!;var legacyPage=await ops.ReadSalesOrderLinesAsync(new QueryCollection(new Dictionary<string,StringValues>{{"salesOrderNumber",so}}),runtime.Generation);var projected=legacyPage.Items.Select(E).Single(x=>x.GetProperty("materialStatusWorkOrderNumber").GetString()==rd.GetString(0));
 Check(projected.GetProperty("materialStatus").GetProperty("machineValue").GetString()==expected.GetProperty("machineValue").GetString(),"legacy Operations projection preserved "+rd.GetString(0));
}}
await File.WriteAllTextAsync(Path.Combine(root,"projection-fixtures.json"),JsonSerializer.Serialize(outputs,json));
Console.WriteLine($"PASS {checks} projection checks; fixture {root}");

} catch(Exception error) { Console.Error.WriteLine(error); Environment.ExitCode=1; }
