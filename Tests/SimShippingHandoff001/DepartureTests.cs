using System.Text.Json;
using Microsoft.Data.Sqlite;

internal static class DepartureTests
{
    internal static async Task Run(string repo,string root){
        const string wo="0999999";var checks=0;
        void Check(bool ok,string name){if(!ok)throw new Exception(name);checks++;Console.WriteLine("PASS departure: "+name);}
        async Task Reject(Func<Task> action,string code){try{await action();}catch(SimOrderEntryPermissionException){Check(code=="permission",code);return;}catch(KittingCaseProblem e){Check(e.Code==code,code+" / "+e.Code);return;}throw new Exception("Expected "+code);}
        var state=new SimStateStore(root);await state.InitializeAsync();
        var operations=new SimOperationsDataStore(repo,root);await operations.InitializeAsync(state.Current.Metadata!);
        var intakes=new SimRfqIntakeStore(root);var provider=new SimKittingRequirementsProvider(intakes,operations);
        SimProductionService Service()=>new(state,operations,intakes,provider,new(root));
        var service=Service();var actor=SimPersonaCatalog.Get("shipping-operator")!;
        async Task<string> NonShippingState(){
            await using var c=new SqliteConnection($"Data Source={Path.Combine(root,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False");await c.OpenAsync();
            var names=new List<string>();await using(var q=c.CreateCommand()){q.CommandText="SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('SimShippingHandoffEvent','sqlite_sequence') ORDER BY name";await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync())names.Add(r.GetString(0));}
            var rows=new List<string>();foreach(var name in names){await using var q=c.CreateCommand();q.CommandText=$"SELECT * FROM [{name}] ORDER BY rowid";await using var r=await q.ExecuteReaderAsync();while(await r.ReadAsync()){var values=new object[r.FieldCount];r.GetValues(values);rows.Add(name+JsonSerializer.Serialize(values));}}
            return SimProductionService.Hash(rows);
        }
        var nonShippingBefore=await NonShippingState();
        var before=await service.ReadShipping(wo,actor);var a=before.Authorizations.Single();
        Check(a.State=="RELEASED"&&a.Quantity==10&&a.Departure is null,"original full authorization fixture");
        Check(before.CanConfirmSimDeparture,"existing stage permission eligible");
        var request=new SimShippingConfirm(Guid.NewGuid(),before.Token,a.Version);
        foreach(var persona in new[]{"read-only-viewer","operations-manager","disabled","no-access"})
            await Reject(()=>service.ConfirmSimDeparture(wo,a.Id,request,SimPersonaCatalog.Get(persona)!),"permission");
        foreach(var environment in new[]{"LIVE","DEV"}){
            // Change only an isolated in-memory runtime descriptor; never create a non-SIM service.
            var field=typeof(SimStateStore).GetField("snapshot",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
            var original=state.Current;field.SetValue(state,original with{Metadata=original.Metadata! with{Environment=environment}});
            try{await service.ConfirmSimDeparture(wo,a.Id,request,actor);throw new Exception("Non-SIM allowed");}
            catch(InvalidOperationException){Check(true,environment+" runtime rejected");}
            finally{field.SetValue(state,original);}
        }
        await Reject(()=>service.ConfirmSimDeparture(wo,a.Id,request with{ExpectedToken="stale"},actor),"shipping_stale");
        await Reject(()=>service.ConfirmSimDeparture(wo,a.Id,request with{ExpectedVersion=99},actor),"shipping_version");
        await Reject(()=>service.ConfirmSimDeparture(wo,Guid.NewGuid(),request,actor),"shipping_version");
        await File.WriteAllTextAsync(Path.Combine(repo,"tmp/shipping-departure/active-fixture.json"),JsonSerializer.Serialize(before,SimProductionService.Json));
        var firstTime=DateTimeOffset.UtcNow;
        var attempts=await Task.WhenAll(Service().ConfirmSimDeparture(wo,a.Id,request,actor),Service().ConfirmSimDeparture(wo,a.Id,request,actor));
        var after=await service.ReadShipping(wo,actor);var shipped=after.Authorizations.Single();
        Check(attempts.All(x=>x.History.Length==before.History.Length+1),"concurrent identical requests append once");
        Check(shipped.Id==a.Id&&shipped.ClearanceId==a.ClearanceId&&shipped.Version==a.Version+1&&shipped.State=="SIM_SHIPPED_AWAITING_INVOICE","same identity advances once");
        Check(shipped.Quantity==10&&shipped.Departure?.Quantity==10&&shipped.Departure.SourceMode=="SIMULATED_DEVELOPMENTAL","full quantity and distinct SIM evidence");
        Check(shipped.Departure!.ActorId==actor.Id&&shipped.Departure.Actor==actor.DisplayName&&shipped.Departure.RecordedAt>=firstTime&&shipped.Departure.RecordedAt<=DateTimeOffset.UtcNow,"server action time and actual operator");
        Check(shipped.CreatedAt==a.CreatedAt&&shipped.Actor==a.Actor&&shipped.RequestedShipWindow==a.RequestedShipWindow,"original release and requested date unchanged");
        Check(shipped.Context.GetRawText()==a.Context.GetRawText()&&after.ProductionExecution=="NOT_STARTED"&&SimProductionService.Hash(after.Traveler)==SimProductionService.Hash(before.Traveler)&&SimProductionService.Hash(after.Clearances)==SimProductionService.Hash(before.Clearances),"requirements, conflict, documents, production and clearance unchanged");
        Check(after.AvailableToRelease==0&&!after.CanConfirmSimDeparture,"no duplicate release or repeat departure available");
        Check(after.History.Last().Action=="SIM_DEPARTURE_RECORDED"&&after.History.Last().ActorId==actor.Id,"explicit audit action");
        Check((await Service().ConfirmSimDeparture(wo,a.Id,request,actor)).History.Length==after.History.Length,"retry after response loss is idempotent");
        await Reject(()=>service.ConfirmSimDeparture(wo,a.Id,request with{ExpectedVersion=2},actor),"shipping_idempotency_conflict");
        await Reject(()=>service.ConfirmSimDeparture(wo,a.Id,new(Guid.NewGuid(),after.Token,shipped.Version),actor),"shipping_version");
        await Reject(()=>service.DispositionShipping(wo,a.Id,false,new(Guid.NewGuid(),after.Token,shipped.Version,"REVOKED","No undo"),SimPersonaCatalog.Default),"shipping_version");
        var restarted=Service();Check(SimProductionService.Hash(await restarted.ReadShipping(wo,actor))==SimProductionService.Hash(after),"service reopen preserves departure");
        restarted.UtcNow=()=>DateTimeOffset.UtcNow.AddDays(5);
        Check(SimProductionService.Hash(await restarted.ReadShipping(wo,actor))==SimProductionService.Hash(after),"subsequent day read does not change departure timestamp or identity");
        Check(await NonShippingState()==nonShippingBefore,"all non-Shipping tables unchanged by departure");
        Check(JsonSerializer.Serialize(await restarted.ShippingQueue(actor)).Contains("SIM_SHIPPED_AWAITING_INVOICE"),"durable queue contains same departed job");
        await File.WriteAllTextAsync(Path.Combine(repo,"tmp/shipping-departure/shipped-fixture.json"),JsonSerializer.Serialize(after,SimProductionService.Json));
        Console.WriteLine($"PASS {checks} isolated SIM departure checks");
    }
}
