using System.Net.Http.Json;
internal static class RoleChecks
{
 internal static void Catalog(Action<bool,string> check){
  RoleCatalogPlan.Test(check);
  foreach(var role in CandidateRoles.All){
   var p=ConnectedActors.Persona(role.Persona)!;
   var original=SimPersonaCatalog.Get(role.Persona)!;
   check(p.Permissions.Order().SequenceEqual(original.Permissions.Order()),role.Code+" exact committed SIM permissions");
   check(p.AllowedWorkspaces!.SequenceEqual(original.AllowedWorkspaces!),role.Code+" exact committed SIM workspaces");
   check(!p.IsSuperAdmin&&p.Roles.SequenceEqual(new[]{role.Code}),"role fixture resolves responsibility role: "+role.Code);
   foreach(var denied in new[]{"kitting.view","kitting.disposition","sync.operations","technical_review.view","technical_review.disposition","work_orders.approve"})
    check(!p.Can(denied),role.Code+" denies "+denied);
   check(p.AllowedWorkspaces!.SequenceEqual(role.Workspaces),role.Code+" carries explicit workspace restriction");
  }
  check(ConnectedActors.Persona("unknown")==null,"unknown fixture fails closed");
 }
 internal static async Task Routes(HttpClient client,string id,Action<bool,string> check){
  async Task Read(string actor,string path,int status){using var r=new HttpRequestMessage(HttpMethod.Get,"/api/quoting/v1/"+path);r.Headers.Add("X-Fixture-Session",actor);using var response=await client.SendAsync(r);check((int)response.StatusCode==status,$"role GET {actor} {path}: {status}");}
  foreach(var actor in new[]{"ray","michelle","adan"}){
   await Read(actor,"customers",actor=="ray"?200:403);
   await Read(actor,"rfqs",actor=="adan"?403:200);
   await Read(actor,$"rfqs/{id}/labor",actor=="adan"?403:200);
   await Read(actor,$"rfqs/{id}/final-review",actor=="ray"?200:403);
   await Read(actor,"assembly-library/preliminary",200);
   await Read(actor,"technical-reviews",403);
   foreach(var path in new[]{$"rfqs/{id}/bom-updates/missing/adopt","technical-review/part-requests/missing/approved-result"}){
    using var r=new HttpRequestMessage(HttpMethod.Post,"/api/quoting/v1/"+path){Content=JsonContent.Create(new{})};r.Headers.Add("X-Fixture-Session",actor);r.Headers.Add("X-Rehearsal-Intent","fixture-only");using var response=await client.SendAsync(r);check((int)response.StatusCode==403,$"role POST {actor} {path}: 403");
   }
  }
 }
}
