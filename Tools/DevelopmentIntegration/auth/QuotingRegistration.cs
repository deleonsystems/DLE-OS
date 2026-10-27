using DleOs.Security;
using DleOs.TrustedIdentity;
using Microsoft.Extensions.DependencyInjection;

namespace DleOs.Quoting.Identity;
public static class QuotingRegistration
{
 public static IServiceCollection AddQuotingBffAdapters(this IServiceCollection services,Uri destination){
  // Existing ICurrentUserContext, IAntiforgery, cookie handler and signing issuer are required.
  // No handler, ticket store, key file or credential is created here.
  services.AddSingleton(TimeProvider.System);
  services.AddScoped<BffQuotingIdentity>();
  services.AddHttpClient("quoting-compatibility").ConfigurePrimaryHttpMessageHandler(()=>new HttpClientHandler{UseDefaultCredentials=true,UseCookies=false,AllowAutoRedirect=false});
  services.AddScoped(sp=>new QuotingBffProxy(sp.GetRequiredService<BffQuotingIdentity>(),sp.GetRequiredService<IIdentityAssertionIssuer>(),sp.GetRequiredService<IHttpClientFactory>().CreateClient("quoting-compatibility"),destination));
  return services;
 }
 public static IServiceCollection AddQuotingBackendAdapters(this IServiceCollection services,string trustedServiceIdentity){
  ArgumentException.ThrowIfNullOrWhiteSpace(trustedServiceIdentity);
  // Existing authenticated service transport, public-key validator and user resolver required.
  services.AddSingleton(TimeProvider.System);services.AddSingleton<QuotingReplayStore>();
  services.AddScoped<IQuotingIdentity>(sp=>new BackendQuotingIdentity(sp.GetRequiredService<IIdentityAssertionValidator>(),sp.GetRequiredService<IUserAuthorizationResolver>(),sp.GetRequiredService<QuotingReplayStore>(),sp.GetRequiredService<TimeProvider>(),trustedServiceIdentity));
  return services;
 }
}
