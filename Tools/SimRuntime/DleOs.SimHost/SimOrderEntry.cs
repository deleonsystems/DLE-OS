using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimOrderAcceptance(string Id, int PackageRevision, string SourceToken, string RequestId,
    string RequestHash, string ActorId, string Actor, DateTimeOffset At, string Note, SimNewOrderPackage Package);
internal sealed record SimBridgeIdentifiers(string Namespace, string SalesOrder, string SalesOrderLine, string WorkOrder, string OrderLineKey);
internal sealed record SimBridgeState(string Status, string[] Completed, SimBridgeIdentifiers? Identifiers, string? HoldReason);
internal sealed record SimBridgeEvent(string RequestId, string RequestHash, string Action, int Revision,
    string ActorId, string Actor, DateTimeOffset At, string? Reason, SimBridgeState? Before, SimBridgeState After);
internal sealed record SimOrderBridge(string Id, string AcceptanceId, int Revision, SimBridgeState State, SimBridgeEvent[] History);
internal sealed record SimOrderEntry(SimOrderAcceptance Acceptance, SimOrderBridge Bridge,
    [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimBridgeOperationsRecognition? OperationsRecognition=null);
internal sealed record SimOrderAcceptRequest(string RequestId, int ExpectedRevision, string SourceToken, bool Confirm, string? Note);
internal sealed record SimBridgeRequest(string RequestId, int ExpectedRevision, string Action, string? Item = null,
    bool Complete = true, SimBridgeIdentifiers? Identifiers = null, string? Reason = null);
internal sealed record SimBridgeBomRow(string Line, string ApprovedPartNumber, string Description, decimal QuantityPerAssembly, decimal TotalRequirement, bool Dnp, [property: System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimCustomerSupplyLine? CustomerSupply = null);

internal sealed partial class SimRfqIntakeStore
{
    internal static readonly string[] BridgeChecklist = ["ASSEMBLY_ITEM", "COMPONENT_ITEMS", "BOM", "SALES_ORDER", "WORK_ORDER"];
    private string OrderEntryHash(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value,jsonOptions)));
    private string OrderAcceptanceToken(SimRfqIntakeRecord r) => OrderEntryHash(new {r.IntakeId,r.Customer,r.RequestCorrelationId,r.OrderIntake});
    private static SimRfqIntakeRecord RequireEntryRecord(IEnumerable<SimRfqIntakeRecord> records,string id) =>
        records.SingleOrDefault(r=>r.IntakeId==id && r.Environment=="SIM" && r.IntakeType=="NEW_ORDER" && r.OrderIntake is not null)
        ?? throw SimRfqIntakeProblem.NotFound("ORDER_ENTRY_NOT_FOUND","New Order not found.");

    internal static SimBridgeBomRow[] OrderEntryBom(SimNewOrderPackage package)
    {
        var quantity=package.Facts.Lines.SingleOrDefault()?.Quantity ?? 0;
        return (package.TechnicalSource?.Baseline?.Definition.Materials.Candidate.Rows ?? []).Select(row=> {
            var numbers=SimApprovedPartIdentities.Resolve(row);
            var dnp=row.ComponentType=="DNP";
            var per=decimal.TryParse(row.Values.GetValueOrDefault("quantity"),NumberStyles.Number,CultureInfo.InvariantCulture,out var n)?n:0;
            return new SimBridgeBomRow(row.Values.GetValueOrDefault("lineNumber") ?? (row.Index+1).ToString(),dnp?"Not fitted":string.Join(" / ",numbers.Where(n=>!string.IsNullOrWhiteSpace(n))),row.Values.GetValueOrDefault("description") ?? "",per,dnp?0:per*quantity,dnp,SimCustomerSupply.Lines(package.TechnicalSource?.Baseline,package.Facts,package.PoNumber,package.PoEvidence.Select(e=>e.Document).ToArray()).SingleOrDefault(l=>l.SourceRowId==row.RowId && l.QuotedCustomerSupplied));
        }).ToArray();
    }
    private static string[] OrderAcceptanceBlockers(SimNewOrderPackage p)
    {
        var errors=new List<string>();
        errors.AddRange(SimCustomerSupply.Project(p).Issues);
        if(p.ReviewStatus!="READY_FOR_CONTRACT_REVIEW") errors.Add("Submit the reviewed New Order package for final review first. Drafts cannot enter Order Entry.");
        if(p.Questionnaire?.RequirementsIdentifiedOnAttachedDocument!=true) errors.Add("The final PO acknowledgment is required.");
        if(p.ContractDates?.PoDateVerification is not {} po || po.Date!=p.Facts.PoDate) errors.Add("Verify the current PO Date.");
        if(p.ContractDates?.DueDateReview is not {Disposition:"ACCEPT"} due || due.Date!=p.Facts.Lines.FirstOrDefault()?.CustomerDueDate) errors.Add("Resolve and accept the current Customer Due Date.");
        if(p.PoEvidence.Length==0 || p.PoFactsConfirmed!=true) errors.Add("Verified PO evidence and confirmed order facts are required.");
        if(p.Comparison.Any(c=>c.Result is "DIFFERENCE" or "MISSING")) errors.Add("Resolve the PO/quote differences or missing facts before acceptance.");
        if(p.TechnicalSource is not {Status:"QUOTED_DEFINITION_LINKED",Baseline:not null}) errors.Add("This bridge slice requires the retained verified quoted definition; incoming-document review must be resolved first.");
        if(RfqOnlyDefinition(p.TechnicalSource?.Baseline?.Definition.Manufacturing))
            errors.Add("The engineering reference is accepted for RFQ only. Complete production technical review before order acceptance.");
        var rows=p.TechnicalSource?.Baseline?.Definition.Materials.Candidate.Rows ?? [];
        if(rows.Length==0 || rows.Any(r=>!r.Confirmed || !r.ReviewState.Reviewed) || OrderEntryBom(p).Any(r=>!r.Dnp && string.IsNullOrWhiteSpace(r.ApprovedPartNumber))) errors.Add("A fully accepted BOM with approved identities is required.");
        return errors.ToArray();
    }
    internal async Task<object> ListOrderEntry()
    {
        await gate.WaitAsync();try {
            return new {items=(await ReadDatasetAsync()).Records.Where(r=>r.Environment=="SIM" && r.IntakeType=="NEW_ORDER" && (r.OrderEntry is not null || r.OrderIntake?.ReviewStatus=="READY_FOR_CONTRACT_REVIEW")).Select(r=> {
                var p=r.OrderEntry?.Acceptance.Package ?? r.OrderIntake!;var l=p.Facts.Lines.First();
                return new {r.IntakeId,Customer=r.Customer.CustomerName,p.PoNumber,l.Assembly,l.Revision,l.Quantity,l.CustomerDueDate,
                    Status=r.OrderEntry?.Bridge.State.Status ?? "AWAITING_ACCEPTANCE",User=r.OrderEntry?.Bridge.History.LastOrDefault()?.Actor,Accepted=r.OrderEntry is not null};
            }).ToArray()};
        } finally {gate.Release();}
    }
    private SimContractReviewProjection OrderEntryReview(SimRfqIntakeRecord r)
    {
        var acceptance=r.OrderEntry?.Acceptance; var p=acceptance?.Package ?? r.OrderIntake!;
        var last=p.History.Last();var actor=acceptance?.Actor ?? last.Actor;var at=acceptance?.At ?? last.At;
        var request=new SimOrderSaveRequest("",r.RequestCorrelationId,r.IntakeId,p.Revision,r.Customer,p.PoNumber,p.Facts,p.PreviouslyQuoted,p.Quote?.Reference,p.Questionnaire,
            p.PoEvidence.Select(e=>e.Document).ToArray(),p.WizardStep,false,p.TechnicalSource?.Choice,[],"review",p.PoFactsConfirmed==true,p.FlowVersion,
            p.ContractDates?.PoDateVerification is not null,p.ContractDates?.DueDateReview is {} due?new(due.Disposition,due.Note):null,CustomerSupplyReview:p.CustomerSupplyReview);
        var po=p.PoEvidence.Select(e=>new SimReviewFile(e.Document.Name,"Customer PO",$"/api/sim/new-orders/{r.IntakeId}/documents/{e.Document.DocumentId}")).ToArray();
        var baseline=p.TechnicalSource?.Baseline;
        var docs=(baseline?.Definition.Manufacturing.Package.Documents ?? []).Select(d=>new SimReviewFile(d.Name,
            d.IdentityReview?.Type=="BOM_ONLY"||d.DocumentType=="BOM"?"BOM":"Technical Drawing",$"/api/sim/rfq-intakes/{baseline!.Quote.IntakeId}/documents/{d.DocumentId}")).ToArray();
        var projection=BuildContractReview(request,new(p.Quote,p.Comparison,baseline),po,docs,new("","",actor,"ACTIVE",[],[],false,""),at);
        return projection with {Title=acceptance is null?"NEW ORDER ACCEPTANCE - PENDING":"NEW ORDER ACCEPTED FOR ORDER ENTRY",
            Status=acceptance is null?"Submitted for final review / Pending acceptance":"Accepted for Order Entry / Not released to Operations",
            Notice=acceptance is null?"Review the exact submitted package before explicit acceptance.":"Accepted package evidence. VPRO setup and Operations recognition are separate steps.",
            Reviewer=actor,ReviewedDate=at.LocalDateTime.ToString("MM/dd/yyyy",CultureInfo.InvariantCulture)};
    }
    internal async Task<object> ReadOrderEntry(string id)
    {
        await gate.WaitAsync();try {
            var r=RequireEntryRecord((await ReadDatasetAsync()).Records,id); var p=r.OrderEntry?.Acceptance.Package ?? r.OrderIntake!;
            if(r.OrderEntry is null && p.ReviewStatus!="READY_FOR_CONTRACT_REVIEW") throw SimRfqIntakeProblem.Conflict("ORDER_ENTRY_DRAFT","Drafts are not queued for acceptance or Order Entry.");
            return new {r.IntakeId,r.Customer,PackageRevision=p.Revision,SourceToken=OrderAcceptanceToken(r),
                Review=OrderEntryReview(r),Bom=OrderEntryBom(p),r.OrderEntry,Blockers=r.OrderEntry is null?OrderAcceptanceBlockers(p):[],
                Checklist=BridgeChecklist,OrderLineKey=r.IntakeId+":1",Synthetic=true};
        } finally {gate.Release();}
    }
    internal async Task<SimContractReviewProjection> ReadOrderEntryReport(string id)
    {
        await gate.WaitAsync();try {
            var r=RequireEntryRecord((await ReadDatasetAsync()).Records,id);
            if(r.OrderEntry is null && r.OrderIntake?.ReviewStatus!="READY_FOR_CONTRACT_REVIEW") throw SimRfqIntakeProblem.Conflict("ORDER_ENTRY_DRAFT","Submit for final review before viewing this report.");
            return OrderEntryReview(r);
        }finally{gate.Release();}
    }
    internal async Task<SimOrderEntry> AcceptNewOrder(string id,SimOrderAcceptRequest request,SimPersona persona)
    {
        if(!persona.Can("order_entry.accept")) throw new SimOrderEntryPermissionException();
        if(!Guid.TryParse(request.RequestId,out _) || !request.Confirm || (request.Note?.Length??0)>4000) throw SimRfqIntakeProblem.BadRequest("ORDER_ACCEPT_REQUEST","Explicit confirmation and a valid request identity are required.");
        await gate.WaitAsync();try {
            var dataset=await ReadDatasetAsync();var r=RequireEntryRecord(dataset.Records,id);var hash=OrderEntryHash(new{id,request});
            var retry=dataset.Records.FirstOrDefault(x=>x.OrderEntry?.Acceptance.RequestId==request.RequestId);
            if(retry is not null) {if(retry.OrderEntry!.Acceptance.RequestHash!=hash)throw SimRfqIntakeProblem.Conflict("ORDER_REQUEST_REUSED","Request identity was reused for different content.");return retry.OrderEntry;}
            if(r.OrderEntry is not null) throw SimRfqIntakeProblem.Conflict("ORDER_ALREADY_ACCEPTED","This exact package already has an acceptance and bridge.");
            if(r.OrderIntake!.Revision!=request.ExpectedRevision || OrderAcceptanceToken(r)!=request.SourceToken) throw SimRfqIntakeProblem.Conflict("ORDER_ACCEPT_STALE","The reviewed package changed. Refresh and review again.");
            var blockers=OrderAcceptanceBlockers(r.OrderIntake);if(blockers.Length>0)throw SimRfqIntakeProblem.Conflict("ORDER_ACCEPT_BLOCKED",string.Join(" ",blockers));
            foreach(var e in r.OrderIntake.PoEvidence) await documents.Verify(r.RequestCorrelationId,e.Document,e.AddedBy);
            var now=DateTimeOffset.UtcNow;var acceptance=new SimOrderAcceptance(Guid.NewGuid().ToString(),r.OrderIntake.Revision,request.SourceToken,request.RequestId,hash,persona.Id,persona.DisplayName,now,request.Note?.Trim()??"",r.OrderIntake);
            var initial=new SimBridgeState("READY_FOR_VPRO",[],null,null);
            var bridge=new SimOrderBridge(Guid.NewGuid().ToString(),acceptance.Id,1,initial,[new(request.RequestId,hash,"ENQUEUE",1,persona.Id,persona.DisplayName,now,null,null,initial)]);
            var entry=new SimOrderEntry(acceptance,bridge);
            // One verified file replacement under the same gate commits acceptance AND enqueue.
            dataset.Records[dataset.Records.IndexOf(r)]=r with{OrderEntry=entry,Status="ACCEPTED_FOR_ORDER_ENTRY",HandoffTarget="Order Entry (VPRO 5 Bridge)"};dataset.UpdatedAtUtc=now;
            await WriteVerifiedAsync(dataset);return entry;
        }finally{gate.Release();}
    }
    internal async Task<SimOrderBridge> UpdateOrderBridge(string id,SimBridgeRequest request,SimPersona persona)
    {
        if(!persona.Can("order_entry.manage"))throw new SimOrderEntryPermissionException();
        if(!Guid.TryParse(request.RequestId,out _) || (request.Reason?.Length??0)>4000)throw SimRfqIntakeProblem.BadRequest("BRIDGE_REQUEST","A valid request identity and bounded note are required.");
        await gate.WaitAsync();try {
            var dataset=await ReadDatasetAsync();var r=RequireEntryRecord(dataset.Records,id);var entry=r.OrderEntry??throw SimRfqIntakeProblem.Conflict("BRIDGE_NOT_ACCEPTED","Accept the New Order first.");
            var bridge=entry.Bridge;var before=bridge.State;var hash=OrderEntryHash(new{id,request});
            var retry=dataset.Records.Select(x=>x.OrderEntry?.Bridge).Where(b=>b is not null).FirstOrDefault(b=>b!.History.Any(h=>h.RequestId==request.RequestId));
            if(retry is not null){if(retry.History.Single(h=>h.RequestId==request.RequestId).RequestHash!=hash)throw SimRfqIntakeProblem.Conflict("BRIDGE_REQUEST_REUSED","Request identity was reused for different content.");return retry;}
            if(bridge.Revision!=request.ExpectedRevision)throw SimRfqIntakeProblem.Conflict("BRIDGE_STALE","Bridge changed. Refresh before editing.");
            if(before.Status=="RELEASED_TO_OPERATIONS")throw SimRfqIntakeProblem.Conflict("BRIDGE_RELEASED","Released records cannot be edited here.");
            var next=before;var reason=request.Reason?.Trim();
            void RequireReason(){if(string.IsNullOrWhiteSpace(reason))throw SimRfqIntakeProblem.BadRequest("BRIDGE_REASON","Record a reason for correction, reopening or a hold.");}
            if(before.Status=="READY_FOR_OPERATIONS_SYNC" && request.Action is not ("REOPEN" or "IDENTIFIERS"))throw SimRfqIntakeProblem.Conflict("BRIDGE_READY","Reopen this bridge with a reason before editing checklist work.");
            switch(request.Action) {
                case "START": next=before with{Status="IN_PROGRESS"};break;
                case "CHECK":
                    if(!BridgeChecklist.Contains(request.Item))throw SimRfqIntakeProblem.BadRequest("BRIDGE_ITEM","Unknown checklist item.");
                    if(!request.Complete)RequireReason();
                    next=before with{Status="IN_PROGRESS",Completed=request.Complete?before.Completed.Append(request.Item!).Distinct().ToArray():before.Completed.Where(i=>i!=request.Item).ToArray()};break;
                case "IDENTIFIERS":
                    var input=request.Identifiers??throw SimRfqIntakeProblem.BadRequest("BRIDGE_IDS","Enter synthetic SO, SO line and WO identifiers.");
                    var ids=new SimBridgeIdentifiers("SIM-VPRO5",input.SalesOrder?.Trim()??"",input.SalesOrderLine?.Trim()??"",input.WorkOrder?.Trim()??"",id+":1");
                    // The host owns the ERP source. Legacy SIM labels may be retained,
                    // but new identities use the numeric shape of the VPRO adapters.
                    static bool Numeric(string value,int width)=>value.Length>=1 && value.Length<=width && value.All(c=>c>='0'&&c<='9');
                    static bool LegacyUnchanged(string value,string? prior)=>value==prior && value.StartsWith("SIM-",StringComparison.Ordinal) && value.Length<=80 && !value.Any(char.IsControl);
                    if(input.OrderLineKey!=ids.OrderLineKey || (input.Namespace is not null && input.Namespace!=ids.Namespace) ||
                        !(Numeric(ids.SalesOrder,7)||LegacyUnchanged(ids.SalesOrder,before.Identifiers?.SalesOrder)) ||
                        !Numeric(ids.SalesOrderLine,3) ||
                        !(Numeric(ids.WorkOrder,7)||LegacyUnchanged(ids.WorkOrder,before.Identifiers?.WorkOrder)))
                        throw SimRfqIntakeProblem.BadRequest("BRIDGE_SYNTHETIC_IDS","Enter numeric Sales Order and Work Order identifiers (up to 7 digits) and a Sales Order Line (up to 3 digits). Existing SIM labels may be retained. ERP Source is controlled by the system.");
                    if(before.Identifiers is not null && before.Identifiers!=ids)RequireReason();
                    if(dataset.Records.Any(other=>other.IntakeId!=id && other.OrderEntry?.Bridge.State.Identifiers is {} otherIds && otherIds.Namespace==ids.Namespace && ((otherIds.SalesOrder==ids.SalesOrder && otherIds.SalesOrderLine==ids.SalesOrderLine)||otherIds.WorkOrder==ids.WorkOrder)))throw SimRfqIntakeProblem.Conflict("BRIDGE_ID_CONFLICT","That scoped SO line or WO is already linked to another order.");
                    next=before with{Status="IN_PROGRESS",Identifiers=ids};break;
                case "HOLD": RequireReason();next=before with{Status="IN_PROGRESS",HoldReason=reason};break;
                case "CLEAR_HOLD": RequireReason();next=before with{Status="IN_PROGRESS",HoldReason=null};break;
                case "REOPEN": RequireReason();next=before with{Status="IN_PROGRESS"};break;
                case "READY":
                    if(before.HoldReason is not null || before.Identifiers is null || BridgeChecklist.Except(before.Completed).Any())throw SimRfqIntakeProblem.Conflict("BRIDGE_INCOMPLETE","Complete the five attestations, capture SO/SO line/WO and resolve holds first.");
                    next=before with{Status="READY_FOR_OPERATIONS_SYNC"};break;
                default:throw SimRfqIntakeProblem.BadRequest("BRIDGE_ACTION","Unsupported bridge action. Operations release is not implemented.");
            }
            var now=DateTimeOffset.UtcNow;var version=bridge.Revision+1;
            var updated=bridge with{Revision=version,State=next,History=bridge.History.Append(new(request.RequestId,hash,request.Action,version,persona.Id,persona.DisplayName,now,reason,before,next)).ToArray()};
            dataset.Records[dataset.Records.IndexOf(r)]=r with{OrderEntry=entry with{Bridge=updated,
                OperationsRecognition=next.Identifiers!=before.Identifiers?null:entry.OperationsRecognition}};dataset.UpdatedAtUtc=now;await WriteVerifiedAsync(dataset);return updated;
        }finally{gate.Release();}
    }
}
internal sealed class SimOrderEntryPermissionException : Exception;

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapOrderEntry(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        async Task<IResult> Guard(HttpContext c,string permission,Func<Task<IResult>> action) {
            var denied=Denied(c,state,personas,false);if(denied is not null)return denied;
            if(!personas.Resolve(c).Can(permission))return Results.Json(new{message="Order Entry permission required."},statusCode:403);
            c.Response.Headers.CacheControl="private, no-store";
            try{return await action();}catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}catch(SimOrderEntryPermissionException){return Results.StatusCode(403);}
        }
        app.MapGet("/api/sim/order-entry",async Task<IResult>(HttpContext c)=>await Guard(c,"order_entry.view",async()=>Results.Json(await store.ListOrderEntry())));
        app.MapGet("/api/sim/order-entry/{id}",(HttpContext c,string id)=>Guard(c,"order_entry.view",async()=>Results.Json(await store.ReadOrderEntry(id))));
        app.MapGet("/api/sim/order-entry/{id}/review.pdf",(HttpContext c,string id)=>Guard(c,"order_entry.view",async()=>Results.File(await SimQuotationPdf.RenderDocument(await store.ReadOrderEntryReport(id),"sim_contract_review_pdf.py"),"application/pdf")));
        app.MapPost("/api/sim/order-entry/{id}/accept",(HttpContext c,string id,SimOrderAcceptRequest r)=>Guard(c,"order_entry.accept",async()=>Results.Json(await store.AcceptNewOrder(id,r,personas.Resolve(c)))));
        app.MapPost("/api/sim/order-entry/{id}/bridge",(HttpContext c,string id,SimBridgeRequest r)=>Guard(c,"order_entry.manage",async()=>Results.Json(await store.UpdateOrderBridge(id,r,personas.Resolve(c)))));
    }
}
