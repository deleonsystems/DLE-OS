using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal sealed record SimBridgeOperationsRecognition(string ReceiptId,string PacketId,string PacketHash,
    long Generation,string SalesOrderLineId,string WorkOrderNumber,string Relationship,string ActorId,string Actor,DateTimeOffset At);
internal sealed record SimOperationsPrepareRequest(int ExpectedBridgeRevision);
internal sealed record SimOperationsImportRequest(SimOperationsPacket Packet,string ValidationToken);
internal sealed record SimOperationsValidationGrant(string PacketId,string Hash,string ActorId,string IntakeId,
    int AcceptedRevision,int BridgeRevision,long Generation,DateTimeOffset ExpiresAt);

internal sealed partial class SimRfqIntakeStore
{
    internal async Task<T> WithOperationsOrder<T>(string id,Func<SimRfqIntakeRecord,Task<(T Result,SimOrderEntry? Updated)>> action)
    {
        await gate.WaitAsync();
        try {
            var dataset=await ReadDatasetAsync();var r=RequireEntryRecord(dataset.Records,id);
            if(r.OrderEntry is null)throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_ACCEPTANCE","An accepted New Order is required.");
            var result=await action(r);
            if(result.Updated is not null){dataset.Records[dataset.Records.IndexOf(r)]=r with{OrderEntry=result.Updated};dataset.UpdatedAtUtc=DateTimeOffset.UtcNow;await WriteVerifiedAsync(dataset);}
            return result.Result;
        }finally{gate.Release();}
    }
}

internal sealed class SimOperationsHandoffService(SimStateStore state,SimRfqIntakeStore intakes,SimOperationsDataStore operations,bool enabled)
{
    private readonly byte[] tokenKey=RandomNumberGenerator.GetBytes(32);
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    internal bool Enabled=>enabled;
    internal Func<Task>? AfterCommitForTest { get; set; }
    private void Guard(SimPersona actor,SimStateMetadata runtime)
    {
        if(!enabled)throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_DISABLED","Developmental SIM Operations import is disabled.");
        if(!actor.Can("order_entry.sim_import"))throw new SimOrderEntryPermissionException();
        if(runtime.Environment!="SIM")throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_ENVIRONMENT","Only the SIM runtime is supported.");
    }
    private static void Ready(SimOrderEntry entry)
    {
        if(entry.Bridge.State.Status!="READY_FOR_OPERATIONS_SYNC" || entry.Bridge.State.HoldReason is not null ||
            SimRfqIntakeStore.BridgeChecklist.Except(entry.Bridge.State.Completed).Any() || entry.Bridge.State.Identifiers is not {Namespace:"SIM-VPRO5"})
            throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_BRIDGE","Complete the bridge readiness guards with SIM-VPRO5 identifiers first.");
    }
    internal async Task<object> Read(string id,SimPersona actor)=>await state.WithStableRuntime(async runtime=>
        await intakes.WithOperationsOrder<object>(id,async r=>{
            var receipt=await operations.GetBridgeReceiptAsync(r.OrderEntry!.Bridge.Id);
            var recognition=r.OrderEntry.OperationsRecognition;
            var readback=receipt is null?null:await operations.ReadPacketRecognitionAsync(receipt,runtime);
            var recognized=receipt is not null && recognition?.ReceiptId==receipt.ReceiptId && readback?.Verified==true && recognition.Generation==runtime.Generation &&
                r.OrderEntry.Bridge.State.Identifiers?.SalesOrder==receipt.SalesOrderNumber && r.OrderEntry.Bridge.State.Identifiers?.WorkOrder==receipt.WorkOrderNumber && r.OrderEntry.Bridge.State.Identifiers?.SalesOrderLine==receipt.SalesOrderLineNumber;
            return (new {enabled,scopeSupported=TrialScope(r) is not null,scopeMessage=TrialScope(r) is null?"This accepted package is outside the explicitly qualified SIM trials.":null,canImport=enabled&&actor.Can("order_entry.sim_import")&&TrialScope(r) is not null,recognition=recognized?"Recognized in SIM Operations":receipt is null?"Awaiting":"Imported — bridge acknowledgment pending",receipt,readback},null);
        }));
    internal async Task<object> Prepare(string id,int expectedRevision,SimPersona actor)=>await state.WithStableRuntime(async runtime=>{
        Guard(actor,runtime);
        return await intakes.WithOperationsOrder<object>(id,async r=>{
            Ready(r.OrderEntry!);
            if(r.OrderEntry!.Bridge.Revision!=expectedRevision)throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_STALE","Bridge changed. Refresh and prepare again.");
            var existing=await operations.GetBridgeReceiptAsync(r.OrderEntry.Bridge.Id);
            var packet=existing?.Packet??BuildPacket(r,runtime,actor,Guid.NewGuid().ToString(),DateTimeOffset.UtcNow);
            var validation=await operations.ValidatePacketAsync(packet,runtime);
            var expires=DateTimeOffset.UtcNow.AddMinutes(20);
            var token=validation.Status=="PASS"?Sign(new(packet.PacketId,packet.ContentHash,actor.Id,id,packet.Source.AcceptedRevision,packet.Source.BridgeRevision,runtime.Generation,expires)):null;
            return (new{packet,validation,validationToken=token,expiresAt=expires},null);
        });
    });
    internal async Task<object> Import(string id,SimOperationsImportRequest request,SimPersona actor)=>await state.WithStableRuntime(async runtime=>{
        Guard(actor,runtime);
        SimOperationsImportResult? imported=null;
        try {
            return await intakes.WithOperationsOrder<object>(id,async r=>{
                var packet=request.Packet??throw SimRfqIntakeProblem.BadRequest("SIM_IMPORT_PACKET","Packet is required.");
                if(packet.Source.IntakeId!=id||packet.Environment!="SIM"||packet.ErpSource!="SIM-VPRO5"||packet.ImportType!="SIMULATED_DEVELOPMENTAL"||packet.Generation!=runtime.Generation||packet.RuntimeScenario!=runtime.ScenarioId||packet.RuntimeVersion!=runtime.ScenarioVersion)
                    throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_RUNTIME","Packet runtime or source does not match.");
                if(SimOperationsDataStore.PacketHash(packet)!=packet.ContentHash)throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_HASH","Packet content changed. Prepare again.");
                var receipt=await operations.FindReceiptAsync(packet.PacketId);
                if(receipt is null)Verify(request.ValidationToken,packet,actor);
                else if(receipt.ContentHash!=packet.ContentHash)throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_HASH","Packet ID was reused with different content.");
                var entry=r.OrderEntry!;Ready(entry);
                var alreadyAcknowledged=entry.OperationsRecognition?.ReceiptId==receipt?.ReceiptId && receipt is not null;
                if(entry.Bridge.Revision!=packet.Source.BridgeRevision && !alreadyAcknowledged)throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_STALE","Bridge changed after validation; no import or recognition was performed.");
                // Rebuild every authoritative field from the accepted package. A caller
                // cannot change facts even with a forged/self-consistent packet hash.
                var expected=BuildPacket(r,runtime,new(packet.PreparedBy,"",packet.PreparedBy,"ACTIVE",[],[],false,""),packet.PacketId,packet.PreparedAt,packet.SchemaVersion);
                if(alreadyAcknowledged)expected=expected with{Source=expected.Source with{BridgeRevision=packet.Source.BridgeRevision}};
                if(SimOperationsDataStore.PacketHash(expected)!=packet.ContentHash)throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_SOURCE","Packet differs from the current accepted source or bridge.");
                imported=await operations.ImportPacketAsync(packet,runtime,actor.Id,actor.DisplayName);
                if(!imported.Readback.Verified) return (new{receipt=imported.Receipt,recognition="Imported — bridge acknowledgment pending",message="Canonical readback did not pass.",errors=imported.Readback.Errors},null);
                if(alreadyAcknowledged)return (new{receipt=imported.Receipt,recognition="Recognized in SIM Operations",message="Existing import and recognition verified; no duplicate writes."},null);
                if(AfterCommitForTest is not null)await AfterCommitForTest();
                var now=DateTimeOffset.UtcNow;var bridge=entry.Bridge;var revision=bridge.Revision+1;
                var recognized=new SimBridgeOperationsRecognition(imported.Receipt.ReceiptId,packet.PacketId,packet.ContentHash,runtime.Generation,imported.Receipt.SalesOrderLineId,packet.WorkOrder.WorkOrderNumber,imported.Receipt.Relationship,actor.Id,actor.DisplayName,now);
                var updated=entry with{OperationsRecognition=recognized,Bridge=bridge with{Revision=revision,History=bridge.History.Append(new(packet.PacketId,packet.ContentHash,"SIM_OPERATIONS_RECOGNIZED",revision,actor.Id,actor.DisplayName,now,"Canonical SIM readback verified; no Operations release.",bridge.State,bridge.State)).ToArray()}};
                return (new{receipt=imported.Receipt,recognition="Recognized in SIM Operations",message="Canonical SIM readback verified. Bridge status remains Ready for Operations Sync."},updated);
            });
        }catch(Exception e) when(imported is not null && e is IOException or UnauthorizedAccessException){
            return new{receipt=imported.Receipt,recognition="Imported — bridge acknowledgment pending",message="Canonical import committed. Retry the same packet to recover bridge acknowledgment."};
        }
    });
    private string Sign(SimOperationsValidationGrant grant)
    {
        var payload=Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(grant,Json));
        return payload+"."+Convert.ToBase64String(HMACSHA256.HashData(tokenKey,Encoding.UTF8.GetBytes(payload)));
    }
    private void Verify(string? token,SimOperationsPacket packet,SimPersona actor)
    {
        try {
            var pieces=(token??"").Split('.');if(pieces.Length!=2)throw new FormatException();
            if(!CryptographicOperations.FixedTimeEquals(Convert.FromBase64String(pieces[1]),HMACSHA256.HashData(tokenKey,Encoding.UTF8.GetBytes(pieces[0]))))throw new FormatException();
            var grant=JsonSerializer.Deserialize<SimOperationsValidationGrant>(Convert.FromBase64String(pieces[0]),Json)!;
            if(grant.PacketId!=packet.PacketId||grant.Hash!=packet.ContentHash||grant.ActorId!=actor.Id||grant.IntakeId!=packet.Source.IntakeId||grant.AcceptedRevision!=packet.Source.AcceptedRevision||grant.BridgeRevision!=packet.Source.BridgeRevision||grant.Generation!=packet.Generation||grant.ExpiresAt<=DateTimeOffset.UtcNow)throw new FormatException();
        }catch(Exception e) when(e is FormatException or JsonException or NullReferenceException){throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_VALIDATION","Validation token is invalid, expired or stale. Prepare again.");}
    }
    // Bounded SIM trials only. The Abbott grant pins the reviewed package token;
    // later revisions require another explicit qualification, not automatic admission.
    internal static string? TrialScope(SimRfqIntakeRecord r)
    {
        var a=r.OrderEntry?.Acceptance;var p=a?.Package;var q=p?.TechnicalSource?.Baseline?.Quote;
        if(a is null || p is null || q is null)return null;
        if(r.IntakeId=="RFQI-SIM-0043" && p.PoNumber=="SIM-E2E-001-PO" && q.IntakeId=="RFQI-SIM-0042" && q.QuoteNumber=="SIM-Q-0042-R01" && a.PackageRevision==7)return "E2E-SIM-001";
        if(r.Environment=="SIM" && r.IntakeId=="RFQI-SIM-0044" && a.PackageRevision==4 && p.Revision==4 &&
            a.SourceToken=="318ECCC6202F1270CAD0BB9FB8469A927EF497D9D38AD2785020E0F4FCE3F68A" && r.Customer.CustomerNumber=="990100" &&
            p.PoNumber=="SIM-PO-0036-20261014-A" && q.IntakeId=="RFQI-SIM-0036" && q.QuoteNumber=="SIM-Q-0036-R02" &&
            p.Facts.Lines.Length==1 && p.Facts.Lines[0] is {Assembly:"B11283-17",Revision:"B",Quantity:25})return "ABBOTT-0044-SIM-TRIAL";
        if(r.Environment=="SIM" && r.IntakeId=="RFQI-SIM-0046" && a.PackageRevision==2 && p.Revision==2 &&
            a.Id=="0a15fbf0-d1f3-4123-b1af-34b1bda2410e" &&
            a.SourceToken=="025540756823921B23180E73AB9F27C55C63B6CC12D46CD5833D75574035FF5C" &&
            r.Customer.CustomerNumber=="990100" && p.PoNumber=="SIM-PO-0045-20261017-C72EE3" &&
            q.IntakeId=="RFQI-SIM-0045" && q.QuoteNumber=="SIM-Q-0045-R01" &&
            p.Facts.Lines.Length==1 && p.Facts.Lines[0] is {Assembly:"B11165-32",Revision:"A",Quantity:25})return "ABBOTT-0046-AWAITING-RELEASE";
        return null;
    }

    private static SimOperationsPacket BuildPacket(SimRfqIntakeRecord r,SimStateMetadata runtime,SimPersona actor,string packetId,DateTimeOffset prepared,int schemaVersion=2)
    {
        var entry=r.OrderEntry!;var accepted=entry.Acceptance;var p=accepted.Package;var ids=entry.Bridge.State.Identifiers!;var line=p.Facts.Lines.Single();var baseline=p.TechnicalSource!.Baseline!;
        var scope=TrialScope(r)??throw SimRfqIntakeProblem.Conflict("SIM_IMPORT_SCOPE","This accepted package is outside the explicitly qualified SIM trials.");
        // Explicit synthetic ERP opening date, based on the accepted order event,
        // independently of customer PO Date and Customer Due Date.
        var openingDate=accepted.At.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture);
        var source=new SimOperationsPacketSource(r.IntakeId,accepted.Id,accepted.PackageRevision,accepted.SourceToken,entry.Bridge.Id,entry.Bridge.Revision,baseline.Quote.IntakeId,baseline.Quote.QuoteNumber,
            baseline.Definition.Materials.Candidate.Id,baseline.SourceToken);
        var order=new SimOperationsPacketLine(r.Customer.CustomerNumber,r.Customer.CustomerName,p.PoNumber,ids.SalesOrder,ids.SalesOrderLine,line.Assembly,line.Revision,"Accepted synthetic assembly "+line.Assembly,
            line.Quantity!.Value,line.Quantity.Value,0,line.Currency,line.UnitPrice!.Value,line.ExtendedValue!.Value,line.CustomerDueDate!,null,openingDate,
            ["SIM opening state: ordered/open quantity equals accepted order quantity; shipped quantity is zero.","SIM ERP order date and WO opened date use the accepted-order calendar date "+openingDate+"; they are not copied from PO Date.","SIM WO type STANDARD, status OPEN, UOM EA; scheduled quantity equals accepted order quantity.","Estimated Ship Date is unset; Customer Due Date remains separate reviewed commercial context."]);
        if(schemaVersion==2)order=order with{CustomerPoDate=p.Facts.PoDate};
        var awaitingRelease=scope=="ABBOTT-0046-AWAITING-RELEASE";
        if(awaitingRelease)order=order with{SimulatedFacts=order.SimulatedFacts.Where(f=>!f.Contains("status OPEN")).Append("SIM VPRO entry only. WO is Awaiting Release; Quality review is not completed. Kitting and production are blocked.").ToArray()};
        var work=new SimOperationsPacketWorkOrder(ids.WorkOrder,r.Customer.CustomerNumber,ids.SalesOrder,ids.SalesOrderLine,line.Assembly,line.Revision,line.Quantity.Value,"STANDARD",awaitingRelease?"AWAITING_RELEASE":"OPEN",openingDate,"EA");
        var evidence=new SimOperationsRelationshipEvidence(packetId+":anchor","SIMULATED_ACCEPTED_BRIDGE_ANCHOR",r.Customer.CustomerNumber,ids.SalesOrder,ids.SalesOrderLine,ids.WorkOrder,line.Assembly,line.Revision,line.Quantity.Value);
        var packet=new SimOperationsPacket(packetId,schemaVersion,"",actor.Id,prepared,"SIM","SIM-VPRO5","SIMULATED_DEVELOPMENTAL",scope,runtime.ScenarioId,runtime.ScenarioVersion,runtime.Generation,source,order,work,[evidence]);
        return packet with{ContentHash=SimOperationsDataStore.PacketHash(packet)};
    }

    // Read-time commercial context belongs to Intake. In particular, old v1 receipt packets and
    // their canonical rows stay immutable; they are never rewritten merely to add a display field.
    internal async Task<SimPageResult> ProjectSalesOrderCommercialContext(SimPageResult page,SimStateMetadata runtime)
    {
        var items=new List<object>();
        foreach(var item in page.Items)items.Add((await ProjectSalesOrderCommercialContext(item,runtime))!);
        return page with{Items=items.ToArray()};
    }
    internal async Task<object?> ProjectSalesOrderCommercialContext(object? item,SimStateMetadata runtime)
    {
        if(item is null)return null;
        var row=JsonSerializer.SerializeToElement(item,Json);
        string? Text(JsonElement value,string key)=>value.TryGetProperty(key,out var field)&&field.ValueKind==JsonValueKind.String?field.GetString():null;
        if(row.ValueKind!=JsonValueKind.Object || Text(row,"customerPoDate") is not null ||
            !row.TryGetProperty("importProvenance",out var provenance) || provenance.ValueKind!=JsonValueKind.Object ||
            Text(provenance,"environment")!="SIM" || Text(provenance,"erpSource")!="SIM-VPRO5" ||
            Text(provenance,"importType")!="SIMULATED_DEVELOPMENTAL" || Text(provenance,"packetId") is not {} packetId)
            return item;
        var receipt=await operations.FindReceiptAsync(packetId);
        if(receipt is null || receipt.Packet.SchemaVersion!=1 || receipt.ContentHash!=SimOperationsDataStore.PacketHash(receipt.Packet) ||
            receipt.ReceiptId!=Text(provenance,"receiptId") || receipt.ContentHash!=Text(provenance,"contentHash") ||
            receipt.Generation!=runtime.Generation || receipt.RuntimeScenario!=runtime.ScenarioId || receipt.RuntimeVersion!=runtime.ScenarioVersion ||
            receipt.SalesOrderLineId!=Text(row,"salesOrderLineId") || receipt.CustomerNumber!=Text(row,"customerNumber") ||
            receipt.SalesOrderNumber!=Text(row,"salesOrderNumber") || receipt.SalesOrderLineNumber!=Text(row,"lineNumber"))return item;
        var source=receipt.Packet.Source;
        var intake=await intakes.ReadAsync(source.IntakeId) as SimRfqIntakeRecord;
        var accepted=intake?.OrderEntry?.Acceptance;
        if(accepted is null || intake!.OrderEntry!.Bridge.Id!=source.BridgeId || accepted.Id!=source.AcceptanceId ||
            accepted.PackageRevision!=source.AcceptedRevision || accepted.SourceToken!=source.AcceptanceToken ||
            intake.Customer.CustomerNumber!=receipt.CustomerNumber || accepted.Package.PoNumber!=Text(row,"customerPurchaseOrderNumber") ||
            accepted.Package.Facts.Lines.Length!=1)return item;
        var line=accepted.Package.Facts.Lines[0];
        if(line.Assembly!=Text(row,"itemNumber") || line.Revision!=Text(row,"bomRevision") ||
            line.Assembly!=receipt.Packet.OrderLine.ItemNumber || line.Revision!=receipt.Packet.OrderLine.Revision ||
            accepted.Package.PoNumber!=receipt.Packet.OrderLine.PurchaseOrder ||
            !DateOnly.TryParseExact(accepted.Package.Facts.PoDate,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out _))return item;
        var result=row.EnumerateObject().ToDictionary(x=>x.Name,x=>(object?)x.Value.Clone(),StringComparer.Ordinal);
        result["customerPoDate"]=accepted.Package.Facts.PoDate;
        result["customerPoDateSource"]=new{owner="INTAKE",kind="ACCEPTED_NEW_ORDER",intakeId=source.IntakeId,
            acceptanceId=source.AcceptanceId,acceptedRevision=source.AcceptedRevision};
        return result;
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    internal static void MapOperationsHandoff(WebApplication app,SimStateStore state,SimPersonaSessionStore personas,SimOperationsHandoffService service)
    {
        async Task<IResult> Guard(HttpContext c,Func<SimPersona,Task<object>> action){
            var denied=Denied(c,state,personas,false);if(denied is not null)return denied;
            var actor=personas.Resolve(c);if(!actor.Can("order_entry.view"))return Results.StatusCode(403);
            c.Response.Headers.CacheControl="private, no-store";
            try{return Results.Json(await action(actor));}
            catch(SimOrderEntryPermissionException){return Results.StatusCode(403);}
            catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(SimOperationsPacketProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:409);}
            catch(Exception e) when(e is IOException or InvalidOperationException or Microsoft.Data.Sqlite.SqliteException){return Results.Json(new{code="SIM_IMPORT_UNAVAILABLE",message="SIM handoff could not finish. Inspect recognition and retry the same packet after recovery."},statusCode:503);}
        }
        app.MapGet("/api/sim/order-entry/{id}/operations-handoff",(string id,HttpContext c)=>Guard(c,a=>service.Read(id,a)));
        app.MapPost("/api/sim/order-entry/{id}/operations-packet",(string id,SimOperationsPrepareRequest request,HttpContext c)=>Guard(c,a=>service.Prepare(id,request.ExpectedBridgeRevision,a)));
        app.MapPost("/api/sim/order-entry/{id}/operations-import",(string id,SimOperationsImportRequest request,HttpContext c)=>Guard(c,a=>service.Import(id,request,a)));
    }
}
