using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
internal static class SimExplorerProtocol
{
 internal const string Origin="https://sim-miguel.dle-os.internal.dlemfg.com:5177";
 internal const string RootId="drawing-prints";
 internal const string Root=@"\\DELEON-SERVER\PRODUCTION\Drawing-Prints";
 internal const string Pipe="DLEOS.SIM.MichaelDesk.Explorer.v1";
 internal const string Operation="open-drawing-folder";
 internal static bool SafePath(string? value)=>value is not null && value.Length is >0 and <=1000 && !value.Contains('\\') && !value.Any(char.IsControl) && value.Split('/').Length<=32 && value.Split('/').All(s=>s.Length>0 && s is not "." and not ".." && !s.EndsWith('.') && !s.EndsWith(' ') && s.IndexOfAny([':', '*', '?', '"', '<', '>', '|'])<0 && !Regex.IsMatch(s,@"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)",RegexOptions.IgnoreCase));
 internal static bool TryRequest(string json,out ExplorerRequest? request){request=null;try{
  using var d=JsonDocument.Parse(json,new JsonDocumentOptions{MaxDepth=4});var o=d.RootElement;
  if(o.ValueKind!=JsonValueKind.Object)return false;var props=o.EnumerateObject().ToArray();
  if(props.Length!=4 || !props.Select(x=>x.Name).ToHashSet().SetEquals(["version","operation","capability","correlationId"]))return false;
  request=JsonSerializer.Deserialize<ExplorerRequest>(json,new JsonSerializerOptions(JsonSerializerDefaults.Web));
  return request is not null && request.Version==1 && request.Operation==Operation && Regex.IsMatch(request.Capability??"",@"^simcap1_[A-Za-z0-9_-]{43}$") && request.CorrelationId is {Length:>0 and <=128} && !request.CorrelationId.Any(char.IsControl);
 }catch(Exception e)when(e is JsonException or InvalidOperationException){return false;}}
 internal static async Task<string> Read(Stream stream,CancellationToken ct){var b=new byte[4];await stream.ReadExactlyAsync(b,ct);int n=System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(b);if(n is <=0 or >4096)throw new IOException("Invalid frame");b=new byte[n];await stream.ReadExactlyAsync(b,ct);return new UTF8Encoding(false,true).GetString(b);}
 internal static async Task Write(Stream stream,object value,CancellationToken ct){var b=JsonSerializer.SerializeToUtf8Bytes(value,new JsonSerializerOptions(JsonSerializerDefaults.Web));if(b.Length>4096)throw new IOException("Invalid frame");var header=new byte[4];System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(header,b.Length);await stream.WriteAsync(header,ct);await stream.WriteAsync(b,ct);await stream.FlushAsync(ct);}
}
internal sealed record ExplorerRequest(int Version,string Operation,string Capability,string CorrelationId);
internal sealed record ExplorerReply(bool Success,string Category,string? RootId=null,string? RelativePath=null,string? CorrelationId=null);
