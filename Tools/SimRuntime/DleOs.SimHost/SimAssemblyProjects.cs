internal static class SimAssemblyProjects
{
 internal static bool Enabled(SimRfqIntakeAssembly[] rows)=>rows.Length>1||rows.Any(r=>r.ProjectId is not null);
 internal static string Label(string parent,SimRfqIntakeAssembly row)=>row.ProjectId is null?parent:parent+"."+row.LineNumber.ToString(System.Globalization.CultureInfo.InvariantCulture);
 private static void Require(bool value,string text){if(!value)throw SimRfqIntakeProblem.BadRequest("ASSEMBLY_PROJECTS",text);}
 internal static void Validate(SimRfqIntakeCreateRequest request){
  var rows=request.Assemblies!;
  Require(rows.Length<=100&&rows.All(r=>r.LineNumber>0)&&rows.Select(r=>r.LineNumber).Distinct().Count()==rows.Length,"Assembly line identifiers must be unique and positive (up to 100 assemblies).");
  if(!Enabled(rows))return;
  Require(rows.All(r=>Guid.TryParseExact(r.ProjectId,"D",out var id)&&id!=Guid.Empty&&id.ToString()==r.ProjectId)&&rows.Select(r=>r.ProjectId).Distinct(StringComparer.Ordinal).Count()==rows.Length,"Each assembly needs its own permanent project ID.");
  Require(rows.All(r=>r.Scope is "MATERIAL_AND_LABOR" or "MATERIAL_ONLY" or "LABOR_ONLY"),"Choose the work scope separately for every assembly.");
  var ids=rows.Select(r=>r.ProjectId).ToHashSet(StringComparer.Ordinal);
  foreach(var file in request.TechnicalFiles??[]){
   Require(file.SharedAcrossProjects==true ? file.AssemblyProjectIds is null or {Length:0} : file.SharedAcrossProjects==false&&file.AssemblyProjectIds is {Length:>0},"Assign each file to all assemblies or explicit assembly projects.");
   if(file.AssemblyProjectIds is {} links)Require(links.Distinct(StringComparer.Ordinal).Count()==links.Length&&links.All(ids.Contains),"File associations must refer only to this request's assembly projects.");
  }
 }
 internal static void CheckGlobalIds(SimRfqIntakeAssembly[] rows,IEnumerable<SimRfqIntakeRecord> existing){
  var ids=rows.Where(r=>r.ProjectId is not null).Select(r=>r.ProjectId).ToHashSet(StringComparer.Ordinal);
  Require(!existing.SelectMany(r=>r.Assemblies).Any(a=>a.ProjectId is not null&&ids.Contains(a.ProjectId)),"An assembly project ID already belongs to another request. Resume the original draft instead of duplicating it.");
 }
 // Project-local fingerprint: changes to unrelated siblings do not invalidate this project.
 internal static PreparationIntake Scope(PreparationIntake source,int line){
  var a=source.Assemblies.SingleOrDefault(a=>a.LineNumber==line)??throw SimRfqIntakeProblem.BadRequest("PREPARATION_LINE","Choose an assembly project.");
  if(a.ProjectId is null)return source;
  var files=source.Files.Where(f=>f.SharedAcrossProjects==true||f.AssemblyProjectIds?.Contains(a.ProjectId,StringComparer.Ordinal)==true).Select(f=>f with{AssemblyProjectIds=null,SharedAcrossProjects=null}).ToArray();
  return source with{Assemblies=[a],Files=files,Status=source.Status=="NO_LONGER_REQUIRED"?source.Status:"ASSEMBLY_PROJECT",ProjectId=a.ProjectId,DisplayId=Label(source.IntakeId,a)};
 }
}
