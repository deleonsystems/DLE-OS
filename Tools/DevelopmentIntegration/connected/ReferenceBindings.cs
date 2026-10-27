using DleOs.Integration;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DleOs.Security;
using DleOs.Quoting.Identity;

// The canonical API exposes customer numbers, not immutable employee/customer GUIDs.
// CustomerId below is that documented number; ReferenceVersion hashes the selected
// number/name, not an invented upstream import ID. Revalidation precedes persistence.
internal interface IQuotingCustomers {
 Task<object> Search(string? query,int page,CancellationToken token);
 Task Validate(SimRfqIntakeCustomer? customer,CancellationToken token);
}
internal sealed class CanonicalQuotingCustomers(HttpClient client) : IQuotingCustomers {
 internal sealed record Row(string CustomerNumber,string CustomerName);
 internal sealed record DirectoryPage(Row[] Items,int PageSize,int Page,long TotalPages,long TotalItems,bool HasMore);
 internal static SimRfqIntakeCustomer Project(Row r) => new(r.CustomerNumber,r.CustomerNumber,r.CustomerName,
  "canonical-customer-directory",Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(r)))));
 async Task<DirectoryPage> Read(string? query,int page,CancellationToken token){
  try {
  if(client.BaseAddress is not {IsLoopback:true,Scheme:"http"} target || target.Port!=5052)throw new BoundaryProblem(503,"CUSTOMER_BINDING_NOT_CONFIGURED");
  if(page<1||(query?.Length??0)>100||query?.Any(char.IsControl)==true)throw new BoundaryProblem(400,"CUSTOMER_QUERY_INVALID");
  using var response=await client.GetAsync("/api/platform/live/v1/customer-directory/search?q="+Uri.EscapeDataString(query??"")+"&page="+page+"&pageSize=50",token);
  if(!response.IsSuccessStatusCode)throw new BoundaryProblem(503,"CUSTOMER_REFERENCE_UNAVAILABLE");
  var result=await response.Content.ReadFromJsonAsync<DirectoryPage>(cancellationToken:token);
  if(result is null||result.Items is null||result.Page!=page||result.Items.Length>50||result.Items.Any(r=>string.IsNullOrWhiteSpace(r.CustomerNumber)||string.IsNullOrWhiteSpace(r.CustomerName))||result.Items.Select(r=>r.CustomerNumber).Distinct(StringComparer.Ordinal).Count()!=result.Items.Length)throw new BoundaryProblem(503,"CUSTOMER_REFERENCE_INVALID");
  return result;
  }catch(HttpRequestException){throw new BoundaryProblem(503,"CUSTOMER_REFERENCE_UNAVAILABLE");}
  catch(JsonException){throw new BoundaryProblem(503,"CUSTOMER_REFERENCE_INVALID");}
 }
 public async Task<object> Search(string? query,int page,CancellationToken token){var p=await Read(query,page,token);return new{items=p.Items.Select(Project),page=p.Page,totalPages=p.TotalPages,totalItems=p.TotalItems,hasMore=p.HasMore,fixtureOnly=false};}
 public async Task Validate(SimRfqIntakeCustomer? customer,CancellationToken token){
  if(customer is null)throw new BoundaryProblem(400,"CUSTOMER_NOT_RESOLVED");
  var p=await Read(customer.CustomerNumber,1,token);
  // Ambiguous/incomplete search fails closed; no arbitrary first match.
  var matches=p.Items.Where(r=>r.CustomerNumber==customer.CustomerNumber).ToArray();
  if(p.HasMore||matches.Length!=1||Project(matches[0])!=customer)throw new BoundaryProblem(409,"CUSTOMER_REFERENCE_CHANGED");
 }
}

internal sealed record LibraryReference(string SnapshotDate,string RunId,string SourceSha256,SimAssemblyHeader[] Items);
internal interface IQuotingLibraryReference { LibraryReference Read(); }
// Approved package path and digest must be supplied by composition. No default SIM
// snapshot, network scanning or permission changes. Missing bindings stay unavailable.
internal sealed class VerifiedLibraryReference(string path,string expectedSha256) : IQuotingLibraryReference {
 public LibraryReference Read(){
  var bytes=File.ReadAllBytes(path);
  if(expectedSha256.Length!=64||Convert.ToHexString(SHA256.HashData(bytes))!=expectedSha256)throw new BoundaryProblem(503,"LIBRARY_REFERENCE_INTEGRITY");
  var data=JsonSerializer.Deserialize<LibraryReference>(bytes)??throw new BoundaryProblem(503,"LIBRARY_REFERENCE_INVALID");
  if(!DateTimeOffset.TryParse(data.SnapshotDate,out _)||string.IsNullOrWhiteSpace(data.RunId)||data.SourceSha256.Length!=64||!data.SourceSha256.All(Uri.IsHexDigit)||data.Items is null||data.Items.Any(r=>string.IsNullOrWhiteSpace(r.SourceKeyRaw))||data.Items.Select(r=>r.SourceKeyRaw).Distinct(StringComparer.Ordinal).Count()!=data.Items.Length)throw new BoundaryProblem(503,"LIBRARY_REFERENCE_INVALID");
  // Preserve original record keys/hashes. Compute collisions instead of trusting input.
  var collisions=data.Items.GroupBy(r=>r.BillNumber.Trim(),StringComparer.Ordinal).Where(g=>g.Count()>1).Select(g=>g.Key).ToHashSet(StringComparer.Ordinal);
  return data with{Items=data.Items.Select(r=>r with{NormalizedKeyCollision=collisions.Contains(r.BillNumber.Trim())}).ToArray()};
 }
}
internal sealed class QuotingReviewers(IUserAuthorizationResolver users,Guid[] approvedUserIds) {
 internal async Task<SimPersona[]> Read(){
  if(approvedUserIds.Any(id=>id==Guid.Empty)||approvedUserIds.Distinct().Count()!=approvedUserIds.Length)throw new BoundaryProblem(503,"REVIEWER_BINDING_INVALID");
  var result=new List<SimPersona>();
  foreach(var id in approvedUserIds){var user=await users.ResolveByUserIdAsync(id);if(user is null||user.UserId!=id)continue;
   QuotingPrincipal p;try{p=QuotingPolicy.Project(user);}catch(IdentityDenied){continue;}
   if(!p.IsSuperAdmin&&!p.Permissions.Contains("technical_review.disposition"))continue;
   result.Add(new(p.UserId.ToString("D"),p.UserName,p.DisplayName,"ACTIVE",p.Roles,p.Permissions,p.IsSuperAdmin,"Verified reviewer",p.Workspaces));
  }return result.ToArray();
 }
}
