using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;

var root = Path.GetFullPath(args[0]); Directory.CreateDirectory(root);
var stateRoot = Path.Combine(root, ".sim-state");
var store = new SimCustomerReferences(stateRoot);
var checks = new List<string>();
void Check(bool ok, string message) { if (!ok) throw new Exception(message); checks.Add(message); }
void Reject(Action action, string message) {
    try { action(); } catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { checks.Add(message); return; }
    throw new Exception("Expected rejection: " + message);
}
string Package(string id, params object[] rows) {
    var folder = Path.Combine(root, "packages", id); Directory.CreateDirectory(Path.Combine(folder,"schema"));
    File.WriteAllText(Path.Combine(folder,"sim-customer-reference.json"), JsonSerializer.Serialize(rows));
    File.WriteAllText(Path.Combine(folder,"schema","sim-customer-reference.schema.json"), "{}");
    File.WriteAllText(Path.Combine(folder,"manifest.json"), JsonSerializer.Serialize(new {
        schemaVersion="DLE_SIM_CUSTOMER_REFERENCE_PACKAGE_V1", status="PASS_OPTIMISTIC_VERSION_BRACKETED",
        packageId=id, customerCount=rows.Length, captureCompletedAtUtc="2026-01-01T12:00:00Z",
        freshness=new { customerMaster=new {snapshotAsOfUtc="2026-01-01T10:00:00Z"},
            operations=new {snapshotAsOfUtc="2026-01-01T10:00:00Z"},
            invoiceHistory=new {activatedAtUtc="2026-01-01T09:00:00Z"}}
    }));
    Ledger(folder); return folder;
}
void Ledger(string folder) {
    var files = Directory.GetFiles(folder,"*",SearchOption.AllDirectories).Where(p=>Path.GetFileName(p)!="hashes.json")
        .Select(p=>new {path=Path.GetRelativePath(folder,p).Replace('\\','/'),bytes=new FileInfo(p).Length,
            sha256=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p)))}).ToArray();
    File.WriteAllText(Path.Combine(folder,"hashes.json"),JsonSerializer.Serialize(files));
}
object Row(string number, string name="Fixture Shared Name") => new {
    referenceId="dle-customer:"+number, customerNumber=number,displayName=name,
    aliases=new[]{"Fixture alias"}, sourceLabels=new[]{"Customer Master"}
};
var first = Package("fixture-one", Row("000123"),Row("000124"));
Check(store.Read().Customers.Length==0 && store.CurrentVersion()=="none","fresh store does not create/import references");
var preview=store.Preview(first);
Check(preview.Added==2 && preview.NameCollisionGroups==2,"name and alias collisions preserved");
Check(store.CurrentVersion()=="none","preview is read-only");
var v1=store.Import(first,"none");
Check(store.Read().Customers.Length==2 && store.Read().Customers[0].CustomerNumber=="000123","leading zeros and count");
Check(store.Import(first,v1)==v1,"second import no-op");
Check(Directory.GetFiles(Path.Combine(stateRoot,"reference","customer-directory","versions")).Length==1,"no duplicate versions");
var second=Package("fixture-two",Row("000123","Updated fixture"));
var p2=store.Preview(second);
Check(p2.Updated==1 && p2.Retained==1,"refresh updates explicit references without deleting missing ones");
Reject(()=>store.Import(second,"none"),"stale expected version rejected");
var v2=store.Import(second,v1);
Check(store.Read(v1).Customers[0].DisplayName=="Fixture Shared Name","old version recoverable");
Check(store.Read().Customers.Length==2,"missing reference retained");
store.Activate(v1,v2); Check(store.Read().LatestPackageId=="fixture-one","rollback");
store.Activate("none",v1);Check(store.Read().Customers.Length==0,"rollback to fixtures only");
store.Activate(v2,"none");
var bad=Package("fixture-bad",Row("000125"));
File.AppendAllText(Path.Combine(bad,"sim-customer-reference.json")," ");
Reject(()=>store.Import(bad,v2),"tampered package rejected");
Check(store.CurrentVersion()==v2,"failed package leaves active pointer");
Reject(()=>store.Preview(Package("fixture-conflict",Row("990100"))),"Abbott collision rejected");
Reject(()=>store.Preview(Package("fixture-conflict2",Row("990901"))),"E2E collision rejected");
Reject(()=>store.Preview(Package("fixture-duplicate",Row("000127"),Row("000127"))),"duplicate keys rejected");
Reject(()=>store.Preview(Package("fixture-one",Row("000128"))),"same package ID different bytes rejected");
var extra=Package("fixture-extra",new {referenceId="dle-customer:000129",customerNumber="000129",
    displayName="Fixture",aliases=Array.Empty<string>(),sourceLabels=new[]{"Customer Master"},password="not-allowed"});
Reject(()=>store.Preview(extra),"unexpected fields rejected");
var partial=Package("fixture-partial",Row("000130"));
File.Delete(Path.Combine(partial,"manifest.json"));
Reject(()=>store.Import(partial,v2),"partial package rejected");
Reject(()=>store.Activate(new string('A',64),v2),"missing rollback target rejected");
Check(store.CurrentVersion()==v2,"failed rollback preserves pointer");
// Force activation failure after version write. A complete orphan snapshot is safe; no current data is lost.
var third=Package("fixture-three",Row("000131"));
using(var held = new FileStream(Path.Combine(stateRoot,"reference","customer-directory","current.json"),FileMode.Open,FileAccess.Read,FileShare.Read))
    Reject(()=>store.Import(third,v2),"pointer replacement failure is fail-closed");
Check(store.CurrentVersion()==v2,"partial commit retains previous current version");
Directory.Move(Path.Combine(root,"packages"),Path.Combine(root,"packages-offline"));
Check(new SimCustomerReferences(stateRoot).Read().Customers.Length==2,"offline reload has no package/network dependency");
var state=new SimStateStore(stateRoot);await state.InitializeAsync();
var reset=await state.ResetAsync(new("RESET SIM",Guid.NewGuid().ToString()),new SimPersonaSessionStore(),new DefaultHttpContext());
Check(reset.Result is not null && store.CurrentVersion()==v2,"scenario reset preserves references");
Console.WriteLine(JsonSerializer.Serialize(new {passed=checks.Count,checks,version=v2},new JsonSerializerOptions{WriteIndented=true}));

