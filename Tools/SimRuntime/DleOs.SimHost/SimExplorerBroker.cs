using System.Security.Cryptography;
internal sealed class SimExplorerBroker(TimeProvider? time=null)
{
 private readonly TimeProvider clock=time??TimeProvider.System;
 private readonly Dictionary<string,Entry> entries=new();private readonly object gate=new();
 private sealed record Entry(string Relative,string Correlation,DateTimeOffset Expires,Func<Task<bool>> Current);
 internal ExplorerRequest Issue(string origin,bool permitted,string root,string relative,Func<Task<bool>> current){
 if(origin!=SimExplorerProtocol.Origin || !permitted || root!=SimExplorerProtocol.RootId || !SimExplorerProtocol.SafePath(relative))throw new UnauthorizedAccessException("Desktop folder request is not permitted.");
 lock(gate){foreach(var key in entries.Where(x=>x.Value.Expires<=clock.GetUtcNow()).Select(x=>x.Key).ToArray())entries.Remove(key);if(entries.Count>=128)throw new IOException("Desktop request limit reached.");
 var token="simcap1_"+Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_');var correlation=Guid.NewGuid().ToString("N");entries.Add(token,new(relative,correlation,clock.GetUtcNow().AddSeconds(60),current));return new(1,SimExplorerProtocol.Operation,token,correlation);}}
 internal async Task<ExplorerReply> Redeem(string json){if(!SimExplorerProtocol.TryRequest(json,out var request))return new(false,"InvalidRequest");Entry? entry;
 lock(gate){if(!entries.Remove(request!.Capability,out entry))return new(false,"UnknownOrReplayedCapability");}
 if(entry.Expires<=clock.GetUtcNow())return new(false,"ExpiredCapability");if(entry.Correlation!=request!.CorrelationId)return new(false,"BindingMismatch");
 try{if(!await entry.Current())return new(false,"LinkOrPermissionChanged");}catch{return new(false,"FolderUnavailable");}
 if(entry.Expires<=clock.GetUtcNow())return new(false,"ExpiredCapability");
 return new(true,"Redeemed",SimExplorerProtocol.RootId,entry.Relative,entry.Correlation);}
}
