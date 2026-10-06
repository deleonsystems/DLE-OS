using System.Text.Json;
using Microsoft.Data.Sqlite;

internal sealed partial class SimProductionService
{
    private static void ShippingPermission(SimPersona actor,string permission){if(!actor.Can(permission))throw new SimOrderEntryPermissionException();}
    private Task<T> ShippingSource<T>(string wo,Func<SimProductionSource,SimStateMetadata,Task<T>> action)=>
        state.WithStableRuntime(r=>WithVerifiedSource(wo,r,action));
    internal Task<SimShippingSnapshot> ReadShipping(string wo,SimPersona actor){
        if(!actor.Can("shipments.view")&&!actor.Can("production.view"))throw new SimOrderEntryPermissionException();
        return ShippingSource(wo,async(s,r)=>{
            var accepted=await ShippingAccepted(s);return await store.ShippingTransaction(false,(c,t)=>ShippingSnapshot(c,t,s,r,accepted,actor));
        });
    }
    private async Task<JsonElement> ShippingAccepted(SimProductionSource s){
        var id=Text(Field(s.Package,"source"),"acceptedIntakeId");var record=(SimRfqIntakeRecord)(await intakes.ReadAsync(id))!;
        return JsonSerializer.SerializeToElement(record.OrderEntry!.Acceptance.Package,Json);
    }
    private static string ClearanceSource(SimProductionSource s,SimWoTravelerRevision route,JsonElement erp)=>Hash(new{
        s.Token,route.Id,route.Version,route.Operations,route.OperationContent,
        wo=Text(Field(erp,"workOrder"),"workOrderNumber"),so=Text(Field(erp,"line"),"salesOrderLineId"),
        customer=Text(Field(erp,"line"),"customerNumber"),part=Text(Field(erp,"line"),"itemNumber"),rev=Text(Field(erp,"line"),"drawingRevision")});
    private async Task<SimShippingSnapshot> ShippingSnapshot(SqliteConnection c,SqliteTransaction t,SimProductionSource s,
        SimStateMetadata r,JsonElement accepted,SimPersona actor){
        var wo=Text(s.Package,"workOrderNumber");
        await ValidateCase(c,t,s,r);
        var bound=await SimProductionStore.One<SimWoTraveler>(c,t,"SimWoTraveler",wo,r.Generation);
        var revisions=await SimProductionStore.ReadRevisions(c,t,wo,r.Generation);
        var traveler=RevisionView(bound,revisions,s).Effective;
        Require(traveler is not null&&traveler.SourceToken==s.Token,"shipping_traveler_required","An effective approved, bound Traveler with verified source is required.");
        var erp=await SimProductionStore.ShippingErp(c,t,wo);var line=Field(erp,"line");var work=Field(erp,"workOrder");
        var remaining=Number(line,"erpQuantityOpen");Require(remaining is >=0,"shipping_remaining_unknown","Verified remaining fulfillment quantity is required.");
        var history=await SimProductionStore.ShippingEvents(c,t,wo,r.Generation);
        var clearances=history.Where(e=>e.Clearance is not null).Select(e=>e.Clearance!).GroupBy(x=>x.Id).Select(g=>g.Last()).ToArray();
        var auth=history.Where(e=>e.Authorization is not null).Select(e=>e.Authorization!).GroupBy(x=>x.Id).Select(g=>g.Last()).ToArray();
        var reserved=auth.Where(x=>x.State!="REVOKED").Sum(x=>x.Quantity);
        var lineage=ClearanceSource(s,traveler!,erp);
        var material=s.Case?.State??"UNKNOWN";
        var execution=await SimProductionStore.ExecutionExists(c,t,wo)||traveler!.Operations.Any(x=>x.ExecutionState!="NOT_STARTED");
        var current=material=="KIT_COMPLETE"&&reserved<=remaining&&clearances.Where(x=>x.State!="REVOKED").All(x=>x.SourceToken==lineage);
        var available=current?Math.Max(0,Math.Min(remaining!.Value-reserved,clearances.Where(x=>x.State=="CLEARED_FOR_PACKAGING").Sum(x=>Math.Max(0,x.Quantity-auth.Where(a=>a.ClearanceId==x.Id&&a.State!="REVOKED").Sum(a=>a.Quantity))))):0;
        var context=ShippingContext(s,accepted,line,work,traveler!,lineage);
        var version=history.LastOrDefault()?.Sequence??0;
        var token=Hash(new{r.Generation,s.Token,erp,traveler!.Id,travelerVersion=traveler.Version,version,material,execution,caseVersion=s.Case?.WorkingVersion});
        return new(wo,token,version,context,traveler,remaining!.Value,available,clearances,auth,history,
            actor.Can("production.manage")&&r.Environment=="SIM"&&wo=="0999999"&&traveler.Version==1&&material=="KIT_COMPLETE"&&clearances.Length==0&&!execution,
            actor.Can("shipments.release"),current,material,execution?"EXECUTION_REVIEW_REQUIRED":Status(material,true),execution?"EVIDENCE_EXISTS":"NOT_STARTED",
            actor.Can("shipments.stage")&&r.Environment=="SIM"&&wo=="0999999"&&current&&!execution&&auth.Any(a=>EligibleSimDeparture(a,clearances,context,remaining!.Value)));
    }
    private static bool EligibleSimDeparture(SimShipmentAuthorization a,SimProductionClearance[] clearances,JsonElement context,decimal remaining)=>
        a.State=="RELEASED"&&a.Departure is null&&a.Quantity==10&&a.Quantity==remaining&&
        Text(Field(Field(context,"source"),"quote"),"quoteNumber")=="SIM-Q-0042-R01"&&
        clearances.Any(c=>c.Id==a.ClearanceId&&c.State=="CLEARED_FOR_PACKAGING"&&c.SourceMode=="SIMULATED_DEVELOPMENTAL"&&c.Quantity==a.Quantity&&c.TravelerVersion==1);
    internal Task<SimShippingSnapshot> ConfirmSimDeparture(string wo,Guid id,SimShippingConfirm request,SimPersona actor)=>
        ShippingChange(wo,request.RequestId,request.ExpectedToken,new{id,request},actor,"shipments.stage",(v,s,r)=>{
            Require(r.Environment=="SIM"&&wo=="0999999","shipping_sim_scope","Departure recording is limited to the approved developmental SIM scenario; real dispatch is unavailable.");
            var a=v.Authorizations.SingleOrDefault(x=>x.Id==id);
            Require(a is not null&&a.Version==request.ExpectedVersion&&a.State=="RELEASED"&&a.Departure is null,"shipping_version","Authorization changed or this SIM departure was already recorded. Refresh the job.");
            Require(v.CanConfirmSimDeparture&&EligibleSimDeparture(a!,v.Clearances,v.Context,v.RemainingFulfillment),"shipping_departure_unavailable","A current full-quantity developmental authorization with no Production execution is required.");
            return(null,a! with{Version=a.Version+1,State="SIM_SHIPPED_AWAITING_INVOICE",Departure=new("SIMULATED_DEVELOPMENTAL",a.Quantity,actor.Id,actor.DisplayName,UtcNow())},"SIM_DEPARTURE_RECORDED");
        });
    private static JsonElement ShippingContext(SimProductionSource s,JsonElement accepted,JsonElement line,JsonElement work,SimWoTravelerRevision route,string lineage){
        var questionnaire=Field(accepted,"questionnaire");
        var reviews=Field(accepted,"poFactReviews");var evidence=reviews.ValueKind==JsonValueKind.Array
            ?reviews.EnumerateArray().Select(x=>Field(Field(x,"extraction"),"fields")).ToArray():[];
        var requirements=evidence.Select(x=>Field(x,"requirements")).Where(x=>x.ValueKind==JsonValueKind.Object).ToArray();
        var shipping=evidence.Select(x=>Field(x,"shipping")).Where(x=>x.ValueKind==JsonValueKind.Object).ToArray();
        var words=string.Join("\n",requirements.Select(x=>Text(x,"value")));
        var aero=Field(questionnaire,"aerospaceRequirements");
        bool Certificate(string key)=>aero.ValueKind==JsonValueKind.Array&&aero.EnumerateArray().Any(x=>x.GetString()==key);
        return JsonSerializer.SerializeToElement(new{
            workOrderNumber=Text(work,"workOrderNumber"),salesOrderNumber=Text(line,"salesOrderNumber"),lineNumber=Text(line,"lineNumber"),
            customer=Text(line,"customerName"),customerNumber=Text(line,"customerNumber"),customerPo=Text(accepted,"poNumber"),
            assembly=Text(line,"itemNumber"),revision=Text(line,"drawingRevision"),uom=Text(work,"unitOfMeasure"),
            customerDueDate=Field(s.Package,"context").GetProperty("customerDueDate"),shipTo=Field(questionnaire,"shipTo"),
            source=s.Package.GetProperty("source"),sourceFingerprint=lineage,travelerId=route.TravelerId,travelerVersion=route.Version,
            requiredDocuments=new{
                customerCoC=Certificate("CERTIFICATE_OF_CONFORMANCE")?"REQUIRED":"NOT_ESTABLISHED",
                serialList=words.Contains("serial",StringComparison.OrdinalIgnoreCase)&&words.Contains("list",StringComparison.OrdinalIgnoreCase)?"REQUIRED_BY_RETAINED_PO_EVIDENCE":"NOT_ESTABLISHED",
                testResults=words.Contains("T1",StringComparison.OrdinalIgnoreCase)&&words.Contains("T6",StringComparison.OrdinalIgnoreCase)?"REQUIRED_BY_RETAINED_PO_EVIDENCE":"NOT_ESTABLISHED",
                fai=Certificate("FIRST_ARTICLE_INSPECTION")?"REQUIRED":"NOT_ESTABLISHED"},
            requirementsEvidence=requirements,shippingMethod=new{status="REVIEW_REQUIRED",questionnaire=Text(questionnaire,"shippingMethod"),poEvidence=shipping,
                note="Shipping method must be explicitly reviewed before future dispatch. Authorization does not resolve conflicting evidence."},
            poEvidence=Field(accepted,"poEvidence"),technicalDocuments=Field(s.Package,"technicalDocuments")
        },Json);
    }
    internal async Task<object> ShippingQueue(SimPersona actor){
        ShippingPermission(actor,"shipments.view");var r=state.Current.Metadata!;var rows=new List<object>();
        foreach(var wo in await store.ShippingWorkOrders(r.Generation)){
            try{rows.Add(await ReadShipping(wo,actor));}
            catch(Exception e) when(e is KittingCaseProblem or SimRfqIntakeProblem){
                // Retain already-authorized work visibly on hold even when its upstream source fails validation.
                var history=await store.ShippingTransaction(false,(c,t)=>SimProductionStore.ShippingEvents(c,t,wo,r.Generation));
                var clearances=history.Where(x=>x.Clearance is not null).Select(x=>x.Clearance!).GroupBy(x=>x.Id).Select(x=>x.Last()).ToArray();
                var authorizations=history.Where(x=>x.Authorization is not null).Select(x=>x.Authorization!).GroupBy(x=>x.Id).Select(x=>x.Last()).ToArray();
                if(authorizations.Length==0)rows.Add(new{workOrderNumber=wo,unavailable=true,message=e.Message});
                else rows.Add(new{workOrderNumber=wo,sourceCurrent=false,sourceError=e.Message,availableToRelease=0,clearances,authorizations});
            }
        }
        return new{rows,canRelease=actor.Can("shipments.release")};
    }
    private Task<SimShippingSnapshot> ShippingChange(string wo,Guid requestId,string expected,object request,SimPersona actor,string permission,
        Func<SimShippingSnapshot,SimProductionSource,SimStateMetadata,(SimProductionClearance? Clearance,SimShipmentAuthorization? Authorization,string Action)> change){
        ShippingPermission(actor,permission);
        Require(requestId!=Guid.Empty,"shipping_request_id","A unique request identifier is required.");
        return ShippingSource(wo,async(s,r)=>{
            var accepted=await ShippingAccepted(s);
            return await store.ShippingTransaction(true,async(c,t)=>{
                var current=await ShippingSnapshot(c,t,s,r,accepted,actor);var hash=Hash(new{request,actor.Id,permission});
                var prior=current.History.SingleOrDefault(e=>e.RequestId==requestId);
                if(prior is not null){Require(prior.RequestHash==hash,"shipping_idempotency_conflict","That request identifier belongs to a different command.");return current;}
                Require(current.Token==expected,"shipping_stale","The clearance, remaining quantity or source changed. Refresh before continuing.");
                var next=change(current,s,r);
                await SimProductionStore.ShippingEvent(c,t,new(Guid.NewGuid(),current.WorkOrderNumber,r.Generation,current.Version+1,requestId,hash,
                    next.Action,actor.Id,actor.DisplayName,UtcNow(),expected,next.Clearance,next.Authorization));
                return await ShippingSnapshot(c,t,s,r,accepted,actor);
            });
        });
    }
    private static void ShippingReason(string? reason)=>Require(!string.IsNullOrWhiteSpace(reason)&&reason.Length<=2000,"shipping_reason","A reviewed reason of at most 2,000 characters is required.");
    internal Task<SimShippingSnapshot> CreateClearance(string wo,SimClearanceCreate request,SimPersona actor)=>ShippingChange(wo,request.RequestId,request.ExpectedToken,request,actor,"production.manage",(v,s,r)=>{
        ShippingReason(request.Reason);Require(request.SourceMode=="SIMULATED_DEVELOPMENTAL","shipping_execution_unavailable","Real execution clearance is not implemented. No operation completion may be inferred.");
        Require(v.CanCreateClearance&&Text(Field(Field(v.Context,"source"),"quote"),"quoteNumber")=="SIM-Q-0042-R01","shipping_sim_scope","Developmental clearance is limited to the reviewed E2E-SIM-001 Work Order and Traveler v1, once only.");
        Require(request.Quantity>0&&request.Quantity<=v.RemainingFulfillment&&request.Quantity<=(Number(Field(s.Package,"context"),"quantity")??0),"shipping_quantity","Cleared quantity must be positive and within the accepted and remaining quantity.");
        var route=v.Traveler.Operations.Where(x=>x.Enabled&&x.Classification=="PRODUCTION").OrderBy(x=>x.Sequence).ToArray();
        // Explicit stable operation identities define the gate. Never classify a route by operation name.
        Require(route.Length>=2&&route[^1].Id==request.PackagingOperationId&&route[^2].Id==request.GateOperationId,"shipping_gate","Select the governed final operation and its immediate pre-packaging gate by identity.");
        Require(route.All(x=>x.ExecutionState=="NOT_STARTED"),"shipping_execution_exists","Developmental clearance must not stand in for real execution evidence.");
        return(new(Guid.NewGuid(),v.WorkOrderNumber,r.Generation,1,"CLEARED_FOR_PACKAGING",request.Quantity,request.SourceMode,
            v.Traveler.TravelerId,v.Traveler.Id,v.Traveler.Version,Text(v.Context,"sourceFingerprint"),route[^2],route[^1],actor.Id,actor.DisplayName,UtcNow(),request.Reason,v.Context,[]),null,"DEVELOPMENTAL_CLEARANCE_CREATED");
    });
    internal Task<SimShippingSnapshot> AuthorizeShipment(string wo,SimAuthorizationCreate request,SimPersona actor)=>ShippingChange(wo,request.RequestId,request.ExpectedToken,request,actor,"shipments.release",(v,s,r)=>{
        ShippingReason(request.Reason);Require(!string.IsNullOrWhiteSpace(request.RequestedShipWindow)&&request.RequestedShipWindow.Length<=200,"shipping_window","Record a requested ship date/window or explicitly state that it is not set.");
        var clearance=v.Clearances.SingleOrDefault(x=>x.Id==request.ClearanceId);
        Require(v.SourceCurrent&&clearance?.State=="CLEARED_FOR_PACKAGING","shipping_clearance_required","Current, unheld Production clearance is required.");
        var used=v.Authorizations.Where(x=>x.ClearanceId==clearance!.Id&&x.State!="REVOKED").Sum(x=>x.Quantity);
        Require(request.Quantity>0&&request.Quantity<=v.AvailableToRelease&&request.Quantity<=clearance!.Quantity-used,"shipping_quantity","Authorization exceeds the available cleared or remaining fulfillment quantity.");
        return(null,new(Guid.NewGuid(),v.WorkOrderNumber,r.Generation,1,"RELEASED",request.Quantity,clearance!.Id,clearance.Version,
            request.RequestedShipWindow,actor.Id,actor.DisplayName,UtcNow(),request.Reason,v.Context),"SHIPMENT_AUTHORIZATION_RELEASED");
    });
    internal Task<SimShippingSnapshot> DispositionShipping(string wo,Guid id,bool clearance,SimShippingDisposition request,SimPersona actor)=>
        ShippingChange(wo,request.RequestId,request.ExpectedToken,new{id,clearance,request},actor,clearance?"production.manage":"shipments.release",(v,s,r)=>{
            ShippingReason(request.Reason);Require(request.State is "HELD" or "REVOKED","shipping_disposition","Only explicit Hold or Revoke is supported in this slice.");
            if(clearance){var old=v.Clearances.SingleOrDefault(x=>x.Id==id);Require(old is not null&&old.Version==request.ExpectedVersion&&old.State!="REVOKED"&&old.State!=request.State,"shipping_version","Clearance changed or is already revoked.");
                return(old! with{Version=old.Version+1,State=request.State,Reason=request.Reason},null,"CLEARANCE_"+request.State);}
            var a=v.Authorizations.SingleOrDefault(x=>x.Id==id);Require(a is not null&&a.Version==request.ExpectedVersion&&a.State!="REVOKED"&&a.Departure is null&&a.State!=request.State,"shipping_version","Authorization changed, is already revoked, or has a recorded SIM departure.");
            return(null,a! with{Version=a.Version+1,State=request.State,Reason=request.Reason},"AUTHORIZATION_"+request.State);
        });
}
