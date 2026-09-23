using System.Text.Json;
using System.Text.Json.Nodes;
using System.Reflection;
internal static class HandoffChecks
{
    internal static async Task Run(string repo,string source,string root)
    {
        Directory.CreateDirectory(Path.Combine(root,"data"));Directory.CreateDirectory(Path.Combine(root,"state"));
        foreach(var f in Directory.GetFiles(Path.Combine(source,"state")))File.Copy(f,Path.Combine(root,"state",Path.GetFileName(f)),true);
        foreach(var f in new[]{"rfq-intakes.json","rfq-lanes.json","dle-os-sim.db"})File.Copy(Path.Combine(source,"data",f),Path.Combine(root,"data",f),true);
        var state=new SimStateStore(root);await state.InitializeAsync();var store=new SimRfqIntakeStore(root);var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(state.Current.Metadata!);
        var service=new SimOperationsHandoffService(state,store,ops,true);var admin=new SimPersona("test","test","Test SIM Admin","ACTIVE",[],[],true,"isolated");
        var viewer=new SimPersona("view","view","Viewer","ACTIVE",[],["order_entry.view"],false,"isolated");
        const string id="RFQI-SIM-0043";int count=0;var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
        void Check(bool v,string m){if(!v)throw new Exception(m);count++;Console.WriteLine("PASS "+m);}
        async Task Reject(Func<Task> f,string code){try{await f();throw new Exception("Expected "+code);}catch(SimRfqIntakeProblem e){Check(e.Code==code,code);}}
        var original=(SimRfqIntakeRecord)(await store.ReadAsync(id))!;var accepted=JsonSerializer.Serialize(original.OrderEntry!.Acceptance,json);
        await Reject(()=>new SimOperationsHandoffService(state,store,ops,false).Prepare(id,9,admin),"SIM_IMPORT_DISABLED");
        try{await service.Prepare(id,9,viewer);throw new Exception("Expected permission rejection");}catch(SimOrderEntryPermissionException){Check(true,"dedicated permission required");}
        var bridge=original.OrderEntry.Bridge;
        bridge=await store.UpdateOrderBridge(id,new(Guid.NewGuid().ToString(),bridge.Revision,"IDENTIFIERS",Identifiers:new("SIM-VPRO5","0099999","010","0999999",id+":1"),Reason:"Isolated VPRO-shaped correction"),admin);
        await Reject(()=>service.Prepare(id,bridge.Revision,admin),"SIM_IMPORT_BRIDGE");
        bridge=await store.UpdateOrderBridge(id,new(Guid.NewGuid().ToString(),bridge.Revision,"READY"),admin);
        await Reject(()=>service.Prepare(id,bridge.Revision-1,admin),"SIM_IMPORT_STALE");
        var before=File.ReadAllBytes(ops.DatabasePath);var intakeBefore=File.ReadAllText(Path.Combine(root,"data","rfq-intakes.json"));
        var dry=JsonSerializer.SerializeToNode(await service.Prepare(id,bridge.Revision,admin),json)!;
        Check(dry["validation"]!["status"]!.ToString()=="PASS","dry run passes");
        Check(before.SequenceEqual(File.ReadAllBytes(ops.DatabasePath))&&intakeBefore==File.ReadAllText(Path.Combine(root,"data","rfq-intakes.json")),"prepare writes neither canonical nor bridge state");
        var packet=dry["packet"]!.Deserialize<SimOperationsPacket>(json)!;var token=dry["validationToken"]!.ToString();var request=new SimOperationsImportRequest(packet,token);
        Check(packet.OrderLine.EstimatedShipDate is null&&packet.OrderLine.CustomerDueDate=="2026-10-14"&&packet.OrderLine.OrderDate!="2026-09-22","due date separate, ERP opening date explicit");
        await Reject(()=>service.Import(id,request with{ValidationToken="bad"},admin),"SIM_IMPORT_VALIDATION");
        var changed=packet with{Generation=packet.Generation+1};changed=changed with{ContentHash=SimOperationsDataStore.PacketHash(changed)};
        await Reject(()=>service.Import(id,new(changed,token),admin),"SIM_IMPORT_RUNTIME");
        await Reject(()=>service.Import(id,new(packet with{OrderLine=packet.OrderLine with{UnitPrice=1}},token),admin),"SIM_IMPORT_HASH");
        var grant=new SimOperationsValidationGrant(packet.PacketId,packet.ContentHash,admin.Id,id,packet.Source.AcceptedRevision,packet.Source.BridgeRevision,packet.Generation,DateTimeOffset.UtcNow.AddMinutes(-1));
        var expired=(string)typeof(SimOperationsHandoffService).GetMethod("Sign",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(service,[grant])!;
        await Reject(()=>service.Import(id,new(packet,expired),admin),"SIM_IMPORT_VALIDATION");
        bridge=await store.UpdateOrderBridge(id,new(Guid.NewGuid().ToString(),bridge.Revision,"REOPEN",Reason:"Staleness test"),admin);
        bridge=await store.UpdateOrderBridge(id,new(Guid.NewGuid().ToString(),bridge.Revision,"READY"),admin);
        await Reject(()=>service.Import(id,request,admin),"SIM_IMPORT_STALE");
        dry=JsonSerializer.SerializeToNode(await service.Prepare(id,bridge.Revision,admin),json)!;
        request=new(dry["packet"]!.Deserialize<SimOperationsPacket>(json)!,dry["validationToken"]!.ToString());
        service.AfterCommitForTest=()=>throw new IOException("Simulated bridge write failure");
        var pending=JsonSerializer.SerializeToNode(await service.Import(id,request,admin),json)!;
        Check(pending["recognition"]!.ToString()=="Imported — bridge acknowledgment pending","canonical success with acknowledgment failure is recoverable");
        if(pending["errors"] is not null)Console.WriteLine(pending["errors"]!.ToJsonString());
        var receiptId=pending["receipt"]!["receiptId"]!.ToString();
        var restarted=new SimOperationsHandoffService(state,store,ops,true);
        var recovered=JsonSerializer.SerializeToNode(await restarted.Import(id,request,admin),json)!;
        if(recovered["errors"] is not null)Console.WriteLine(recovered["errors"]!.ToJsonString());
        Check(recovered["receipt"]!["receiptId"]!.ToString()==receiptId&&recovered["recognition"]!.ToString()=="Recognized in SIM Operations","restart recovers receipt despite old signing key");
        var after=File.ReadAllText(Path.Combine(root,"data","rfq-intakes.json"));var dbAfter=File.ReadAllBytes(ops.DatabasePath);
        await restarted.Import(id,request,admin);
        Check(after==File.ReadAllText(Path.Combine(root,"data","rfq-intakes.json"))&&dbAfter.SequenceEqual(File.ReadAllBytes(ops.DatabasePath)),"retry byte-preserving across both stores");
        var current=(SimRfqIntakeRecord)(await store.ReadAsync(id))!;
        Check(JsonSerializer.Serialize(current.OrderEntry!.Acceptance,json)==accepted,"accepted revision snapshot unchanged");
        Check(current.OrderEntry.Bridge.State.Status=="READY_FOR_OPERATIONS_SYNC"&&current.OrderEntry.OperationsRecognition is not null,"recognition does not release bridge");
        Check(current.OrderEntry.Bridge.History.Last().Action=="SIM_OPERATIONS_RECOGNIZED","recognition audited once");
        Console.WriteLine($"PASS {count} handoff orchestration checks");
    }
}
