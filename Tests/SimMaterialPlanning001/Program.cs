using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;

var repo=Path.GetFullPath(args[0]);
var source=Path.GetFullPath(args[1]);
var root=Path.Combine(repo,"tmp","material-planning","qualification-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
var checks=0;
void Check(bool value,string message){if(!value)throw new Exception(message);checks++;Console.WriteLine("PASS "+message);}
string Hash(string file)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file)));
var sourceHashes=new[]{"data/dle-os-sim.db","data/rfq-intakes.json","state/metadata.json"}.ToDictionary(x=>x,x=>Hash(Path.Combine(source,x)));
foreach(var folder in new[]{"data","state"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories))
{
    if(file.EndsWith("dle-os-sim.db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var dest=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(file,dest);
}
await using(var from=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(source,"data/dle-os-sim.db"),Mode=SqliteOpenMode.ReadOnly,Pooling=false}.ToString()))
await using(var to=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(root,"data/dle-os-sim.db"),Pooling=false}.ToString()))
{
    await from.OpenAsync();await to.OpenAsync();from.BackupDatabase(to);

}
var state=new SimStateStore(root);await state.InitializeAsync();
var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(state.Current.Metadata!);

var intakes=new SimRfqIntakeStore(root);
var provider=new SimKittingRequirementsProvider(intakes,ops);
var service=new SimMaterialPlanning(state,ops,intakes,provider){UtcNow=()=>new DateTimeOffset(2026,9,23,12,0,0,TimeSpan.Zero)};
var due=new DateOnly(2026,10,14);
foreach(var pair in new[]{(0,"2026-10-14"),(3,"2026-10-09"),(5,"2026-10-07"),(10,"2026-09-30"),(15,"2026-09-23")})
    Check(SimMaterialPlanning.Iso(SimMaterialPlanning.Subtract(due,pair.Item1))==pair.Item2,$"subtract {pair.Item1} Monday-Friday days");
Check(SimMaterialPlanning.Subtract(new(2027,1,4),1)==new DateOnly(2027,1,1),"year boundary, no invented holiday calendar");
Check(SimMaterialPlanning.Subtract(new(2026,10,11),1)==new DateOnly(2026,10,9),"weekend due subtracts working day");
var risk=SimMaterialPlanning.Risk("2026-10-09","2026-10-07",new(2026,9,23),8);
Check(risk.BufferWorkingDays==2&&risk.ProductionAtRisk==false&&risk.SupplierLate==false&&risk.Status=="On Time","current supply buffer2 not at risk not late");
Check(SimMaterialPlanning.Risk("2026-10-09","2026-10-12",new(2026,9,23),8).ProductionAtRisk==true,"promise after need-by at risk");
Check(SimMaterialPlanning.Risk("2026-10-09","2026-10-10",new(2026,9,23),8).ProductionAtRisk==true,"weekend after Friday is at risk even at zero working-day buffer");
Check(SimMaterialPlanning.Risk("2026-10-09","2026-10-07",new(2026,10,8),8).Status=="Late","open past ETA late independently of production buffer");
Check(SimMaterialPlanning.Risk("2026-10-09","2026-10-07",new(2026,10,7),8).Status=="Expected Today","expected today distinct");
Check(SimMaterialPlanning.Risk(null,"2026-10-07",new(2026,9,23),8).ProductionAtRisk==null,"missing authority cannot be on time");
Check(SimMaterialPlanning.Risk("2026-10-09",null,new(2026,9,23),8).Status=="Expected Date Missing","missing ETA not on time");
var model=await service.Read(SimPersonaCatalog.Default);
var work=model.WorkOrders.Single(w=>w.WorkOrderNumber=="0999999");var demand=work.Demands.Single();
Console.WriteLine(JsonSerializer.Serialize(model,json));
Check(demand.Schedule?.CustomerDueDate=="2026-10-14"&&demand.Schedule.MaterialNeedBy=="2026-10-09","accepted live-copy authority resolves due and need-by");
Check(demand.Schedule!.Lead==new SimManufacturingLead(3,"DAYS"),"frozen 3 DAYS used instead of quote delivery3WEEKS");
Check(demand.Short==8&&demand.Orders.Single().Ordered==8&&demand.Orders.Single().Received==0&&demand.Orders.Single().Open==8,"projection preserves8 ordered0 received8 open");
Check(work.CompactText=="Ordered · ETA 10/07/2026","compact supply separate from material status");
var intake=(SimRfqIntakeRecord)(await intakes.ReadAsync("RFQI-SIM-0043"))!;
var package=intake.OrderEntry!.Acceptance.Package;
var baseline=package.TechnicalSource!.Baseline!;
foreach(var weeks in new[]{1,2,3}) {
 var modified=package with {TechnicalSource=package.TechnicalSource with {Baseline=baseline with {Labor=baseline.Labor with {ManufacturingLead=new(weeks,"WEEKS")}}}};
 Check(SimMaterialPlanning.Derive(modified,new{}).WorkingDays==weeks*5,$"{weeks} frozen weeks are {weeks*5} working days");
}
var invalid=package with {TechnicalSource=package.TechnicalSource with {Baseline=baseline with {Labor=baseline.Labor with {ManufacturingLead=null}}}};
try{SimMaterialPlanning.Derive(invalid,new{});throw new Exception("missing lead accepted");}catch(InvalidOperationException){Check(true,"missing frozen lead never falls back to quote delivery");}
invalid=package with {ContractDates=package.ContractDates! with {DueDateReview=null}};
try{SimMaterialPlanning.Derive(invalid,new{});throw new Exception("missing review accepted");}catch(InvalidOperationException){Check(true,"unreviewed due date unavailable");}
var again=await service.Read(SimPersonaCatalog.Default);
Check(JsonSerializer.Serialize(model,json)==JsonSerializer.Serialize(again,json),"reload stable read-only projection");
Check(SimMaterialPlanning.Risk("2026-10-09","2026-10-12",new(2026,10,20),0).ProductionAtRisk==false,"closed supply does not retain open production risk");
Check(SimMaterialPlanning.Buffer(new(2026,10,12),new(2026,10,9))==-1,"negative buffer crosses weekend");
invalid=package with {TechnicalSource=package.TechnicalSource with {Baseline=baseline with {Labor=baseline.Labor with {Version=999}}}};
try{SimMaterialPlanning.Derive(invalid,new{});throw new Exception("mismatched labor accepted");}catch(InvalidOperationException){Check(true,"labor must match frozen approved version");}
// Corrupt only the disposable accepted package: the existing token guard must fail closed.
var intakePath=Path.Combine(root,"data","rfq-intakes.json");
var node=System.Text.Json.Nodes.JsonNode.Parse(await File.ReadAllTextAsync(intakePath))!;
var target=node["records"]!.AsArray().Single(n=>n!["intakeId"]!.GetValue<string>()=="RFQI-SIM-0043")!;
target["orderEntry"]!["acceptance"]!["package"]!["technicalSource"]!["baseline"]!["labor"]!["manufacturingLead"]!["value"]=99;
await File.WriteAllTextAsync(intakePath,node.ToJsonString());
var changed=(await service.Read(SimPersonaCatalog.Default)).WorkOrders.Single(w=>w.WorkOrderNumber=="0999999").Demands.Single();
Check(changed.Schedule is null&&changed.Orders.Single().Risk.ProductionAtRisk is null,"changed frozen acceptance cannot display healthy supply");
Check(changed.Orders.Single().Ordered==8,"source failure retains purchase evidence without rewriting it");
foreach(var pair in sourceHashes)Check(Hash(Path.Combine(source,pair.Key))==pair.Value,"live source unchanged: "+pair.Key);
Console.WriteLine($"PASS {checks} checks");
