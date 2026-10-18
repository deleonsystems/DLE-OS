using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

internal static class BuyerChecks
{
    internal static async Task Run(string root,string repo,SimCustomerSupplyLine supply)
    {
        if(!Path.GetFullPath(root).Replace('\\','/').Contains("/cs-review/fixture")) throw new Exception("Fixture-only test requires cs-review/fixture path");
        var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
        await using(var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(root,"data","dle-os-sim.db"),Pooling=false}.ToString())) {
            await c.OpenAsync();
            async Task Exec(string sql,string? value=null,string? key=null){await using var q=c.CreateCommand();q.CommandText=sql;if(value is not null)q.Parameters.AddWithValue("@value",value);if(key is not null)q.Parameters.AddWithValue("@key",key);await q.ExecuteNonQueryAsync();}
            var triggers=new List<string>();
            await using(var tq=c.CreateCommand()){tq.CommandText="SELECT name FROM sqlite_master WHERE type='trigger'";await using var tr=await tq.ExecuteReaderAsync();while(await tr.ReadAsync())triggers.Add(tr.GetString(0));}
            foreach(var name in triggers)await Exec("DROP TRIGGER \""+name.Replace("\"","\"\"")+"\"");
            // Disposable fixture only: return one known synthetic case to its original shortage,
            // then attach the C/S projection to that same immutable source-row identity.
            await using var q=c.CreateCommand();q.CommandText="SELECT PayloadJson FROM SimKittingSubmission";
            var rows=new List<JsonObject>();await using(var reader=await q.ExecuteReaderAsync())while(await reader.ReadAsync())rows.Add(JsonNode.Parse(reader.GetString(0))!.AsObject());
            var sub=rows.First(x=>x["submissionType"]!.ToString()=="KIT_SHORT");
            var snap=JsonNode.Parse(sub["snapshotJson"]!.ToString())!.AsObject();var draft=snap["draft"]!.AsObject();
            var group=draft["groups"]!.AsArray().First(x=>(decimal?)x!["entry"]?["shortageQuantity"]>0)!.AsObject();
            var linked=supply with{SourceRowId=group["sourceRowId"]!.ToString(),FindNumber=group["sequence"]!.ToString(),RequiredQuantity=(decimal)group["requiredQuantity"]!};
            group["customerSupply"]=JsonSerializer.SerializeToNode(linked,json);
            sub["snapshotJson"]=snap.ToJsonString();
            var caseId=sub["caseId"]!.ToString();
            await Exec("DELETE FROM SimKittingSubmission WHERE CaseId=@key AND SubmissionType<>'KIT_SHORT'",key:caseId);
            await Exec("UPDATE SimKittingSubmission SET PayloadJson=@value WHERE SubmissionId=@key",sub.ToJsonString(),sub["submissionId"]!.ToString());
            q.CommandText="SELECT PayloadJson FROM SimKittingCase WHERE CaseId=@key";q.Parameters.Clear();q.Parameters.AddWithValue("@key",caseId);
            var item=JsonNode.Parse((string)(await q.ExecuteScalarAsync())!)!.AsObject();
            item["state"]="KIT_SHORT";item["draft"]=draft.DeepClone();item["editingSessionId"]=null;item["editingExpiresAtUtc"]=null;
            await Exec("UPDATE SimKittingCase SET PayloadJson=@value WHERE CaseId=@key",item.ToJsonString(),caseId);
            foreach(var table in new[]{"SimPurchasingDemand","SimBuyingPlan","SimPurchaseLine","SimPurchasingCommand","SimPurchasingEvent","SimKittingDemandReconciliation","SimAcceptedMaterial","SimReceivingDelivery","SimReceivingStage","SimKittingMaterialEvent"})await Exec("DELETE FROM "+table);
        }
        var state=new SimStateStore(root);await state.InitializeAsync();
        var ops=new SimOperationsDataStore(repo,root);await ops.InitializeAsync(state.Current.Metadata!);
        var service=new SimPurchasingService(state,ops);var actor=SimPersonaCatalog.Default;
        var d=(await service.Read(actor)).Demands.Single(x=>x.CustomerSupply is not null);
        if(d.CustomerSupply?.CustomerPartNumber!="E8X001" || d.ShortQuantity!=8 || d.KittedQuantity!=12)throw new Exception("C/S buyer projection did not preserve actual shortage");
        Console.WriteLine("PASS buyer projection retains C/S and actual required20/kitted12/short8 fixture quantities");
        try {await service.Accept(d.DemandId,new(d.Version,Guid.NewGuid()),actor);throw new Exception("C/S entered purchasing");}
        catch(SimPurchasingProblem e) when(e.Code=="customer_supply_followup"){Console.WriteLine("PASS C/S purchase-ownership action blocked");}
        var planning=await new SimMaterialPlanning(state,ops,new SimRfqIntakeStore(root),new SimKittingRequirementsProvider(new SimRfqIntakeStore(root),ops)).Read(actor);
        var planned=planning.WorkOrders.SelectMany(w=>w.Demands).Single(x=>x.DemandId==d.DemandId);
        if(planned.CustomerSupply is null || planned.Available!=0 || !planned.Progress.Contains("Customer follow-up"))throw new Exception("Incorrect C/S supply progress: "+JsonSerializer.Serialize(planned,json));
        Console.WriteLine("PASS material planning requests customer follow-up without inventing availability or kit completion");
        File.WriteAllText(Path.Combine(root,"buyer-projection.json"),JsonSerializer.Serialize(await service.Read(actor),json));
    }
}
