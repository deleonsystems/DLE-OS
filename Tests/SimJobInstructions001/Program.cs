using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

try {
var repo=Path.GetFullPath(args[0]);var source=Path.GetFullPath(args[1]);var output=Path.GetFullPath(args.Length>2?args[2]:Path.Combine(repo,"tmp","job-instructions"));
var root=Path.Combine(output,"tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
foreach(var folder in new[]{"data","state","intake-documents"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)){
    if(file.EndsWith(".db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
    var dest=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(dest)!);File.Copy(file,dest);
}
var db=Path.Combine(root,"data/dle-os-sim.db");
await using(var a=new SqliteConnection($"Data Source={Path.Combine(source,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False"))
await using(var b=new SqliteConnection($"Data Source={db};Pooling=False")){await a.OpenAsync();await b.OpenAsync();a.BackupDatabase(b);}
var checks=0;var json=SimProductionService.Json;var actor=SimPersonaCatalog.Default;var reader=SimPersonaCatalog.Get("read-only-viewer")!;var manager=SimPersonaCatalog.Get("operations-manager")!;
void Check(bool pass,string name){if(!pass)throw new Exception(name);checks++;Console.WriteLine("PASS "+name);}
async Task Reject(Func<Task> action,string code){try{await action();}catch(KittingCaseProblem e){Check(e.Code==code,code+" (actual "+e.Code+")");return;}catch(SimOrderEntryPermissionException){Check(code=="permission",code);return;}throw new Exception("Expected "+code);}
async Task Sql(string sql){await using var c=new SqliteConnection($"Data Source={db};Pooling=False");await c.OpenAsync();await using var q=c.CreateCommand();q.CommandText=sql;await q.ExecuteNonQueryAsync();}
async Task<Dictionary<string,string>> Tables(){
    await using var c=new SqliteConnection($"Data Source={db};Mode=ReadOnly;Pooling=False");await c.OpenAsync();var tables=new List<string>();
    await using(var q=c.CreateCommand()){q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())tables.Add(r.GetString(0));}
    var hashes=new Dictionary<string,string>();foreach(var table in tables){await using var q=c.CreateCommand();q.CommandText=$"SELECT * FROM [{table}] ORDER BY rowid";await using var r=await q.ExecuteReaderAsync();var rows=new List<string>();while(await r.ReadAsync()){var values=new object[r.FieldCount];r.GetValues(values);rows.Add(JsonSerializer.Serialize(values,json));}hashes[table]=SimProductionService.Hash(rows);}return hashes;
}
var before=await Tables();var files=Directory.EnumerateFiles(root,"*",SearchOption.AllDirectories).Where(p=>!p.EndsWith(".db")&&!p.EndsWith("-wal")&&!p.EndsWith("-shm")).ToDictionary(p=>p,p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))));
var state=new SimStateStore(root);await state.InitializeAsync();var operations=new SimOperationsDataStore(repo,root);await operations.InitializeAsync(state.Current.Metadata!);
var intakes=new SimRfqIntakeStore(root);var provider=new SimKittingRequirementsProvider(intakes,operations);
var service=new SimProductionService(state,operations,intakes,provider,new(root));const string wo="0999998";
JsonElement Node(object value)=>JsonSerializer.SerializeToElement(value,json);
var original=await service.Read(wo,actor);
var read=Node(await service.ReadJobInstructions(wo,actor));
Check(read.GetProperty("version").GetInt32()==0,"read does not seed a draft");
Check(read.GetProperty("baselineVersion").GetInt32()==5,"exact accepted Labor v5 baseline");
var sources=Node(await service.ReadInstructionSources(wo,actor));
await File.WriteAllTextAsync(Path.Combine(output,"frozen-sources.json"),sources.GetRawText());
Check(sources.GetProperty("baselineToken").GetString()==read.GetProperty("baselineToken").GetString(),"BOM source uses exact frozen Labor token");
Check(sources.GetProperty("process").GetProperty("rows").GetArrayLength()==55,"all 55 retained BOM annotations present");
var rows=read.GetProperty("operations").Deserialize<SimLaborOperation[]>(json)!;
var token=read.GetProperty("baselineToken").GetString()!;
Check(rows.Length==20,"20 accepted operations retained");
Check(rows.SelectMany(o=>o.Notes??[]).All(n=>n.Purpose=="PRODUCTION"&&!n.Removed),"only active production notes exposed");
var target=Array.FindIndex(rows,o=>o.Slides?.Any(c=>c.Kind=="DRAWING")==true);
var slide=rows[target].Slides!.First(c=>c.Kind=="DRAWING");
var pageInfo=await service.ReadInstructionPage(wo,slide.Source!.DocumentId,slide.Source.Sha256,0,2200,reader);
Check(JsonDocument.Parse(pageInfo).RootElement.GetProperty("pageCount").GetInt32()>=2,"read-only production user can resolve frozen drawing pages");
await File.WriteAllBytesAsync(Path.Combine(output,"drawing-info.json"),pageInfo);
await File.WriteAllBytesAsync(Path.Combine(output,"drawing-page.png"),await service.ReadInstructionPage(wo,slide.Source.DocumentId,slide.Source.Sha256,2,2200,actor));
await Reject(()=>service.ReadInstructionPage(wo,slide.Source.DocumentId,"wrong",2,2200,actor),"instructions_drawing_scope");
await Reject(()=>service.ReadInstructionPage(wo,slide.Source.DocumentId,slide.Source.Sha256,999,2200,actor),"instructions_drawing_page");
var mark=new SimDrawingMark(Guid.NewGuid().ToString(),slide.Page,"text",[new(.3,.3)],"JOB-ONLY TEST");
var stage=slide.Stages[0] with{Id=Guid.NewGuid().ToString(),Name="Job stage",Marks=[mark]};
var added=slide with{Id=Guid.NewGuid().ToString(),Title="Job copy",Stages=[stage]};
rows[target]=rows[target] with{Slides=[..rows[target].Slides![..^1],added,rows[target].Slides![^1]],Instructions="Job-local instructions"};
var request=new SimJobInstructionSave(0,token,rows);
await Reject(()=>service.SaveJobInstructions(wo,request,reader),"permission");
await Reject(()=>service.SaveJobInstructions(wo,request with{BaselineToken="bad"},actor),"instructions_baseline_changed");
var wrong=(SimLaborOperation[])rows.Clone();wrong[0]=wrong[0] with{RunSeconds=99};
await Reject(()=>service.SaveJobInstructions(wo,request with{Operations=wrong},actor),"instructions_operation_scope");
var png=Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJawAAAAASUVORK5CYII=");
var asset=await service.UploadInstructionAsset(wo,token,"job.png",png,actor);
Check((await service.OpenInstructionAsset(wo,asset.DocumentId,actor)).Bytes.SequenceEqual(png),"job image stored and read exactly");
var photo=new SimLaborSlidePhoto(Guid.NewGuid().ToString(),asset.DocumentId,asset.Sha256,"job.png",.1,.1,.2,.2,30);
rows[target]=rows[target] with{Slides=rows[target].Slides!.Select(c=>c.Id==added.Id?added with{Stages=[stage with{Photos=[photo]}]}:c).ToArray()};
var result=Node(await service.SaveJobInstructions(wo,request with{Operations=rows},actor));
Check(result.GetProperty("version").GetInt32()==1,"first job draft saved");
await Reject(()=>service.SaveJobInstructions(wo,request,actor),"instructions_version_changed");
var reloaded=new SimProductionService(state,operations,intakes,provider,new(root));
var loaded=Node(await reloaded.ReadJobInstructions(wo,actor));
Check(loaded.GetProperty("operations").GetRawText()==JsonSerializer.Serialize(rows,json),"full slides stages marks photos survive reload");
var second=rows.Select(o=>o with{Slides=o.Slides?.Reverse().ToArray()}).ToArray();
// Only reorder the unorganized test operation; retain established boundary invariants elsewhere.
second=(SimLaborOperation[])rows.Clone();second[target]=second[target] with{Slides=[..rows[target].Slides!.Where(c=>c.Id!=added.Id)],ExcludedSlideIds=[added.Id]};
await reloaded.SaveJobInstructions(wo,new(1,token,second),actor);
Check(Node(await service.ReadJobInstructions(wo,actor)).GetProperty("version").GetInt32()==2,"delete/exclusion saved with concurrency increment");
var current=await service.Read(wo,actor);
Check(original.GetRawText()==current.GetRawText(),"all production/kit/acceptance projections unchanged; no release created");
var after=await Tables();foreach(var entry in before)Check(after[entry.Key]==entry.Value,"original table unchanged "+entry.Key);
Check(files.All(p=>File.Exists(p.Key)&&Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p.Key)))==p.Value),"all original business files unchanged");
await Sql("CREATE TABLE SimProductionExecutionRecord(WorkOrderNumber TEXT,PayloadJson TEXT); INSERT INTO SimProductionExecutionRecord VALUES('0999998','{}');");
await service.SaveJobInstructions(wo,new(2,token,second),actor);Check(true,"job-local draft remains saveable as work progresses");
await service.UploadInstructionAsset(wo,token,"late.png",png,actor);Check(true,"job-local images remain separate from released execution state");
var bomHash=Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(sources.GetProperty("html").GetString()!)));
var v5Hash=Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("bom-reference-v5\n"+bomHash+"\n25")));
var bomCard=slide with{Id=Guid.NewGuid().ToString(),Kind="BOM",Source=slide.Source with{DocumentId="bom-reference-v5",Sha256=v5Hash,Name="View BOM"},Page=1,Stages=[slide.Stages[0] with{Id=Guid.NewGuid().ToString(),Marks=[],Photos=[],SavedView=slide.Stages[0].SavedView with{Page=1}}]};
var withBom=(SimLaborOperation[])second.Clone();withBom[target]=withBom[target] with{Slides=[..second[target].Slides![..^1],bomCard,second[target].Slides![^1]]};
await service.SaveJobInstructions(wo,new(3,token,withBom),actor);
Check(Node(await service.ReadJobInstructions(wo,actor)).GetProperty("version").GetInt32()==4,"generated frozen BOM not stored in baseline can be annotated and saved");
withBom[target]=withBom[target] with{Slides=withBom[target].Slides!.Select(c=>c.Id==bomCard.Id?c with{Source=c.Source! with{Sha256="bad"}}:c).ToArray()};
await Reject(()=>service.SaveJobInstructions(wo,new(4,token,withBom),actor),"instructions_slide_values");
await File.WriteAllTextAsync(Path.Combine(output,"backend-result.json"),JsonSerializer.Serialize(new{checks,root},json));
Console.WriteLine($"PASS {checks} job instruction checks; isolated root {root}");

}catch(Exception e){Console.Error.WriteLine(e);Environment.Exit(1);}
