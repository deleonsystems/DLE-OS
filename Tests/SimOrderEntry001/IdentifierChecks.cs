using System.Text.Json;
internal static class IdentifierChecks
{
    internal static async Task Run(string source,string root)
    {
        Directory.CreateDirectory(Path.Combine(root,"data"));
        File.Copy(Path.Combine(source,"data","rfq-intakes.json"),Path.Combine(root,"data","rfq-intakes.json"),true);
        var store=new SimRfqIntakeStore(root);
        var actor=new SimPersona("test","test","Identifier Test","ACTIVE",[],[],true,"test");
        var record=(SimRfqIntakeRecord)(await store.ReadAsync("RFQI-SIM-0043"))!;
        var bridge=record.OrderEntry!.Bridge;var legacy=bridge.State.Identifiers!;
        var snapshot=JsonSerializer.Serialize(record.OrderEntry.Acceptance);
        int count=0;
        void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS "+name);count++;}
        async Task Update(SimBridgeIdentifiers ids,string? reason="Isolated identifier correction"){
            bridge=await store.UpdateOrderBridge(record.IntakeId,new(Guid.NewGuid().ToString(),bridge.Revision,"IDENTIFIERS",Identifiers:ids,Reason:reason),actor);
        }
        async Task Reject(SimBridgeIdentifiers ids,string code,string? reason="Isolated check"){
            var before=File.ReadAllText(Path.Combine(root,"data","rfq-intakes.json"));
            try{await Update(ids,reason);throw new Exception("Expected rejection");}catch(SimRfqIntakeProblem e){Check(e.Code==code&&before==File.ReadAllText(Path.Combine(root,"data","rfq-intakes.json")),code+" leaves state unchanged");}
        }
        await Update(legacy);Check(bridge.State.Identifiers==legacy,"existing legacy SIM identifiers may be retained");
        var numeric=legacy with{SalesOrder="0099999",SalesOrderLine="010",WorkOrder="0999999"};
        await Reject(numeric,"BRIDGE_REASON",null);
        await Reject(numeric with{Namespace="PRODUCTION"},"BRIDGE_SYNTHETIC_IDS");
        foreach(var bad in new[]{"UNKNOWN","SIM-NEW","12345678","12 34","-123","1.23","１２３"})await Reject(numeric with{WorkOrder=bad},"BRIDGE_SYNTHETIC_IDS");
        await Reject(numeric with{SalesOrderLine="1000"},"BRIDGE_SYNTHETIC_IDS");
        await Update(numeric);
        Check(bridge.State.Identifiers==numeric,"numeric identifiers and all leading zeros retained as strings");
        Check(bridge.State.Status=="IN_PROGRESS","audited correction invalidates readiness");
        Check(bridge.History.Last().Before!.Identifiers==legacy&&bridge.History.Last().After.Identifiers==numeric,"correction records exact before and after");
        var latest=(SimRfqIntakeRecord)(await store.ReadAsync(record.IntakeId))!;
        Check(JsonSerializer.Serialize(latest.OrderEntry!.Acceptance)==snapshot,"accepted package remains unchanged");
        var shortIds=numeric with{SalesOrder="123",SalesOrderLine="1",WorkOrder="456"};
        await Update(shortIds);Check(bridge.State.Identifiers==shortIds,"short numeric input is retained without implicit zero padding");
        Console.WriteLine($"PASS {count} isolated identifier checks");
    }
}
