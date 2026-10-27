using DleOs.TrustedIdentity;
using Microsoft.AspNetCore.Http;

namespace DleOs.Quoting.Identity;

// Bind to the existing Windows-authenticated development-compatibility HttpClient.
// Explicit configured loopback destination; never derives a target from browser input.
public sealed class QuotingBffProxy(BffQuotingIdentity identities,IIdentityAssertionIssuer issuer,HttpClient downstream,Uri baseUri,PendingQuotingAuthorizations pending)
{
 public async Task Forward(HttpContext context){
  if(baseUri.Scheme!="http"||!baseUri.IsLoopback||baseUri.AbsolutePath!="/"||!string.IsNullOrEmpty(baseUri.Query)||!string.IsNullOrEmpty(baseUri.UserInfo))throw new IdentityDenied(503,"QUOTING_DESTINATION_INVALID");
  if(new[]{5041,5042,5043,5051,5052,5053,5054,5056,5057}.Contains(baseUri.Port))throw new IdentityDenied(503,"PROTECTED_SERVICE_DESTINATION");
  if(!context.Request.Path.StartsWithSegments("/api/quoting/v1")||context.Request.Method is not ("GET" or "HEAD" or "POST" or "PUT" or "DELETE"))throw new IdentityDenied(404,"QUOTING_ROUTE_NOT_ALLOWED");
  var user=await identities.Resolve(context);
  var correlation=Guid.NewGuid().ToString("D");
  using var request=new HttpRequestMessage(new HttpMethod(context.Request.Method),new Uri(baseUri,context.Request.Path+context.Request.QueryString));
  var assertion=BffQuotingIdentity.Issue(user,issuer,correlation);
  var requestHash=await FreshAuthorization.RequestHash(context);
  using var lease=pending.Add(assertion,user,requestHash,context.RequestAborted,BffSessionRecheck.For(context));
  request.Headers.Add(TrustedIdentityContract.HeaderName,assertion);
  request.Headers.Add("X-DLE-OS-Correlation-ID",correlation);
  // No browser cookies, Authorization, fixture headers or asserted permissions forwarded.
  if(context.Request.Method is not ("GET" or "HEAD")){
   using var body=new MemoryStream();var buffer=new byte[8192];int count;
   while((count=await context.Request.Body.ReadAsync(buffer,context.RequestAborted))>0){if(body.Length+count>6*1024*1024)throw new IdentityDenied(413,"QUOTING_BODY_LIMIT");await body.WriteAsync(buffer.AsMemory(0,count),context.RequestAborted);}
   request.Content=new ByteArrayContent(body.ToArray());
   if(context.Request.ContentType is {} type)request.Content.Headers.TryAddWithoutValidation("Content-Type",type);
  }
  using var response=await downstream.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,context.RequestAborted);
  context.Response.StatusCode=(int)response.StatusCode;context.Response.Headers.CacheControl="no-store";
  if(response.Content.Headers.ContentType is {} contentType)context.Response.ContentType=contentType.ToString();
  if(response.Content.Headers.ContentDisposition is {} disposition)context.Response.Headers.ContentDisposition=disposition.ToString();
  await response.Content.CopyToAsync(context.Response.Body,context.RequestAborted);
 }
}
