using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using DleOs.Integration;
using DleOs.Security;
using DleOs.Quoting.Identity;

internal static class ReferenceChecks {
 internal static async Task Run(Action<bool,string> check){
  async Task Deny(Func<Task> action,string name){try{await action();throw new Exception("Expected rejection: "+name);}catch(BoundaryProblem){check(true,name);}}
  var handler=new DirectoryHandler();using var client=new HttpClient(handler){BaseAddress=new Uri("http://127.0.0.1:5052")};var customers=new CanonicalQuotingCustomers(client);
  var selected=CanonicalQuotingCustomers.Project(new("SYNTH-01","Synthetic customer"));
  await customers.Validate(selected,default);check(true,"canonical number/name reference revalidated before intake");
  check(handler.Last=="/api/platform/live/v1/customer-directory/search?q=SYNTH-01&page=1&pageSize=50","customer adapter uses existing read-only canonical contract");
  await Deny(()=>customers.Validate(selected with{CustomerName="forged"},default),"forged customer name rejected");
  await Deny(()=>customers.Validate(selected with{CustomerId="invented-guid"},default),"invented customer ID rejected");
  await Deny(()=>customers.Validate(selected with{ResolutionSource="isolated-fixture-directory"},default),"fixture customer provenance rejected");
  handler.Name="Changed name";await Deny(()=>customers.Validate(selected,default),"stale customer version rejected");handler.Name="Synthetic customer";
  handler.Duplicate=true;await Deny(()=>customers.Validate(selected,default),"duplicate canonical number rejected");handler.Duplicate=false;
  handler.More=true;await Deny(()=>customers.Validate(selected,default),"incomplete ambiguous customer search rejected");handler.More=false;
  handler.Status=HttpStatusCode.Forbidden;await Deny(()=>customers.Search(null,1,default),"upstream denial fails closed without fallback");handler.Status=HttpStatusCode.OK;
  using var invalidClient=new HttpClient(handler){BaseAddress=new Uri("https://other.invalid")};await Deny(()=>new CanonicalQuotingCustomers(invalidClient).Search(null,1,default),"unapproved customer destination rejected");
  var root=Path.GetFullPath(Path.Combine(TestPaths.Root,"disposable/reference-"+Guid.NewGuid().ToString("N")));Directory.CreateDirectory(root);
  var path=Path.Combine(root,"library.json");var sample=new LibraryReference("2026-10-27T00:00:00Z","synthetic-package",new string('A',64),[new("A","hash-A","V1.2","PART","D","N","","N",false),new("B","hash-B","V1.2","PART ","D","N","","N",false)]);
  var bytes=JsonSerializer.SerializeToUtf8Bytes(sample);await File.WriteAllBytesAsync(path,bytes);var source=new VerifiedLibraryReference(path,Convert.ToHexString(SHA256.HashData(bytes)));
  check(source.Read().Items.All(r=>r.NormalizedKeyCollision),"Library adapter recomputes normalized collisions without changing source keys");
  check(source.Read().RunId==sample.RunId&&source.Read().SourceSha256==sample.SourceSha256,"Library provenance retained from hash-pinned package");
  await File.AppendAllTextAsync(path," ");await Deny(()=>Task.FromResult(source.Read()),"changed Library package digest rejected");await File.WriteAllBytesAsync(path,bytes);
  var users=new ReviewerDirectory();var adminId=Guid.NewGuid();var role=CandidateRoles.ForFixture("ray")!;
  users.Rows[adminId]=new(adminId,"synthetic-admin","Synthetic reviewer","ACTIVE",[new(Guid.NewGuid(),"SUPER_ADMIN",true)],new HashSet<string>());
  var rayId=Guid.NewGuid();users.Rows[rayId]=new(rayId,"synthetic-ray","Synthetic Ray","ACTIVE",[new(Guid.NewGuid(),role.Code,false)],role.Permissions.ToHashSet());
  var reviewers=new QuotingReviewers(users,[adminId,rayId]);var result=await reviewers.Read();check(result.Length==1&&result[0].Id==adminId.ToString("D"),"reviewer IDs resolved through current active roles; Ray excluded");
  users.Rows[adminId]=users.Rows[adminId] with{AccountStatus="DISABLED"};check((await reviewers.Read()).Length==0,"reviewer disabled state reevaluated on each read");
  await Deny(()=>new QuotingReviewers(users,[Guid.Empty]).Read(),"missing immutable reviewer ID rejected");
  var domain=BoundQuotingDomain.Create(Path.Combine(root,"bound-domain"),"quoting-evidence",source);
  check(domain.Preparation.Headers().Length==2,"DEV domain composition uses pinned Library snapshot");
  var p=QuotingPolicy.Project(users.Rows[rayId]);var actor=new SimPersona(p.UserId.ToString("D"),p.UserName,p.DisplayName,"ACTIVE",p.Roles,p.Permissions,p.IsSuperAdmin,"synthetic-only",p.Workspaces);
  var draft=Guid.NewGuid().ToString("D");
  var fixtureBase=Path.GetFullPath(Path.Combine(TestPaths.Root,"connected/fixtures"));
  var drawing=await domain.Intake.StageDocument(draft,"drawing.pdf",0,new MemoryStream(await File.ReadAllBytesAsync(Path.Combine(fixtureBase,"drawing.pdf"))),actor);
  var bom=await domain.Intake.StageDocument(draft,"bom.xls",0,new MemoryStream(await File.ReadAllBytesAsync(Path.Combine(fixtureBase,"bom.xls"))),actor);
  var request=new SimRfqIntakeCreateRequest("NEW_QUOTE_REQUEST",selected,1,[new(1,"SYNTHETIC-BOUND","N",50,Guid.NewGuid().ToString(),"MATERIAL_AND_LABOR")],"MATERIAL_AND_LABOR",true,[drawing with{SharedAcrossProjects=true},bom with{SharedAcrossProjects=true}],["PRICE","LEAD_TIME"],null,draft);
  await customers.Validate(request.Customer,default);
  var now=DateTimeOffset.UtcNow;var metadata=new SimStateMetadata("DEVELOPMENT","synthetic-test-only",1,1,1,now,now,1,now,1,1,1);
  var created=JsonSerializer.SerializeToElement(await domain.Intake.CreateAsync(request,actor,metadata),SimLibraryBomStore.Json);
  var record=created.GetProperty("record").Deserialize<SimRfqIntakeRecord>(SimLibraryBomStore.Json)!;
  check(record.Environment=="DEVELOPMENT"&&record.IntakeId.StartsWith("RFQI-DEV-"),"bound intake persists DEV identity without enabling SIM mode");
  check(record.Customer.ReferenceVersion==selected.ReferenceVersion&&record.Customer.ResolutionSource=="canonical-customer-directory","bound intake preserves revalidated customer provenance");
  var repeated=JsonSerializer.SerializeToElement(await domain.Intake.CreateAsync(request,actor,metadata),SimLibraryBomStore.Json);
  check(repeated.GetProperty("duplicate").GetBoolean(),"bound intake preserves idempotent receipt semantics");
  var evidence=new ManagedLibraryEvidence(Path.Combine(root,"evidence"),"quoting-evidence");check(!Directory.Exists(Path.Combine(root,"evidence")),"bound evidence constructor performs no provisioning");
  check(new SimRfqIntakeStore(Path.Combine(root,"dev-state"),"DEVELOPMENT") is not null,"domain explicitly accepts DEV environment without SIM mode");
 }
 internal sealed class DirectoryHandler:HttpMessageHandler{
  internal string Name="Synthetic customer",Last="";internal bool Duplicate,More;internal HttpStatusCode Status=HttpStatusCode.OK;
  protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken token){
   token.ThrowIfCancellationRequested();if(request.Method!=HttpMethod.Get)throw new Exception("Source write attempted");Last=request.RequestUri!.PathAndQuery;
   var row=new CanonicalQuotingCustomers.Row("SYNTH-01",Name);return Task.FromResult(new HttpResponseMessage(Status){Content=JsonContent.Create(new CanonicalQuotingCustomers.DirectoryPage(Duplicate?[row,row]:[row],50,1,More?2:1,1,More))});
  }
 }
 sealed class ReviewerDirectory:IUserAuthorizationResolver {internal Dictionary<Guid,ResolvedSecurityUser> Rows=[];public Task<ResolvedSecurityUser?> ResolveByUserIdAsync(Guid id,CancellationToken token=default)=>Task.FromResult(Rows.GetValueOrDefault(id));}
}
