using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

internal static class CommercialContextChecks
{
    internal static async Task Run(string repo,string source)
    {
        var root=Path.Combine(repo,"tmp","commercial-context-test-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root,"data"));Directory.CreateDirectory(Path.Combine(root,"state"));
        foreach(var file in Directory.GetFiles(Path.Combine(source,"state")))File.Copy(file,Path.Combine(root,"state",Path.GetFileName(file)));
        foreach(var name in new[]{"rfq-intakes.json","rfq-lanes.json","dle-os-sim.db"})File.Copy(Path.Combine(source,"data",name),Path.Combine(root,"data",name));
        var state=new SimStateStore(root);await state.InitializeAsync();var runtime=state.Current.Metadata!;
        var intakes=new SimRfqIntakeStore(root);var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(runtime);
        var service=new SimOperationsHandoffService(state,intakes,ops,true);
        var json=SimOperationsDataStore.PacketJson;var count=0;
        void Check(bool success,string label){if(!success)throw new Exception(label);count++;Console.WriteLine("PASS "+label);}
        string Hash(string name)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(root,"data",name))));
        var baseline=new[]{"rfq-intakes.json","rfq-lanes.json","dle-os-sim.db"}.ToDictionary(x=>x,Hash);
        var record=(SimRfqIntakeRecord)(await intakes.ReadAsync("RFQI-SIM-0043"))!;
        var receipt=(await ops.GetBridgeReceiptAsync(record.OrderEntry!.Bridge.Id))!;
        Check(receipt.Packet.SchemaVersion==1&&receipt.Packet.OrderLine.CustomerPoDate is null,"existing receipt remains schema1 without PO Date");
        Check(SimOperationsDataStore.PacketHash(receipt.Packet)==receipt.ContentHash,"legacy packet hash remains valid after optional field addition");
        Check(!JsonSerializer.Serialize(receipt.Packet,json).Contains("customerPoDate"),"legacy packet serialization omits new null field");
        Check((await ops.ReadPacketRecognitionAsync(receipt,runtime)).Verified,"legacy canonical readback remains valid");
        var raw=(await ops.ReadRecordAsync("SalesOrderLine","SalesOrderLineId",receipt.SalesOrderLineId))!;
        Check(!JsonSerializer.SerializeToElement(raw,json).TryGetProperty("customerPoDate",out _),"stored canonical legacy row is untouched");
        var projected=JsonSerializer.SerializeToElement(await service.ProjectSalesOrderCommercialContext(raw,runtime),json);
        Check(projected.GetProperty("customerPoDate").GetString()=="2026-09-22"&&projected.GetProperty("customerPoDateSource").GetProperty("owner").GetString()=="INTAKE","legacy PO Date comes from validated Intake-owned accepted snapshot");
        Check(projected.GetProperty("orderDate").GetString()=="2026-09-23"&&projected.GetProperty("customerDueDate").GetString()=="2026-10-14"&&projected.GetProperty("estimatedShipDate").GetString()=="","legacy read context keeps ERP order, customer due and unknown estimated ship dates distinct");
        var page=await ops.ReadSalesOrderLinesAsync(new QueryCollection(new Dictionary<string,StringValues>{{"salesOrderNumber",receipt.SalesOrderNumber}}),runtime.Generation);
        var projectedPage=await service.ProjectSalesOrderCommercialContext(page,runtime);
        Check(JsonSerializer.SerializeToElement(projectedPage.Items[0],json).GetProperty("customerPoDate").GetString()=="2026-09-22","list and single-record projection agree");
        var wrong=JsonSerializer.SerializeToNode(raw,json)!;wrong["importProvenance"]!["contentHash"]="wrong";
        Check(!JsonSerializer.SerializeToElement(await service.ProjectSalesOrderCommercialContext(wrong,runtime),json).TryGetProperty("customerPoDate",out _),"unmatched receipt hash does not borrow commercial context");
        wrong=JsonSerializer.SerializeToNode(raw,json)!;wrong["salesOrderNumber"]="0099998";
        Check(!JsonSerializer.SerializeToElement(await service.ProjectSalesOrderCommercialContext(wrong,runtime),json).TryGetProperty("customerPoDate",out _),"unmatched canonical identity does not borrow commercial context");
        Check(!JsonSerializer.SerializeToElement(await service.ProjectSalesOrderCommercialContext(raw,runtime with{Generation=runtime.Generation+1}),json).TryGetProperty("customerPoDate",out _),"stale generation does not borrow commercial context");
        var baseRow=(await ops.ReadRecordAsync("SalesOrderLine","SalesOrderLineId","SIM-SOL-0001"))!;
        Check(JsonSerializer.Serialize(baseRow,json)==JsonSerializer.Serialize(await service.ProjectSalesOrderCommercialContext(baseRow,runtime),json),"unrelated fixture rows unchanged by optional commercial context");
        var actor=new SimPersona("test","test","Test Reviewer","ACTIVE",[],[],true,"isolated");
        var retry=JsonSerializer.SerializeToElement(await service.Import(record.IntakeId,new(receipt.Packet,"old signing token"),actor),json);
        Check(retry.GetProperty("recognition").GetString()=="Recognized in SIM Operations"&&retry.GetProperty("receipt").GetProperty("receiptId").GetString()==receipt.ReceiptId,"legacy source rebuild and durable receipt retry remain compatible");
        var future=(SimOperationsPacket)typeof(SimOperationsHandoffService).GetMethod("BuildPacket",BindingFlags.Static|BindingFlags.NonPublic)!
            .Invoke(null,[record,runtime,actor,Guid.NewGuid().ToString(),DateTimeOffset.UtcNow,2])!;
        Check(future.SchemaVersion==2&&future.OrderLine.CustomerPoDate==record.OrderEntry.Acceptance.Package.Facts.PoDate,"future packet builder maps accepted header PO Date into schema2");
        Check(future.OrderLine.OrderDate=="2026-09-23"&&future.WorkOrder.OpenedDate=="2026-09-23"&&future.OrderLine.CustomerDueDate=="2026-10-14"&&future.OrderLine.EstimatedShipDate is null,"future builder keeps all four date semantics independent");
        Check(baseline.All(x=>Hash(x.Key)==x.Value),"legacy projection and duplicate retry preserve intake/quote/database bytes");
        Console.WriteLine($"{count} commercial-context checks passed. Isolated state: {root}");
    }
}
