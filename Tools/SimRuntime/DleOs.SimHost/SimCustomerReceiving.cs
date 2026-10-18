using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Serialization;

// No purchase/expected-receipt row is created. Empty legacy purchase GUIDs mean not applicable;
// CustomerSource is the explicit, immutable authority for these receipts.
internal sealed record SimCustomerReceiptSource(string DemandId, Guid CaseId, Guid SubmissionId,
    string SourceFingerprint, string SourceRowId, string WorkOrderNumber, string CustomerNumber,
    string Customer, string PartNumber, string Uom);
internal sealed record SimCustomerReceiveRequest([property: JsonRequired] long ExpectedVersion, Guid RequestId,
    [property: JsonRequired] long ExpectedDemandVersion, Guid ExpectedSubmissionId, string ExpectedSourceFingerprint,
    string AcknowledgmentNumber, string ReceivedDate, decimal CountedQuantity, decimal AcceptedQuantity,
    decimal HoldQuantity, decimal RejectedQuantity, string ObservedPartNumber, string Notes,
    [property: JsonRequired] bool CocRequired, [property: JsonRequired] bool MaterialCertRequired,
    [property: JsonRequired] bool TraceabilityRequired, [property: JsonRequired] bool InspectionRequired,
    string RequirementsReason, Dictionary<string,string> Checks, string[]? EvidenceDocumentIds);
internal sealed record SimCustomerReceivingView(SimPurchasingDemand Demand, long Version, bool CanReceive,
    decimal ReceivedQuantity, decimal OpenQuantity, SimAcceptedMaterial[] Materials, SimReceivingDocument[] Documents);

internal sealed partial class SimReceivingService
{
    internal static string CustomerFolder(string id) => new Guid(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("CUSTOMER_RECEIVING:"+id)).AsSpan(0,16)).ToString();
    internal static string CustomerKey(string demandId) => "CUSTOMER:" + demandId;
    internal static bool CustomerSourceMatches(SimCustomerReceiptSource source, SimPurchasingDemand demand) =>
        demand.SourceCurrent && demand.CustomerSupply is not null && source.DemandId == demand.DemandId &&
        source.CaseId == demand.CaseId && source.SubmissionId == demand.SubmissionId &&
        source.SourceFingerprint == demand.SourceFingerprint && source.SourceRowId == demand.SourceRowId &&
        source.WorkOrderNumber == demand.WorkOrderNumber && source.CustomerNumber == demand.CustomerNumber &&
        source.PartNumber == demand.PartNumber && source.Uom == demand.Uom;
    private static SimPurchasingDemand CustomerDemand(SimPurchasingView view, string id) {
        var d = view.Demands.SingleOrDefault(d => d.DemandId == id)
            ?? throw SimPurchasingProblem.Missing("Customer shortage was not found.");
        if (!d.SourceCurrent || d.CustomerSupply is null || d.State is not ("INCOMING" or "ACCEPTED") ||
            (d.RemainingShortQuantity ?? d.ShortQuantity) <= 0 || (d.SupplyConflicts?.Length ?? 0) > 0)
            throw Conflict("customer_source_changed", "Select a current, unresolved customer-supplied shortage.");
        return d;
    }
    private static long CustomerVersion(SimReceivingSnapshot snapshot,string id) => snapshot.Events
        .Where(e=>e.PoKey==CustomerKey(id)&&e.EventType=="CUSTOMER_RECEIPT_ACKNOWLEDGED")
        .Select(e=>e.ResultingVersion).DefaultIfEmpty(0).Max();
    private static SimCustomerReceivingView CustomerView(SimPurchasingDemand d,SimReceivingSnapshot s,bool can) {
        var received=s.Materials.SelectMany(m=>m.Coverage).Where(c=>c.DemandId==d.DemandId).Sum(c=>c.ReceivedQuantity);
        return new(d,CustomerVersion(s,d.DemandId),can,received,Math.Max(0,d.ShortQuantity-received),
            s.Materials.Where(m=>m.CustomerSource?.DemandId==d.DemandId).ToArray(),
            s.Documents.Where(x=>x.CustomerDemandId==d.DemandId).ToArray());
    }
    internal Task<SimCustomerReceivingView[]> CustomerReceipts(SimPersona actor) => state.WithStableRuntime(async runtime=> {
        Permission(actor,false);var (p,s)=await operations.ReadPurchasingAndReceiving(runtime,false);
        return p.Demands.Where(d=>d.CustomerSupply is not null && d.SourceCurrent && d.ShortQuantity>0)
            .Select(d=>CustomerView(d,s,actor.Can("receiving.manage"))).ToArray();
    });
    internal Task<SimCustomerReceivingView> ReadCustomer(string id,SimPersona actor) => state.WithStableRuntime(async runtime=> {
        Permission(actor,false);var(p,s)=await operations.ReadPurchasingAndReceiving(runtime,false);
        return CustomerView(CustomerDemand(p,id),s,actor.Can("receiving.manage"));
    });
    internal Task<SimCustomerReceivingView> ReceiveCustomer(string id,SimCustomerReceiveRequest r,SimPersona actor) =>
        Command("CUSTOMER_RECEIVE:"+id,r.RequestId,r,actor,async(p,s,now)=> {
            var d=CustomerDemand(p,id);Version(CustomerVersion(s,id),r.ExpectedVersion);
            if(d.Version!=r.ExpectedDemandVersion || d.SubmissionId!=r.ExpectedSubmissionId || d.SourceFingerprint!=r.ExpectedSourceFingerprint)
                throw Conflict("customer_source_changed","The customer shortage changed. Refresh before acknowledging delivery.");
            var key=CustomerKey(id);var acknowledgment=Required(r.AcknowledgmentNumber,120,"Enter a customer receipt acknowledgment reference.");
            var date=Date(r.ReceivedDate);var note=Required(r.Notes,4000,"Record the receipt acknowledgment notes.");
            if(s.Deliveries.Any(x=>x.PoKey==key && string.Equals(x.PackingSlipNumber,acknowledgment,StringComparison.OrdinalIgnoreCase)))
                throw Conflict("acknowledgment_already_received","This acknowledgment is already recorded for this shortage.");
            foreach(var q in new[]{r.CountedQuantity,r.AcceptedQuantity,r.HoldQuantity,r.RejectedQuantity})Quantity(q);
            if(r.CountedQuantity<=0 || r.CountedQuantity!=r.AcceptedQuantity+r.HoldQuantity+r.RejectedQuantity)
                throw Invalid("quantity_reconciliation","Counted must equal Accepted + Hold + Rejected and be positive.");
            var previous=s.Materials.SelectMany(m=>m.Coverage).Where(c=>c.DemandId==id).Sum(c=>c.ReceivedQuantity);
            if(previous+r.CountedQuantity>d.ShortQuantity)
                throw Conflict("over_receipt","The acknowledged quantity exceeds the remaining shortage delivery balance.");
            if(p.Purchases.Any(x=>x.OpenQuantity>0 && x.Coverage.Any(c=>c.DemandId==id)))
                throw Conflict("mixed_source_obligation","An open purchase also covers this shortage. Review its source before customer receiving.");
            var observed=Required(r.ObservedPartNumber,200,"Record the observed part number.");
            if(r.AcceptedQuantity>0 && observed!=d.PartNumber && observed!=d.ApprovedPartNumber && observed!=d.CustomerSupply!.CustomerPartNumber)
                throw Invalid("part_mismatch","Accepted material must match the customer or approved part number.");
            Required(r.RequirementsReason,2000,"Record why these receiving requirements apply.");
            var original=d.QualityRequirements;
            if(original.CocRequired==true&&!r.CocRequired || original.MaterialCertRequired==true&&!r.MaterialCertRequired ||
                original.PoTraceabilityRequired&&!r.TraceabilityRequired || original.InspectionRequired==true&&!r.InspectionRequired)
                throw Invalid("required_evidence_preserved","Required acceptance evidence cannot be disabled by a customer acknowledgment.");
            var frozen=s.Materials.FirstOrDefault(m=>m.CustomerSource?.DemandId==id)?.Requirements;
            if(frozen is not null && (frozen.CocRequired!=r.CocRequired || frozen.MaterialCertRequired!=r.MaterialCertRequired ||
                frozen.PoTraceabilityRequired!=r.TraceabilityRequired || frozen.InspectionRequired!=r.InspectionRequired))
                throw Conflict("requirements_frozen","Retain the acceptance requirements established at the first customer receipt.");
            var req=new SimReceivingRequirements(r.CocRequired,r.MaterialCertRequired,r.TraceabilityRequired,r.InspectionRequired,r.RequestId);
            var docs=(r.EvidenceDocumentIds??[]).Distinct().Select(x=>Evidence(s,key,x)).ToArray();
            foreach(var doc in docs)await VerifyDocument(doc);
            // The acknowledgment replaces a supplier packing slip; all acceptance checks still apply.
            ValidateChecks(new(Guid.Empty,r.CountedQuantity,r.CountedQuantity,r.AcceptedQuantity,r.HoldQuantity,r.RejectedQuantity,
                observed,note,r.Checks),req,docs);
            var source=new SimCustomerReceiptSource(id,d.CaseId,d.SubmissionId,d.SourceFingerprint,d.SourceRowId,
                d.WorkOrderNumber,d.CustomerNumber,d.Customer,d.PartNumber,d.Uom);
            var deliveryId=Guid.NewGuid();var seq=s.Materials.Select(m=>long.Parse(m.ReceiptLineId[7..],CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max()+1;
            var m=new SimAcceptedMaterial("SIM-AM-"+seq.ToString("D7",CultureInfo.InvariantCulture),Guid.Empty,Guid.Empty,deliveryId,"","","",
                d.PartNumber,d.PartNumber,d.ApprovedPartNumber,d.Description,d.Uom,acknowledgment,r.CountedQuantity,observed,note,
                r.CountedQuantity,r.AcceptedQuantity,r.HoldQuantity,r.RejectedQuantity,0,
                [new(id,r.AcceptedQuantity,r.CountedQuantity,r.HoldQuantity,r.RejectedQuantity,d.WorkOrderNumber,d.SalesOrderNumber,d.SalesOrderLineNumber)],
                actor.DisplayName,r.AcceptedQuantity>0?actor.DisplayName:"",actor.Id,now,r.AcceptedQuantity>0?now:null,"",null,1,null,
                new(r.Checks),req,docs,"SIM_CUSTOMER_RECEIPT",0,source);
            var delivery=new SimReceivingDelivery(deliveryId,key,"","",acknowledgment,date,"","",note,null,actor.DisplayName,actor.Id,now,[m.ReceiptLineId],r.ExpectedVersion+1);
            var audit=Event("CUSTOMER_RECEIPT_ACKNOWLEDGED",key,deliveryId.ToString(),actor,now,r.ExpectedVersion,r.ExpectedVersion+1,
                new{source,delivery,material=m,originalRequirements=original,requirementsReason=r.RequirementsReason});
            var next=s with{Materials=[..s.Materials,m],Deliveries=[..s.Deliveries,delivery],Events=[..s.Events,audit]};
            return new SimReceivingChange<SimCustomerReceivingView>(CustomerView(d,next,true),Delivery:delivery,Materials:[m],Event:audit);
        });
    internal async Task<SimReceivingDocument> UploadCustomer(string id,string kind,string name,Stream input,SimPersona actor) {
        Permission(actor,true);await ReadCustomer(id,actor);kind=kind.Trim().ToUpperInvariant();
        if(kind is not("PACKING_SLIP" or "COC" or "MATERIAL_CERT" or "TRACEABILITY" or "INSPECTION"))throw Invalid("document_kind","Choose a receiving evidence category.");
        var doc=await documents.Stage(CustomerFolder(id),name,0,input,"Receiving:"+actor.Id);var bytes=await documents.Bytes(CustomerFolder(id),doc.DocumentId!);
        var reference=new SimReceivingDocument(doc.DocumentId!,Guid.Empty,CustomerKey(id),kind,doc,Convert.ToHexString(SHA256.HashData(bytes)),actor.DisplayName,actor.Id,UtcNow(),id);
        return await Command("CUSTOMER_DOCUMENT:"+id,Guid.Parse(doc.DocumentId!),reference,actor,(p,s,now)=> {
            CustomerDemand(p,id);
            return Task.FromResult(new SimReceivingChange<SimReceivingDocument>(reference,Document:reference,
                Event:Event("DOCUMENT_ATTACHED",CustomerKey(id),reference.DocumentId,actor,now,0,0,reference)));
        });
    }
    internal async Task<(SimRfqIntakeDocument Document,byte[] Bytes)> OpenCustomerDocument(string id,string docId,SimPersona actor) {
        Permission(actor,false);var snapshot=await History(actor);
        var doc=snapshot.Documents.SingleOrDefault(d=>d.CustomerDemandId==id&&d.DocumentId==docId)
            ??throw SimPurchasingProblem.Missing("Customer receipt evidence was not found.");
        await VerifyDocument(doc);return(doc.Document,await documents.Bytes(CustomerFolder(id),docId));
    }
}
