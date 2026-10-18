using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

internal sealed partial class SimReceivingService(SimStateStore state, SimOperationsDataStore operations, SimIntakeDocuments documents)
{
    internal Func<DateTimeOffset> UtcNow { get; set; } = () => DateTimeOffset.UtcNow;
    internal static void Permission(SimPersona actor, bool write)
    {
        if (!actor.Can(write ? "receiving.manage" : "receiving.view") && (write || !actor.Can("purchasing.view")))
            throw new SimOrderEntryPermissionException();
    }
    internal static string PoKey(SimPurchaseLine purchase) => SimPurchasingService.Hash(new { purchase.Supplier, purchase.PoNumber });
    internal static SimPurchaseLine Anchor(SimPurchasingView purchases, Guid id) => purchases.Purchases.SingleOrDefault(p => p.PurchaseId == id)
        ?? throw SimPurchasingProblem.Missing("The expected purchase line was not found.");
    internal static long PoVersion(SimReceivingSnapshot snapshot, string key) => snapshot.Events
        .Where(e => e.PoKey == key && e.EventType is "REQUIREMENTS_REVIEWED" or "DELIVERY_DISPOSITIONED")
        .Select(e => e.ResultingVersion).DefaultIfEmpty(0).Max();
    internal static SimReceivingRequirements Requirements(SimPurchaseLine purchase, SimReceivingSnapshot snapshot)
    {
        var reviewed = snapshot.Reviews.Where(r => r.PoKey == PoKey(purchase) && r.Lines.Any(l => l.PurchaseId == purchase.PurchaseId))
            .OrderByDescending(r => r.ResultingVersion).FirstOrDefault();
        var line = reviewed?.Lines.Single(l => l.PurchaseId == purchase.PurchaseId);
        return line is null ? new(purchase.QualityRequirements.CocRequired, purchase.QualityRequirements.MaterialCertRequired,
            purchase.QualityRequirements.PoTraceabilityRequired, purchase.QualityRequirements.InspectionRequired, null)
            : new(line.CocRequired, line.MaterialCertRequired, line.PoTraceabilityRequired, line.InspectionRequired, reviewed!.ReviewId);
    }
    internal static SimReceivingPoView PoView(SimPurchasingView purchases, SimReceivingSnapshot snapshot, Guid id, bool canReceive)
    {
        var anchor = Anchor(purchases, id); var key = PoKey(anchor);
        var lines = purchases.Purchases.Where(p => PoKey(p) == key).OrderBy(p => p.PoLine).Select(p => {
            var received = snapshot.Materials.Where(m => m.PurchaseId == p.PurchaseId).ToArray();
            var physical = Math.Max(p.ReceivedQuantity, received.Sum(m => m.ReceivedQuantity));
            var projected = p with { ReceivedQuantity = physical, OpenQuantity = Math.Max(0,p.OrderedQuantity-physical),
                Status = physical >= p.OrderedQuantity ? "RECEIVED" : physical > 0 ? "PARTIALLY_RECEIVED" : p.Status,
                ReceiptState = physical >= p.OrderedQuantity ? "RECEIVED" : physical > 0 ? "PARTIALLY_RECEIVED" : p.ReceiptState };
            return new SimReceivingPoLine(projected, physical, received.Sum(m => m.AcceptedQuantity),
                received.Sum(m => m.HoldQuantity), received.Sum(m => m.RejectedQuantity), received.Sum(m => m.AvailableQuantity),
                projected.OpenQuantity, Requirements(p, snapshot));
        }).ToArray();
        var ids = lines.Select(l => l.Purchase.PurchaseId).ToHashSet();
        return new("SIM", purchases.Generation, canReceive, PoVersion(snapshot, key), anchor.Supplier, anchor.PoNumber,
            lines, snapshot.Deliveries.Where(d => d.PoKey == key).ToArray(),
            snapshot.Materials.Where(m => ids.Contains(m.PurchaseId)).ToArray(), snapshot.Documents.Where(d => d.PoKey == key).ToArray());
    }
    internal Task<SimReceivingPoView> ReadPo(Guid purchaseId, SimPersona actor) => state.WithStableRuntime(async runtime => {
        Permission(actor, false);
        return await operations.ReadReceivingPo(runtime, purchaseId, actor.Can("receiving.manage"));
    });
    internal Task<SimReceivingSnapshot> History(SimPersona actor) => state.WithStableRuntime(async runtime => {
        Permission(actor, false); return await operations.ReadReceiving(runtime);
    });
    internal async Task<SimAcceptedMaterial> Material(string id, SimPersona actor) => (await History(actor)).Materials.SingleOrDefault(m => m.ReceiptLineId == id)
        ?? throw SimPurchasingProblem.Missing("The operational material record was not found.");

    internal Task<SimReceivingPoView> Review(Guid id, SimReceivingRequirementsRequest request, SimPersona actor) =>
        Command("REQUIREMENTS:" + id, request.RequestId, request, actor, (purchases, snapshot, now) => {
            var anchor = Anchor(purchases, id); var key = PoKey(anchor); Version(PoVersion(snapshot,key), request.ExpectedVersion);
            var reason = Required(request.Reason, 2000, "Record why these supplier receiving requirements apply.");
            if (request.Lines is null || request.Lines.Length == 0 || request.Lines.Select(l => l.PurchaseId).Distinct().Count() != request.Lines.Length)
                throw Invalid("requirements_lines", "Select distinct purchase lines to review.");
            foreach (var line in request.Lines) {
                if (PoKey(Anchor(purchases,line.PurchaseId)) != key) throw Invalid("po_scope", "All reviewed lines must belong to this supplier and PO.");
                if (snapshot.Materials.Any(m => m.PurchaseId == line.PurchaseId))
                    throw Conflict("requirements_frozen", "Receiving has started for this line. Retain its reviewed requirements; subsequent changes need a separate controlled amendment.");
            }
            var review = new SimReceivingRequirementReview(Guid.NewGuid(),key,request.Lines,reason,actor.DisplayName,actor.Id,now,request.ExpectedVersion,request.ExpectedVersion+1);
            var audit = Event("REQUIREMENTS_REVIEWED",key,review.ReviewId.ToString(),actor,now,request.ExpectedVersion,request.ExpectedVersion+1,
                new { review, original = request.Lines.Select(l => new { l.PurchaseId, requirements = Requirements(Anchor(purchases,l.PurchaseId),snapshot) }).ToArray() });
            var next = snapshot with { Reviews = [..snapshot.Reviews,review], Events = [..snapshot.Events,audit] };
            return Task.FromResult(new SimReceivingChange<SimReceivingPoView>(PoView(purchases,next,id,true),Review:review,Event:audit));
        });

    internal Task<SimReceivingPoView> Receive(Guid id, SimReceiveRequest request, SimPersona actor) =>
        Command("RECEIVE:"+id,request.RequestId,request,actor, async (purchases,snapshot,now) => {
            var anchor = Anchor(purchases,id); var key = PoKey(anchor); Version(PoVersion(snapshot,key),request.ExpectedVersion);
            var slip = Required(request.PackingSlipNumber,120,"Enter the supplier packing-slip number.");
            var date = Date(request.PackingSlipDate);
            if (snapshot.Deliveries.Any(d => d.PoKey == key && string.Equals(d.PackingSlipNumber,slip,StringComparison.OrdinalIgnoreCase)))
                throw Conflict("packing_slip_already_received", "This packing slip has already been recorded for this PO. Open its retained receipt instead of receiving it again.");
            if (request.Lines is null || request.Lines.Length is < 1 or > 100 || request.Lines.Select(l=>l.PurchaseId).Distinct().Count()!=request.Lines.Length)
                throw Invalid("receive_lines","Provide distinct received purchase lines.");
            SimReceivingDocument? slipDocument = null;
            if (!string.IsNullOrWhiteSpace(request.DocumentId)) {
                slipDocument = Evidence(snapshot,key,request.DocumentId,"PACKING_SLIP"); await VerifyDocument(slipDocument);
            }
            var deliveryId = Guid.NewGuid(); var materials = new List<SimAcceptedMaterial>();
            var nextSequence = snapshot.Materials.Select(m => long.Parse(m.ReceiptLineId[7..],CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max()+1;
            foreach (var line in request.Lines) {
                var purchase = Anchor(purchases,line.PurchaseId);
                if (PoKey(purchase)!=key) throw Invalid("po_scope","All received lines must belong to the selected supplier/PO.");
                foreach(var qty in new[]{line.PackingSlipQuantity,line.CountedQuantity,line.AcceptedQuantity,line.HoldQuantity,line.RejectedQuantity}) Quantity(qty);
                if (line.CountedQuantity<=0 || line.CountedQuantity!=line.AcceptedQuantity+line.HoldQuantity+line.RejectedQuantity)
                    throw Invalid("quantity_reconciliation","Counted quantity must be positive and equal Accepted + Hold + Rejected.");
                var previous = snapshot.Materials.Where(m=>m.PurchaseId==purchase.PurchaseId).ToArray();
                if(purchase.ReceivedQuantity!=previous.Sum(m=>m.ReceivedQuantity))
                    throw Conflict("legacy_receiving_unresolved","This purchase has physical receipt history outside the operational evidence. Reconcile it before further receiving.");
                if (previous.Sum(m=>m.ReceivedQuantity)+line.CountedQuantity>purchase.OrderedQuantity)
                    throw Conflict("over_receipt","Counted quantity exceeds the remaining supplier delivery obligation. A reviewed over-delivery process is required.");
                var reason = Clean(line.DiscrepancyReason,2000); var observed = Clean(line.ObservedPartNumber,200);
                if ((line.PackingSlipQuantity!=line.CountedQuantity || line.HoldQuantity>0 || line.RejectedQuantity>0 ||
                    observed.Length>0 && !string.Equals(observed,purchase.VendorPartNumber,StringComparison.OrdinalIgnoreCase)) && reason.Length==0)
                    throw Invalid("discrepancy_reason","Record an explanation for count, identity, hold or rejection discrepancies.");
                var requirements = Requirements(purchase,snapshot);
                var evidence = (line.EvidenceDocumentIds??[]).Distinct().Select(d=>Evidence(snapshot,key,d)).ToArray();
                foreach(var doc in evidence) await VerifyDocument(doc);
                ValidateChecks(line,requirements,evidence);
                var coverage = Allocate(purchase,purchases,snapshot,line);
                var material = new SimAcceptedMaterial("SIM-AM-"+(nextSequence++).ToString("D7",CultureInfo.InvariantCulture),
                    purchase.PurchaseId,purchase.ExpectedReceiptId,deliveryId,purchase.Supplier,purchase.PoNumber,purchase.PoLine,
                    purchase.PartNumber,purchase.ApprovedPartNumber,purchase.VendorPartNumber,purchase.Description,purchase.PurchasingUom,
                    slip,line.PackingSlipQuantity,observed,reason,line.CountedQuantity,line.AcceptedQuantity,line.HoldQuantity,line.RejectedQuantity,
                    0,coverage,actor.DisplayName,line.AcceptedQuantity>0?actor.DisplayName:"",actor.Id,now,line.AcceptedQuantity>0?now:null,
                    "",null,1,null,new(line.Checks),requirements,evidence);
                materials.Add(material);
            }
            var delivery = new SimReceivingDelivery(deliveryId,key,anchor.Supplier,anchor.PoNumber,slip,date,
                Clean(request.Carrier,120),Clean(request.TrackingNumber,200),Clean(request.Notes,4000),slipDocument,
                actor.DisplayName,actor.Id,now,materials.Select(m=>m.ReceiptLineId).ToArray(),request.ExpectedVersion+1);
            var audit=Event("DELIVERY_DISPOSITIONED",key,deliveryId.ToString(),actor,now,request.ExpectedVersion,request.ExpectedVersion+1,new{delivery,materials});
            var next=snapshot with{Deliveries=[..snapshot.Deliveries,delivery],Materials=[..snapshot.Materials,..materials],Events=[..snapshot.Events,audit]};
            return new SimReceivingChange<SimReceivingPoView>(PoView(purchases,next,id,true),Delivery:delivery,Materials:materials.ToArray(),Event:audit);
        });

    internal Task<SimAcceptedMaterial> Stage(string id,SimStageMaterialRequest request,SimPersona actor) =>
        Command("STAGE:"+id,request.RequestId,request,actor,(purchases,snapshot,now)=> {
            var prior=snapshot.Materials.SingleOrDefault(m=>m.ReceiptLineId==id)??throw SimPurchasingProblem.Missing("Accepted material was not found.");
            Version(prior.Version,request.ExpectedVersion);
            if(prior.AcceptedQuantity<=0)throw Invalid("no_accepted_material","Only accepted usable quantity can be staged for Kitting.");
            if(prior.StagedAtUtc is not null)throw Conflict("already_staged","This accepted material is already staged. Reprinting never requires staging again.");
            var location=Required(request.Location,200,"Record a SIM staging location.");
            var stage=new SimReceivingStage(Guid.NewGuid(),id,location,actor.Id,actor.DisplayName,now,prior.Version,prior.Version+1);
            var result=prior with{StagingLocation=location,StagedAtUtc=now,Version=stage.ResultingVersion,AvailableQuantity=prior.AcceptedQuantity};
            var audit=Event("MATERIAL_STAGED",prior.CustomerSource is {} cs ? CustomerKey(cs.DemandId) : PoKey(Anchor(purchases,prior.PurchaseId)),id,actor,now,prior.Version,result.Version,stage);
            return Task.FromResult(new SimReceivingChange<SimAcceptedMaterial>(result,Stage:stage,Event:audit));
        });

    internal async Task<SimReceivingDocument> Upload(Guid id,string kind,string name,Stream input,SimPersona actor)
    {
        Permission(actor,true); kind=kind.Trim().ToUpperInvariant();
        if(kind is not("PACKING_SLIP" or "COC" or "MATERIAL_CERT" or "TRACEABILITY" or "INSPECTION"))throw Invalid("document_kind","Choose a Receiving evidence category.");
        // Existing verified binary store owns files, hashes and retrieval; Receiving owns their scoped reference.
        var view=await ReadPo(id,actor); var doc=await documents.Stage(id.ToString(),name,0,input,"Receiving:"+actor.Id);
        var bytes=await documents.Bytes(id.ToString(),doc.DocumentId!);
        var reference=new SimReceivingDocument(doc.DocumentId!,id,SimPurchasingService.Hash(new{Supplier=view.Supplier,PoNumber=view.PoNumber}),kind,doc,
            Convert.ToHexString(SHA256.HashData(bytes)),actor.DisplayName,actor.Id,UtcNow());
        var result = await Command("DOCUMENT:"+id,Guid.Parse(doc.DocumentId!),reference,actor,(purchases,snapshot,now)=> {
            var key=PoKey(Anchor(purchases,id));
            var duplicate=snapshot.Documents.FirstOrDefault(d=>d.PoKey==key&&d.Kind==kind&&d.Sha256==reference.Sha256);
            return Task.FromResult(duplicate is not null ? new SimReceivingChange<SimReceivingDocument>(duplicate) :
                new SimReceivingChange<SimReceivingDocument>(reference,Document:reference,Event:Event("DOCUMENT_ATTACHED",key,reference.DocumentId,actor,now,0,0,reference)));
        });
        if(result.DocumentId!=reference.DocumentId)await documents.Remove(id.ToString(),reference.DocumentId,"Receiving:"+actor.Id);
        return result;
    }
    internal async Task<(SimRfqIntakeDocument Document,byte[] Bytes)> OpenDocument(Guid id,string documentId,SimPersona actor)
    {
        var view=await ReadPo(id,actor); var doc=view.Documents.SingleOrDefault(d=>d.DocumentId==documentId)
            ??throw SimPurchasingProblem.Missing("This Receiving document does not belong to the selected supplier/PO.");
        return(doc.Document,await documents.Bytes(doc.CustomerDemandId is {} customerId ? CustomerFolder(customerId) : doc.PurchaseId.ToString(),doc.DocumentId));
    }
    private async Task VerifyDocument(SimReceivingDocument doc)
    {
        var bytes=await documents.Bytes(doc.CustomerDemandId is {} customerId ? CustomerFolder(customerId) : doc.PurchaseId.ToString(),doc.DocumentId);
        if(Convert.ToHexString(SHA256.HashData(bytes))!=doc.Sha256)throw Conflict("evidence_changed","The Receiving evidence failed hash verification.");
    }
    private static SimReceivingDocument Evidence(SimReceivingSnapshot snapshot,string key,string id,string? kind=null) =>
        snapshot.Documents.SingleOrDefault(d=>d.PoKey==key&&d.DocumentId==id&&(kind is null||d.Kind==kind))
        ??throw Invalid("receiving_document","Use verified evidence attached to this supplier/PO and category.");
    private static void ValidateChecks(SimReceiveLineRequest line,SimReceivingRequirements requirements,SimReceivingDocument[] docs)
    {
        string[] core=["packingSlip","partIdentity","uom","physicalCount","condition","damage","inspection"];
        if(line.Checks is null||core.Any(c=>!line.Checks.TryGetValue(c,out var value)||value is not("PASS" or "FAIL" or "NOT_APPLICABLE")))
            throw Invalid("inspection_incomplete","Complete the Receiving checklist with explicit results.");
        if(line.Checks["physicalCount"]!="PASS")throw Invalid("count_required","Record and verify the physical count.");
        if(line.AcceptedQuantity<=0)return;
        if(core.Any(c=>line.Checks[c]!="PASS"))throw Invalid("inspection_failed","Accepted quantity requires every basic receiving check to pass. Hold or reject affected material.");
        if(requirements.CocRequired is null||requirements.MaterialCertRequired is null||requirements.InspectionRequired is null)
            throw Invalid("requirements_unreviewed","Explicitly review unknown Receiving requirements before accepting material.");
        foreach(var requirement in new[]{(requirements.CocRequired==true,"coc","COC"),(requirements.MaterialCertRequired==true,"materialCert","MATERIAL_CERT"),
            (requirements.PoTraceabilityRequired,"traceability","TRACEABILITY"),(requirements.InspectionRequired==true,"specialInspection","INSPECTION")}) {
            if(requirement.Item1&&(!line.Checks.TryGetValue(requirement.Item2,out var result)||result!="PASS"||!docs.Any(d=>d.Kind==requirement.Item3)))
                throw Invalid("required_evidence","Required supplier/inspection evidence must be verified and its check passed before acceptance.");
        }
    }
    private static SimReceivingCoverage[] Allocate(SimPurchaseLine purchase,SimPurchasingView purchases,SimReceivingSnapshot snapshot,SimReceiveLineRequest line)
    {
        var requested=line.Coverage;
        if(requested is null||requested.Length==0) {
            if(purchase.Coverage.Length==1&&purchase.ExcessQuantity==0)
                requested=[new(purchase.Coverage[0].DemandId,line.AcceptedQuantity,line.CountedQuantity,line.HoldQuantity,line.RejectedQuantity)];
            else if(purchase.Coverage.Length>0)throw Invalid("coverage_allocation","Explicitly allocate received/disposition quantities across covered demands for multi-demand or excess purchases.");
            else requested=[];
        }
        if(requested.Select(c=>c.DemandId).Distinct().Count()!=requested.Length)throw Invalid("coverage_allocation","Demand allocations must be distinct.");
        var result=new List<SimReceivingCoverage>();
        foreach(var allocation in requested) {
            foreach(var q in new[]{allocation.Quantity,allocation.ReceivedQuantity,allocation.HoldQuantity,allocation.RejectedQuantity})Quantity(q);
            if(allocation.ReceivedQuantity!=allocation.Quantity+allocation.HoldQuantity+allocation.RejectedQuantity)throw Invalid("coverage_reconciliation","Each demand allocation must reconcile received, accepted, hold and rejected quantity.");
            var source=purchase.Coverage.SingleOrDefault(c=>c.DemandId==allocation.DemandId)??throw Invalid("coverage_scope","The demand is not covered by this purchase.");
            var prior=snapshot.Materials.Where(m=>m.PurchaseId==purchase.PurchaseId).SelectMany(m=>m.Coverage).Where(c=>c.DemandId==source.DemandId).Sum(c=>c.ReceivedQuantity);
            if(prior+allocation.ReceivedQuantity>source.Quantity)throw Invalid("coverage_overallocated","Receipt allocation exceeds this purchase's governed demand coverage.");
            if(allocation.Quantity>0) {
                var demand=purchases.Demands.SingleOrDefault(d=>d.DemandId==source.DemandId);
                if(demand is null||!demand.SourceCurrent||demand.SourceFingerprint!=source.SourceFingerprint)
                    throw Conflict("demand_changed","Demand evidence changed; hold material pending reviewed reconciliation rather than assigning usable material to stale demand.");
            }
            result.Add(new(source.DemandId,allocation.Quantity,allocation.ReceivedQuantity,allocation.HoldQuantity,allocation.RejectedQuantity,
                source.WorkOrderNumber,source.SalesOrderNumber,source.SalesOrderLineNumber));
        }
        if(requested.Sum(c=>c.ReceivedQuantity)>line.CountedQuantity||requested.Sum(c=>c.Quantity)>line.AcceptedQuantity||
            requested.Sum(c=>c.HoldQuantity)>line.HoldQuantity||requested.Sum(c=>c.RejectedQuantity)>line.RejectedQuantity)
            throw Invalid("coverage_reconciliation","Demand allocations exceed the receiving line's quantities.");
        var priorExcess=snapshot.Materials.Where(m=>m.PurchaseId==purchase.PurchaseId).Sum(m=>m.ReceivedQuantity-m.Coverage.Sum(c=>c.ReceivedQuantity));
        if(priorExcess+line.CountedQuantity-requested.Sum(c=>c.ReceivedQuantity)>purchase.ExcessQuantity)
            throw Invalid("coverage_reconciliation","Received demand material must be allocated; unassigned physical quantity cannot exceed the purchase's explicit excess.");
        return result.ToArray();
    }
    private Task<T> Command<T>(string action,Guid requestId,object request,SimPersona actor,
        Func<SimPurchasingView,SimReceivingSnapshot,DateTimeOffset,Task<SimReceivingChange<T>>> mutate)=>state.WithStableRuntime(async runtime=> {
            Permission(actor,true);if(requestId==Guid.Empty)throw Invalid("request_id","A UUID request ID is required for safe retries.");
            return await operations.ChangeReceiving(runtime,action,requestId,request,actor,UtcNow(),mutate);
        });
    private static SimReceivingEvent Event(string type,string key,string entity,SimPersona actor,DateTimeOffset now,long expected,long result,object detail)=>
        new(Guid.NewGuid(),type,key,entity,actor.Id,actor.DisplayName,now,expected,result,JsonSerializer.SerializeToElement(detail,SimPurchasingService.Json));
    private static void Version(long actual,long expected){if(actual!=expected)throw Conflict("receiving_version_changed","Receiving changed. Refresh before continuing; no quantities were recorded.");}
    private static void Quantity(decimal value){if(value<0||value>1000000000m||decimal.Round(value,6)!=value)throw Invalid("quantity","Use nonnegative quantities with at most six decimal places.");}
    private static string Clean(string? value,int limit){var text=(value??"").Trim();if(text.Length>limit)throw Invalid("text_length","Receiving text is too long.");return text;}
    private static string Required(string? value,int limit,string message){var text=Clean(value,limit);if(text.Length==0)throw Invalid("required",message);return text;}
    private static string Date(string value){if(!DateOnly.TryParseExact(value,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out _))throw Invalid("date_only","Enter a valid date-only YYYY-MM-DD value.");return value;}
    private static SimPurchasingProblem Invalid(string code,string message)=>SimPurchasingProblem.Invalid(code,message);
    private static SimPurchasingProblem Conflict(string code,string message)=>SimPurchasingProblem.Conflict(code,message);
}
