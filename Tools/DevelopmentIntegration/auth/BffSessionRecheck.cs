using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.DependencyInjection;

namespace DleOs.Quoting.Identity;

public static class BffSessionRecheck {
 // A new handler scope/context forces retrieval from the existing ticket store,
 // rather than reusing the original request's cached AuthenticateResult. The
 // browser cookie never leaves this process and is never persisted here.
 public static Func<CancellationToken,Task> For(HttpContext original)=>async token=>{
  token.ThrowIfCancellationRequested();original.RequestAborted.ThrowIfCancellationRequested();
  await using var scope=original.RequestServices.GetRequiredService<IServiceScopeFactory>().CreateAsyncScope();
  var check=new DefaultHttpContext{RequestServices=scope.ServiceProvider,RequestAborted=token};
  check.Request.Scheme=original.Request.Scheme;check.Request.Host=original.Request.Host;
  check.Request.Headers.Cookie=original.Request.Headers.Cookie;
  var result=await check.AuthenticateAsync(QuotingPolicy.CookieScheme);
  var sub=original.User.FindFirst("sub")?.Value;
  if(!result.Succeeded||string.IsNullOrWhiteSpace(sub)||result.Principal?.FindFirst("sub")?.Value!=sub||result.Properties?.ExpiresUtc is not {} expiry||expiry<=scope.ServiceProvider.GetRequiredService<TimeProvider>().GetUtcNow())throw new IdentityDenied(401,"SESSION_REVOKED");
 };
}
