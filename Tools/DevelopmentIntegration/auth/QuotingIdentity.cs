using System.Collections.Concurrent;
using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Http;

namespace DleOs.Quoting.Identity;

public sealed class IdentityDenied(int status,string code):Exception(code){public int Status=>status;public string Code=>Message;}
public sealed record QuotingPrincipal(Guid UserId,string UserName,string DisplayName,string[] Roles,string[] Permissions,string[] Workspaces,bool IsSuperAdmin);
public interface IQuotingIdentity {Task<QuotingPrincipal> Resolve(HttpContext context);}
public static class QuotingPolicy
{
 public const string Audience="dle-os-development-quoting-api";
 public const string CookieScheme="DLE-OS-OIDC-SESSION";
 public static object Session(QuotingPrincipal p)=>new {user=new{id=p.UserId,userName=p.UserName,displayName=p.DisplayName},roles=p.Roles,permissions=p.Permissions,allowedWorkspaces=p.Workspaces,isSuperAdmin=p.IsSuperAdmin,fixtureOnly=false};
 public static QuotingPrincipal Project(ResolvedSecurityUser? user){
  if(user is null||!user.IsActive||user.UserId==Guid.Empty)throw new IdentityDenied(403,"ACTIVE_USER_REQUIRED");
  var roles=user.Roles.Select(r=>r.RoleCode).Distinct(StringComparer.Ordinal).Order().ToArray();
  var selected=CandidateRoles.All.Where(r=>roles.Contains(r.Code,StringComparer.Ordinal)).ToArray();
  if(!user.IsSuperAdmin&&selected.Length==0)throw new IdentityDenied(403,"QUOTING_ROLE_REQUIRED");
  var expected=selected.SelectMany(r=>r.Permissions).Distinct(StringComparer.Ordinal).ToArray();
  if(!user.IsSuperAdmin&&expected.Any(p=>!user.ExplicitPermissions.Contains(p)))throw new IdentityDenied(403,"ROLE_CATALOG_STALE");
  var permissions=user.IsSuperAdmin?CandidateRoles.All.SelectMany(r=>r.Permissions).Concat(new[]{"technical_review.view","technical_review.disposition"}).Distinct().ToArray():expected;
  var workspaces=user.IsSuperAdmin?new[]{"dle-home","rfq-quoting","rfqs","assembly-library","technical-review"}:selected.SelectMany(r=>r.Workspaces).Distinct().ToArray();
  return new(user.UserId,user.UserName,user.DisplayName,roles,permissions,workspaces,user.IsSuperAdmin);
 }
}

// Attach to the existing BFF AFTER its existing authentication middleware.
// Uses its session handler/ticket store; does not register a new login mechanism.
public sealed class BffQuotingIdentity(ICurrentUserContext users,IAntiforgery csrf,TimeProvider clock):IQuotingIdentity
{
 public async Task<QuotingPrincipal> Resolve(HttpContext c){
  c.RequestAborted.ThrowIfCancellationRequested();
  var ticket=await c.AuthenticateAsync(QuotingPolicy.CookieScheme);
  if(!ticket.Succeeded||ticket.Principal?.Identity?.IsAuthenticated!=true||ticket.Properties?.ExpiresUtc is not {} expiry||expiry<=clock.GetUtcNow())throw new IdentityDenied(401,"SESSION_REQUIRED");
  if(c.User.FindFirst("sub")?.Value!=ticket.Principal.FindFirst("sub")?.Value||string.IsNullOrWhiteSpace(ticket.Principal.FindFirst("sub")?.Value))throw new IdentityDenied(401,"SESSION_IDENTITY_MISMATCH");
  if(!HttpMethods.IsGet(c.Request.Method)&&!HttpMethods.IsHead(c.Request.Method)){
   try{await csrf.ValidateRequestAsync(c);}catch(AntiforgeryValidationException){throw new IdentityDenied(403,"ANTIFORGERY_REQUIRED");}
  }
  var current=await users.ResolveAsync(c.RequestAborted);
  if(current.Status!=CurrentUserStatus.Active)throw new IdentityDenied(current.Status==CurrentUserStatus.SecurityUnavailable?503:403,"CURRENT_USER_UNAVAILABLE");
  return QuotingPolicy.Project(current.User);
 }
 public static string Issue(QuotingPrincipal p,IIdentityAssertionIssuer issuer,string correlation)=>issuer.Issue(new(p.UserId,p.UserName,p.DisplayName,p.Roles,p.IsSuperAdmin,QuotingPolicy.Audience,TrustedIdentityContract.DevelopmentEnvironment,correlation));
}

public sealed class QuotingReplayStore
{
 readonly ConcurrentDictionary<Guid,DateTimeOffset> used=new();
 public bool Consume(Guid id,DateTimeOffset expiry,DateTimeOffset now){foreach(var x in used.Where(x=>x.Value<=now))used.TryRemove(x.Key,out _);return used.TryAdd(id,expiry);}
}
// Explicit constructor dependencies mean an unbound installation cannot fall back to fixtures.
public sealed class BackendQuotingIdentity(IIdentityAssertionValidator validator,IUserAuthorizationResolver users,QuotingReplayStore replay,TimeProvider clock,string trustedServiceIdentity):IQuotingIdentity
{
 public async Task<QuotingPrincipal> Resolve(HttpContext c){
  c.RequestAborted.ThrowIfCancellationRequested();
  if(string.IsNullOrWhiteSpace(trustedServiceIdentity))throw new IdentityDenied(503,"TRUST_BINDING_REQUIRED");
  if(c.User.Identity?.IsAuthenticated!=true||!string.Equals(c.User.Identity.Name,trustedServiceIdentity,StringComparison.OrdinalIgnoreCase))throw new IdentityDenied(403,"CALLER_NOT_TRUSTED");
  var result=validator.Validate(c.Request.Headers[TrustedIdentityContract.HeaderName],QuotingPolicy.Audience,TrustedIdentityContract.DevelopmentEnvironment,clock.GetUtcNow());
  if(!result.IsValid||result.User is null)throw new IdentityDenied(result.Code.EndsWith("EXPIRED")?401:403,result.Code);
  var asserted=result.User;
  if(c.Request.Headers["X-DLE-OS-Correlation-ID"].ToString()!=asserted.CorrelationId)throw new IdentityDenied(403,"CORRELATION_MISMATCH");
  var current=await users.ResolveByUserIdAsync(asserted.UserId,c.RequestAborted);
  var principal=QuotingPolicy.Project(current);
  if(principal.IsSuperAdmin!=asserted.IsSuperAdmin||!principal.Roles.SequenceEqual(asserted.Roles.Distinct(StringComparer.Ordinal).Order()))throw new IdentityDenied(403,"ASSERTED_ROLES_STALE");
  if(!HttpMethods.IsGet(c.Request.Method)&&!HttpMethods.IsHead(c.Request.Method)&&!replay.Consume(asserted.AssertionId,asserted.ExpiresAt,clock.GetUtcNow()))throw new IdentityDenied(409,"ASSERTION_REPLAYED");
  return principal;
 }
}
