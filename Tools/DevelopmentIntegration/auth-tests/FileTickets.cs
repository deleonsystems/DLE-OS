using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging.Abstractions;
using System.Security.Claims;

// Test assembly only. The deployed implementation encrypts synthetic tickets with
// ephemeral, process-local keys; these cannot authenticate to a real application.
internal sealed class FileTickets : ITicketStore
{
 readonly ServerSideOidcTicketStore inner;
 readonly HashSet<string> keys = [];
 internal string Root { get; } = Path.GetFullPath(Path.Combine(TestPaths.Root,
  "disposable/ticket-store-" + Guid.NewGuid().ToString("N")));
 internal FileTickets() { inner = NewStore(new EphemeralDataProtectionProvider()); }
 ServerSideOidcTicketStore NewStore(IDataProtectionProvider protection) =>
  new(Root, protection, NullLogger<ServerSideOidcTicketStore>.Instance);
 public async Task<string> StoreAsync(AuthenticationTicket ticket) { var key=await inner.StoreAsync(ticket); keys.Add(key); return key; }
 public Task RenewAsync(string key,AuthenticationTicket ticket)=>inner.RenewAsync(key,ticket);
 public Task<AuthenticationTicket?> RetrieveAsync(string key)=>inner.RetrieveAsync(key);
 public async Task RemoveAsync(string key){await inner.RemoveAsync(key);keys.Remove(key);}
 internal int Count => Directory.EnumerateFiles(Root,"*.ticket").Count();
 internal void Clear(){foreach(var key in keys.ToArray())RemoveAsync(key).GetAwaiter().GetResult();}
 internal void ExpireAll(){foreach(var key in keys.ToArray()){var t=RetrieveAsync(key).GetAwaiter().GetResult();if(t!=null){t.Properties.ExpiresUtc=DateTimeOffset.UtcNow.AddMinutes(-1);RenewAsync(key,t).GetAwaiter().GetResult();}}}
 internal static async Task Qualify(Action<bool,string> check){
  var store=new FileTickets();
  AuthenticationTicket Ticket(string subject)=>new(new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub",subject)],"synthetic-only")),new AuthenticationProperties{ExpiresUtc=DateTimeOffset.UtcNow.AddMinutes(2)},"synthetic-only");
  try{
   var key=await store.StoreAsync(Ticket("synthetic-A"));var path=Path.Combine(store.Root,key+".ticket");
   check(File.Exists(path)&&!(await File.ReadAllTextAsync(path)).Contains("synthetic-A"),"deployed ticket store encrypts synthetic ticket on disk");
   check((await store.RetrieveAsync(key))?.Principal.FindFirst("sub")?.Value=="synthetic-A","deployed file ticket round trip");
   await store.RenewAsync(key,Ticket("synthetic-B"));check((await store.RetrieveAsync(key))?.Principal.FindFirst("sub")?.Value=="synthetic-B","deployed file ticket renewal");
   check(!Directory.EnumerateFiles(store.Root,"*.tmp").Any(),"atomic ticket writes leave no temporary files");
   await store.RemoveAsync(key);check(await store.RetrieveAsync(key)==null&&!File.Exists(path),"deployed ticket deletion and replay rejection");
   key=await store.StoreAsync(Ticket("expired"));store.ExpireAll();check(await store.RetrieveAsync(key)==null&&!File.Exists(Path.Combine(store.Root,key+".ticket")),"expired file ticket removed");
   key=await store.StoreAsync(Ticket("wrong-key"));check(await store.NewStore(new EphemeralDataProtectionProvider()).RetrieveAsync(key)==null,"different ephemeral key cannot decrypt ticket");
   key=await store.StoreAsync(Ticket("corrupt"));await File.WriteAllTextAsync(Path.Combine(store.Root,key+".ticket"),"corrupt synthetic fixture");check(await store.RetrieveAsync(key)==null,"corrupt file ticket fails closed");
   try{await store.RetrieveAsync("../outside");check(false,"invalid ticket key rejected");}catch(ArgumentException){check(true,"invalid ticket key rejected");}
  }finally{store.Clear();check(store.Count==0&&!Directory.EnumerateFiles(store.Root,"*.tmp").Any(),"owned synthetic file tickets cleaned");}
 }
}
