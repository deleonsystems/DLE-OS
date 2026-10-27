// Offline preflight model for an exported role catalog; never opens a database.
// SQL migration must still be qualified on a disposable SQL Server clone.
internal sealed record ExistingRole(string Code,string Name,bool Active,bool SuperAdmin,bool System,string[] Permissions);
internal static class RoleCatalogPlan
{
 internal static CandidateRole[] Additions(IReadOnlyList<ExistingRole> existing){
  var additions=new List<CandidateRole>();
  foreach(var wanted in CandidateRoles.All){
   var found=existing.SingleOrDefault(r=>r.Code==wanted.Code);
   if(found is null){additions.Add(wanted);continue;}
   if(!found.Active||found.SuperAdmin||found.System||found.Name!=wanted.DisplayName||!found.Permissions.Order().SequenceEqual(wanted.Permissions.Order()))
    throw new InvalidOperationException("Existing role conflicts: "+wanted.Code);
  }
  return additions.ToArray();
 }
 internal static void Test(Action<bool,string> check){
  var existing=new List<ExistingRole>{new("SUPER_ADMIN","Super Administrator",true,true,true,[]),new("KITTING_PILOT","Kitting Pilot",true,false,false,["kitting.view"])};
  var before=System.Text.Json.JsonSerializer.Serialize(existing);
  var additions=Additions(existing);
  check(additions.Length==3,"offline role plan adds exactly three roles");
  check(before==System.Text.Json.JsonSerializer.Serialize(existing),"offline planning leaves existing roles untouched");
  var applied=existing.Concat(additions.Select(r=>new ExistingRole(r.Code,r.DisplayName,true,false,false,r.Permissions))).ToList();
  check(Additions(applied).Length==0,"offline exact catalog replay is idempotent");
  check(applied.Take(2).SequenceEqual(existing),"offline catalog merge preserves SUPER_ADMIN and Kitting roles");
  foreach(var conflict in new[]{applied[2] with{SuperAdmin=true},applied[2] with{Active=false},applied[2] with{Permissions=[..applied[2].Permissions,"kitting.view"]},applied[2] with{Permissions=[]}}){
   var failed=false;try{Additions([..existing,conflict]);}catch(InvalidOperationException){failed=true;}
   check(failed,"offline role conflict rejected: "+System.Text.Json.JsonSerializer.Serialize(conflict));
  }
 }
}
