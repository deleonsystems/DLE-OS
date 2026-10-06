using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

internal static class MaterialScenarios
{
    internal static async Task Run(string repo,string source,Action<bool,string> check)
    {
        foreach(var mode in new[]{"partial","multiple","shared"}) {
            var root=Path.Combine(repo,"tmp","governed-rekit",mode+"-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
            foreach(var folder in new[]{"data","state"})foreach(var file in Directory.EnumerateFiles(Path.Combine(source,folder),"*",SearchOption.AllDirectories)) {
                if(file.EndsWith(".db")||file.EndsWith("-wal")||file.EndsWith("-shm"))continue;
                var target=Path.Combine(root,Path.GetRelativePath(source,file));Directory.CreateDirectory(Path.GetDirectoryName(target)!);File.Copy(file,target);
            }
            var db=Path.Combine(root,"data/dle-os-sim.db");var json=SimPurchasingService.Json;var actor=SimPersonaCatalog.Default;
            await using(var original=new SqliteConnection($"Data Source={Path.Combine(source,"data/dle-os-sim.db")};Mode=ReadOnly;Pooling=False"))
            await using(var copy=new SqliteConnection($"Data Source={db};Pooling=False")){await original.OpenAsync();await copy.OpenAsync();original.BackupDatabase(copy);}
            // Fixture construction only: all modifications below target a fresh isolated database copy.
            await using var connection=new SqliteConnection($"Data Source={db};Pooling=False");await connection.OpenAsync();
            async Task Execute(string sql,params (string,object)[] values){await using var cmd=connection.CreateCommand();cmd.CommandText=sql;foreach(var (k,v) in values)cmd.Parameters.AddWithValue(k,v);await cmd.ExecuteNonQueryAsync();}
            async Task<T> First<T>(string table){await using var cmd=connection.CreateCommand();cmd.CommandText=$"SELECT PayloadJson FROM {table} LIMIT 1";return JsonSerializer.Deserialize<T>((string)(await cmd.ExecuteScalarAsync())!,json)!;}
            foreach(var table in new[]{"SimKittingSubmission","SimAcceptedMaterial","SimPurchaseLine"})
                await Execute($"DROP TRIGGER IF EXISTS {table}NoUpdate;");
            var originalCase=await First<SimKittingCaseRecord>("SimKittingCase");
            // There is only one generic SIM case in this scenario; constrain explicitly if fixtures grow.
            if(originalCase.WorkOrderNumber!="0999999")throw new Exception("Unexpected fixture case");
            var sub=await First<SimKittingSubmission>("SimKittingSubmission");var snap=JsonNode.Parse(sub.SnapshotJson)!;
            var draft=snap["draft"]!.DeepClone();var frozen=JsonNode.Parse(originalCase.FrozenDraft.GetRawText())!;
            if(mode=="partial") {
                foreach(var d in new[]{draft,frozen}) {var row=d["groups"]!.AsArray().Single(g=>g!["groupId"]!.ToString()=="G005")!;row["requiredQuantity"]=22;}
                var partialRow=draft["groups"]!.AsArray().Single(g=>g!["groupId"]!.ToString()=="G005")!;partialRow["entry"]!["shortageQuantity"]=10;
            }
            snap["draft"]=draft.DeepClone();sub=sub with{SnapshotJson=snap.ToJsonString()};
            var current=originalCase with{Draft=JsonSerializer.SerializeToElement(draft,json),FrozenDraft=JsonSerializer.SerializeToElement(frozen,json),EditingSessionId=null,EditingExpiresAtUtc=null,
                EditingOwner=null,EditingActorId=null,CompletedCount=12,TotalShortage=mode=="partial"?10:8,ShortRequirementCount=1};
            await Execute("UPDATE SimKittingCase SET PayloadJson=@json WHERE CaseId=@id",("@json",JsonSerializer.Serialize(current,json)),("@id",current.CaseId.ToString()));
            await Execute("UPDATE SimKittingSubmission SET PayloadJson=@json WHERE SubmissionId=@id",("@json",JsonSerializer.Serialize(sub,json)),("@id",sub.SubmissionId.ToString()));
            await Execute("DROP TABLE SimPurchasingDemand;");
            SimKittingCaseRecord? secondCase=null;
            if(mode=="shared") {
                var otherDraft=draft.DeepClone();otherDraft["workOrder"]="0888888";otherDraft["header"]!["workOrder"]="0888888";
                var otherFrozen=frozen.DeepClone();otherFrozen["workOrder"]="0888888";otherFrozen["header"]!["workOrder"]="0888888";
                secondCase=current with{CaseId=Guid.NewGuid(),WorkOrderNumber="0888888",Draft=JsonSerializer.SerializeToElement(otherDraft,json),FrozenDraft=JsonSerializer.SerializeToElement(otherFrozen,json)};
                var otherSnap=snap.DeepClone();otherSnap["caseId"]=secondCase.CaseId.ToString();otherSnap["workOrderNumber"]="0888888";otherSnap["draft"]=otherDraft;
                var otherSub=sub with{SubmissionId=Guid.NewGuid(),CaseId=secondCase.CaseId,SnapshotJson=otherSnap.ToJsonString()};
                await Execute("INSERT INTO SimKittingCase VALUES(@id,@wo,@rel,@gen,@json)",("@id",secondCase.CaseId.ToString()),("@wo",secondCase.WorkOrderNumber),("@rel",secondCase.ReleasedBomIdentity),("@gen",secondCase.Generation),("@json",JsonSerializer.Serialize(secondCase,json)));
                await Execute("INSERT INTO SimKittingSubmission VALUES(@id,@case,'KIT_SHORT',1,@json,@pdf,@hash)",("@id",otherSub.SubmissionId.ToString()),("@case",secondCase.CaseId.ToString()),("@json",JsonSerializer.Serialize(otherSub,json)),("@pdf",Array.Empty<byte>()),("@hash","fixture"));
            }
            var state=new SimStateStore(root);await state.InitializeAsync();var store=new SimOperationsDataStore(repo,root);await store.InitializeAsync(state.Current.Metadata!);
            var intakes=new SimRfqIntakeStore(root);var kitting=new SimKittingCases(state,store,new(intakes,store)){UtcNow=()=>new(2026,9,26,12,0,0,TimeSpan.Zero)};
            var purchasing=new SimPurchasingService(state,store);var receiving=new SimReceivingService(state,store,new(root));
            var demands=(await purchasing.Read(actor)).Demands.Where(d=>d.CaseId==current.CaseId||d.CaseId==secondCase?.CaseId).ToArray();
            await Execute("CREATE TABLE SimPurchasingDemand(Id TEXT PRIMARY KEY,PayloadJson TEXT NOT NULL)");
            foreach(var d in demands)await Execute("INSERT INTO SimPurchasingDemand VALUES(@id,@json)",("@id",d.DemandId),("@json",JsonSerializer.Serialize(d with{Version=1,State="ACCEPTED"},json)));
            var demand=demands.Single(d=>d.CaseId==current.CaseId);var material=await First<SimAcceptedMaterial>("SimAcceptedMaterial");var purchase=await First<SimPurchaseLine>("SimPurchaseLine");
            var firstQty=mode=="partial"?4m:3m;
            SimAcceptedMaterial WithQty(SimAcceptedMaterial m,decimal qty)=>m with{ReceivedQuantity=qty,AcceptedQuantity=qty,PackingSlipQuantity=qty,
                Coverage=[m.Coverage[0] with{Quantity=qty,ReceivedQuantity=qty}],AvailableQuantity=0};
            var first=mode=="shared"?material with{Coverage=[material.Coverage[0] with{Quantity=3,ReceivedQuantity=3},material.Coverage[0] with{DemandId=demands.Single(d=>d.CaseId==secondCase!.CaseId).DemandId,WorkOrderNumber="0888888",Quantity=5,ReceivedQuantity=5}]}:WithQty(material,firstQty);
            await Execute("UPDATE SimAcceptedMaterial SET PayloadJson=@json WHERE Id=@id",("@json",JsonSerializer.Serialize(first,json)),("@id",first.ReceiptLineId));
            if(mode=="multiple") {
                var second=WithQty(material,5) with{ReceiptLineId="SIM-AM-0000002"};var stage=await First<SimReceivingStage>("SimReceivingStage");var secondStage=stage with{StageId=Guid.NewGuid(),ReceiptLineId=second.ReceiptLineId};
                await Execute("INSERT INTO SimAcceptedMaterial VALUES(@id,@json)",("@id",second.ReceiptLineId),("@json",JsonSerializer.Serialize(second,json)));
                await Execute("INSERT INTO SimReceivingStage VALUES(@id,@json)",("@id",secondStage.StageId.ToString()),("@json",JsonSerializer.Serialize(secondStage,json)));
            }
            if(mode=="shared") {
                var other=demands.Single(d=>d.CaseId==secondCase!.CaseId);
                purchase=purchase with{Coverage=[purchase.Coverage[0] with{Quantity=3},purchase.Coverage[0] with{DemandId=other.DemandId,WorkOrderNumber=other.WorkOrderNumber,Quantity=5,SourceFingerprint=other.SourceFingerprint}]};
                await Execute("UPDATE SimPurchaseLine SET PayloadJson=@json",("@json",JsonSerializer.Serialize(purchase,json)));
            }
            await kitting.Resume(current.WorkOrderNumber,new(current.WorkingVersion),actor);
            current=(await store.ReadSimKittingCase(current.WorkOrderNumber,state.Current.Metadata!))!;
            SimKittingMaterialRequest Request(SimKittingCaseRecord c,SimPurchasingDemand d,string receipt,decimal qty,long version)=>
                new(c.WorkingVersion,c.EditingSessionId,Guid.NewGuid(),c.CaseId,d.SubmissionId,d.SourceRowId,"G005",d.DemandId,receipt,version,qty,"EA");
            if(mode=="shared") {
                try{await kitting.ApplyMaterial(current.WorkOrderNumber,Request(current,demand,first.ReceiptLineId,8,2),actor);throw new Exception("shared overdraw accepted");}
                catch(KittingCaseProblem e){check(e.Code=="application_quantity_invalid","shared receipt blocks8 against destination3");}
            }
            await kitting.ApplyMaterial(current.WorkOrderNumber,Request(current,demand,first.ReceiptLineId,firstQty,2),actor);
            current=(await store.ReadSimKittingCase(current.WorkOrderNumber,state.Current.Metadata!))!;
            check(current.TotalShortage==(mode=="partial"?6:5)&&current.State=="KIT_SHORT",mode+" partial application retains governing short state");
            if(mode=="multiple") {
                await kitting.ApplyMaterial(current.WorkOrderNumber,Request(current,demand,"SIM-AM-0000002",5,2),actor);current=(await store.ReadSimKittingCase(current.WorkOrderNumber,state.Current.Metadata!))!;
                check(current.TotalShortage==0&&current.Draft.GetProperty("groups")[4].GetProperty("entry").GetProperty("allocations").GetArrayLength()==3,"two receipts3+5 retain both identities and total20");
            }
            if(mode=="shared") {
                var other=demands.Single(d=>d.CaseId==secondCase!.CaseId);await kitting.Resume(other.WorkOrderNumber,new(secondCase!.WorkingVersion),actor);secondCase=(await store.ReadSimKittingCase(other.WorkOrderNumber,state.Current.Metadata!))!;
                try{await kitting.ApplyMaterial(other.WorkOrderNumber,Request(secondCase,other,first.ReceiptLineId,5,2),actor);throw new Exception("stale shared receipt accepted");}
                catch(KittingCaseProblem e){check(e.Code=="material_version_changed","other WO cannot use stale shared receipt balance");}
                await kitting.ApplyMaterial(other.WorkOrderNumber,Request(secondCase,other,first.ReceiptLineId,5,3),actor);
                check((await receiving.Material(first.ReceiptLineId,actor)).AvailableQuantity==0,"two destinations consume assigned3+5 exactly once");
            }
            if(mode=="partial") {
                await kitting.Submit(current.WorkOrderNumber,new(current.WorkingVersion,current.EditingSessionId,current.Draft),actor);
                var after=(await purchasing.Read(actor)).Demands.Where(d=>d.CaseId==current.CaseId).ToArray();
                check(after.Length==1&&after[0].DemandId==demand.DemandId&&after[0].RemainingShortQuantity==6&&after[0].SourceCurrent,"partial successor keeps original demand and coverage with remaining6");
            }
            check((await receiving.Material(first.ReceiptLineId,actor)).AcceptedQuantity==(mode=="shared"?8:firstQty),mode+" accepted history preserved");
        }
    }
}
