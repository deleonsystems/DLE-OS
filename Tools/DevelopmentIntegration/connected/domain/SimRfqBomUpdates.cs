using System.Text.Json;

// The original receipt and frozen packages never change. One atomic lane write
// records explicit adoption, preserved work and the new working baseline.
internal sealed record SimBomUpdateCommand(string ExpectedToken,string PackageId,string? GoverningDocumentId=null);
internal sealed record SimBomAdoptCommand(string ExpectedToken,string RequestId);
internal sealed record SimBomAdoption(int Version,string Id,string RequestToken,string BatchId,string BatchHash,
    SimLibraryRfqBinding From,SimLibraryRfqBinding To,SimMaterialPartActor Actor,DateTimeOffset AtUtc,
    bool MaterialsRecheck,bool LaborRecheck,string[] AffectedFinds,SimMaterialRow[] RemovedMaterialRows,string ContentHash);
internal sealed record SimBomComparison(string Find,string RowId,string[] BeforeParts,string[] AfterParts,
    string BeforeQuantity,string AfterQuantity,string BeforeUnit,string AfterUnit,string Change,string BeforeInternalPartNumber,string AfterInternalPartNumber);

internal sealed partial class SimLibraryBomStore
{
    internal async Task<object> WithBomUpdatePackages(SimLibraryRfqBinding binding,Func<LibraryPackageVersion[],Task<object>> action)
    {
        await gate.WaitAsync();try{
            var packages=ReadPackages(binding.LibraryKey);var old=packages.Versions.SingleOrDefault(p=>p.Id==binding.PackageId);
            Require(old is not null&&old.Status=="APPROVED"&&old.ContentHash==binding.PackageHash&&old.Bom.Id==binding.BomId&&old.Bom.InternalVersion==binding.BomVersion&&old.Version==binding.PackageVersion&&old.ReviewedBy is not null,"The request's original approved baseline cannot be verified.");
            var result=packages.Versions.Where(p=>p.Preparation?.Id==binding.PreparationId&&p.Preparation.ProjectId==binding.ProjectId&&p.Preparation.DisplayId==binding.DisplayId&&p.Preparation.IntakeId==binding.ParentIntakeId&&p.Preparation.LineNumber==binding.LineNumber&&p.Preparation.SourceFingerprint==old!.Preparation?.SourceFingerprint&&p.Preparation.IncomingRevision==old.Preparation?.IncomingRevision&&p.Preparation.RequestedQuantity==old.Preparation?.RequestedQuantity&&p.Preparation.RequestedScope==old.Preparation?.RequestedScope&&p.Bom.DrawingRevision==old.Bom.DrawingRevision&&p.Bom.BomRevision==old.Bom.BomRevision).ToArray();
            foreach(var p in result){VerifyPackage(p);if(p.Status=="APPROVED"){await VerifyEvidence(p.Bom);foreach(var doc in p.Documents)await PackageEvidenceBytes(doc);}}
            return await action(result);
        }finally{gate.Release();}
    }
}

internal sealed partial class SimRfqIntakeStore
{
    internal Func<SimLibraryRfqBinding,Func<LibraryPackageVersion[],Task<object>>,Task<object>>? LibraryBomUpdateSource {get;set;}
    // New routed requests deliberately omit the retired blanket attestation.
    // They still require recorded TR routing, exact final approval and explicit
    // adoption below. An explicit legacy restriction and customer route stay closed.
    internal static bool SupportsInternalBomRoute(int version,string? purpose,string route,bool? legacyAttestation) => purpose=="INTERNAL_BOM_UPDATE" && route=="TECHNICAL_REVIEW" && (legacyAttestation==true || legacyAttestation is null && version is 2 or 3);
    internal Action? BeforeBomAdoptionCommit {get;set;} // isolated failure-injection only
    private static void BomUpdatePermission(SimPersona p,bool write=false)
    {if(!p.IsActive||!p.Can(write?"technical_review.disposition":"rfq.view"))throw new LibraryBomPermissionException();}
    private static string AdoptionHash(SimBomAdoption a)=>PartHash(a with{ContentHash=""});
    private static SimLibraryRfqBinding EffectiveBinding(SimLibraryRfqReceipt original,SimRfqLanes lanes)
    {
        var binding=original.Binding;var version=0;
        foreach(var a in lanes.BomAdoptions??[]){
            PartRequire(a.Version==++version&&a.ContentHash==AdoptionHash(a)&&a.From==binding&&a.To.ProjectId==original.Binding.ProjectId&&a.To.LibraryKey==original.Binding.LibraryKey&&a.To.PreparationId==original.Binding.PreparationId&&a.To.ParentIntakeId==original.Binding.ParentIntakeId&&a.To.DisplayId==original.Binding.DisplayId&&a.To.LineNumber==original.Binding.LineNumber&&a.To.PackageVersion>a.From.PackageVersion,"BOM_UPDATE_INTEGRITY","The saved BOM adoption history cannot be verified.");
            binding=a.To;
        }
        return binding;
    }
    private async Task<SimLibraryRfqReceipt> EffectiveRfqReceipt(SimLibraryRfqReceipt original)
    {var lane=(await ReadRfqLanes()).GetValueOrDefault(original.Binding.DisplayId)??new(new(),new());return original with{Binding=EffectiveBinding(original,lane)};}
    private async Task<SimRfqIntakeRecord> EstimateRecordForPair(SimRfqIntakeRecord current,SimEstimatePair pair)
    {
        var receipt=await RfqReceiptByDisplay(pair.RfqId);EstimateRequire(receipt is not null&&LibraryRfqPackageRead is not null&&receipt.Binding.ProjectId==pair.Binding.ProjectId&&receipt.Binding.LibraryKey==pair.Binding.LibraryKey&&receipt.Binding.PreparationId==pair.Binding.PreparationId,"The historical estimate package association cannot be verified.");
        return BuildLibraryRfqRecord(receipt! with{Binding=pair.Binding},await LibraryRfqPackageRead!(pair.Binding));
    }
    private static SimMaterialPartAction? LinkedBomResult(SimMaterialPartActions actions)=>actions.History.LastOrDefault(a=>a.Action=="LINK_APPROVED_RESULT"&&a.ApprovedResult is not null);
    private async Task<string?> PartBomUpdateStatus(SimMaterialPartBatch batch,SimMaterialPartActions actions,bool current)
    {
        var lane=(await ReadRfqLanes()).GetValueOrDefault(batch.RfqId);
        var adoption=lane?.BomAdoptions?.LastOrDefault(a=>a.BatchId==batch.Id&&a.BatchHash==batch.ContentHash);
        if(adoption is not null){PartRequire(adoption.ContentHash==AdoptionHash(adoption),"BOM_UPDATE_INTEGRITY","The saved adoption cannot be verified.");return "ADOPTED";}
        if(current&&LinkedBomResult(actions) is {} result&&!actions.History.Any(a=>a.Action=="CANCEL")){
            try{if(LibraryRfqPackageRead is not null){_=await LibraryRfqPackageRead(result.ApprovedResult!);return "APPROVED_UPDATE_AVAILABLE";}}
            catch(Exception e)when(e is IOException or SimRfqIntakeProblem or JsonException){return null;}
        }
        return null;
    }
    private static bool BomResultMatches(SimMaterialPartBatch batch,SimMaterialPartActions history,LibraryPackageVersion package)
    {
        var old=batch.Baseline.LibraryPackage;var routed=history.History.LastOrDefault(a=>a.Action=="SEND_TO_LIBRARY");var p=package.Preparation;
        if(old is null||routed is null||history.History.Any(a=>a.Action=="CANCEL")||package.Status!="APPROVED"||package.ReviewedBy is null||package.Version<=old.PackageVersion||package.SubmittedBy.AtUtc<routed.AtUtc||p is null||p.Id!=old.PreparationId||p.ProjectId!=old.ProjectId||p.IntakeId!=old.ParentIntakeId||p.LineNumber!=old.LineNumber||p.DisplayId!=batch.RfqId||p.IncomingRevision!=batch.Revision||p.RequestedQuantity!=batch.Baseline.Quantity||package.Bom.AssemblyNumber!=batch.AssemblyNumber)return false;
        // Exact approved membership, never inferred suffix/hyphen equivalence.
        var projected=BuildLibraryRfqRecord(new("",old with{PackageId=package.Id,PackageVersion=package.Version,PackageHash=package.ContentHash,BomId=package.Bom.Id,BomVersion=package.Bom.InternalVersion},new("","","",""),new(1,batch.AssemblyNumber,batch.Revision,batch.Baseline.Quantity),"",[],"",default,"",0,"MATERIAL_ONLY","",default,""),package);
        return batch.Items.All(i=>i.Intent=="PROPOSED_PART"&&!string.IsNullOrWhiteSpace(i.QuotedPartNumber)&&projected.TechnicalReview!.Workflow!.Outputs!.Materials.Candidate.Rows.Count(r=>r.RowId==i.RowId&&r.Values.GetValueOrDefault("lineNumber")==i.Find&&PartRowEligible(r)&&MaterialIdentityChoices(r).Contains(i.QuotedPartNumber,StringComparer.Ordinal))==1);
    }
    private static SimLibraryRfqBinding ResultBinding(SimLibraryRfqBinding priorBinding,LibraryPackageVersion p,string governing)=>priorBinding with{PackageId=p.Id,PackageVersion=p.Version,PackageHash=p.ContentHash,BomId=p.Bom.Id,BomVersion=p.Bom.InternalVersion,GoverningDocumentId=governing};
    private static string RowBusiness(SimCandidateRow r)=>PartHash(new{r.RowId,r.ComponentType,r.Values,Parts=MaterialIdentityChoices(r).Order(StringComparer.Ordinal).ToArray()});
    private static SimBomComparison[] BomComparison(SimRfqIntakeRecord before,SimRfqIntakeRecord after)
    {
        var a=before.TechnicalReview!.Workflow!.Outputs!.Materials.Candidate.Rows;var b=after.TechnicalReview!.Workflow!.Outputs!.Materials.Candidate.Rows;
        PartRequire(a.Select(r=>r.RowId).Distinct().Count()==a.Length&&b.Select(r=>r.RowId).Distinct().Count()==b.Length,"BOM_UPDATE_ROWS","BOM row identities need review before adoption.");
        return a.Select(r=>r.RowId).Union(b.Select(r=>r.RowId)).Select(id=>{var x=a.SingleOrDefault(r=>r.RowId==id);var y=b.SingleOrDefault(r=>r.RowId==id);return new SimBomComparison(y?.Values.GetValueOrDefault("lineNumber")??x!.Values.GetValueOrDefault("lineNumber")??"",id??"",x is null?[]:MaterialIdentityChoices(x),y is null?[]:MaterialIdentityChoices(y),x?.Values.GetValueOrDefault("quantity")??"",y?.Values.GetValueOrDefault("quantity")??"",x?.Values.GetValueOrDefault("unit")??"",y?.Values.GetValueOrDefault("unit")??"",x is null?"Added":y is null?"Removed":RowBusiness(x)==RowBusiness(y)?"Unchanged":"Changed",x?.Values.GetValueOrDefault("partNumber")??"",y?.Values.GetValueOrDefault("partNumber")??"");}).ToArray();
    }
    private async Task<object> WithBomUpdate(string id,Func<SimLibraryRfqReceipt,SimRfqIntakeRecord,SimRfqLanes,SimMaterialPartBatch,SimMaterialPartActions,LibraryPackageVersion[],Task<object>> action,string? batchId=null)
    {
        var original=await RfqReceiptByDisplay(id)??throw SimRfqIntakeProblem.Conflict("BOM_UPDATE_SCOPE","BOM adoption is available for an independent Library-backed RFQ line.");
        var lanes=(await ReadRfqLanes()).GetValueOrDefault(id)??new(new(),new());var effective=original with{Binding=EffectiveBinding(original,lanes)};
        var record=BuildLibraryRfqRecord(effective,await LibraryRfqPackageRead!(effective.Binding));
        var batch=await ReadPartBatch(batchId??throw SimRfqIntakeProblem.BadRequest("BOM_UPDATE_REQUEST","Choose the original part-change request."));
        PartRequire(batch.RfqId==id&&batch.Baseline.LibraryPackage is not null&&SupportsInternalBomRoute(batch.ContractVersion,batch.Purpose,batch.Route,batch.RequirementsPermitInternal)&&batch.RequestCorrelationId==record.RequestCorrelationId&&batch.Baseline.ScenarioId==record.ScenarioId&&batch.Baseline.Generation==record.Generation,"BOM_UPDATE_SCOPE","This change request belongs to a different RFQ baseline or customer route.");
        var actions=await ReadPartActions(batch);PartRequire(LibraryBomUpdateSource is not null,"BOM_UPDATE_UNAVAILABLE","BOM update support needs SIM activation.");
        return await LibraryBomUpdateSource!(batch.Baseline.LibraryPackage!,packages=>action(original,record,lanes,batch,actions,packages));
    }
    internal async Task<object> ReadBomResults(string batchId,SimPersona persona)
    {
        PartPermission(persona,"technical-review");await gate.WaitAsync();try{
            var batch=await ReadPartBatch(batchId);
            return await WithBomUpdate(batch.RfqId,async(original,record,lanes,b,actions,packages)=>{
                var view=await PartViewWithoutLibrary(b,actions,record,lanes);var eligible=packages.Where(p=>BomResultMatches(b,actions,p)).ToArray();
                var latest=packages.LastOrDefault();eligible=eligible.Where(p=>p.Id==latest?.Id).ToArray();
                return new{token=PartHash(new{view.Token,Packages=PartHash(packages),Lanes=PartHash(lanes)}),canLink=persona.Can("technical_review.disposition")&&view.Current&&view.Status is "IN_LIBRARY" or "APPROVED_UPDATE_AVAILABLE"&&LinkedBomResult(actions)?.ApprovedResult?.PackageId!=latest?.Id,items=eligible.Select(p=>new{packageId=p.Id,version=p.Version,bomVersion=p.Bom.InternalVersion,governingDocuments=RfqGoverningChoices(p).Select(d=>new{id=d.Identification.Id,name=Path.GetFileName(d.Identification.Source.RelativePath)}).ToArray(),governingDocumentId=RfqGoverningChoices(p).Any(d=>d.Identification.Id==record.LibraryRfq!.GoverningDocumentId)?record.LibraryRfq!.GoverningDocumentId:RfqGoverningChoices(p).Length==1?RfqGoverningChoices(p)[0].Identification.Id:null}),linked=LinkedBomResult(actions)?.ApprovedResult};
            },batchId);
        }finally{gate.Release();}
    }
    // Unlike PartView, this helper never re-enters the Library gate held by callbacks.
    private Task<(string Token,bool Current,string Status)> PartViewWithoutLibrary(SimMaterialPartBatch b,SimMaterialPartActions a,SimRfqIntakeRecord r,SimRfqLanes lanes)
    {
        var material=MaterialView(RfqView(r,new(){{r.IntakeId,lanes}}));var baseline=PartBaseline(r,material);var items=PartItems(material,baseline);
        var current=PartHash(b.Baseline)==PartHash(baseline)&&b.Items.All(i=>items.Any(c=>c.CurrentItemToken==i.CurrentItemToken&&c.RowId==i.RowId));
        var status=lanes.BomAdoptions?.Any(x=>x.BatchId==b.Id)==true?"ADOPTED":!current?"SUPERSEDED":LinkedBomResult(a) is not null?"APPROVED_UPDATE_AVAILABLE":PartStatus(b,a);
        return Task.FromResult((PartViewToken(b,a),current,status));
    }
    internal async Task<object> LinkBomResult(string batchId,SimBomUpdateCommand command,SimPersona persona)
    {
        PartPermission(persona,"technical-review",true);await gate.WaitAsync();try{
            var batch=await ReadPartBatch(batchId);
            return await WithBomUpdate(batch.RfqId,async(original,record,lanes,b,actions,packages)=>{
                var view=await PartViewWithoutLibrary(b,actions,record,lanes);var selected=packages.SingleOrDefault(p=>p.Id==command.PackageId);
                PartRequire(view.Current&&view.Status is "IN_LIBRARY" or "APPROVED_UPDATE_AVAILABLE"&&selected is not null&&packages.LastOrDefault()?.Id==selected.Id&&BomResultMatches(b,actions,selected),"BOM_UPDATE_RESULT","Choose the latest final-approved package that resolves the exact requested parts on this assembly/revision.");
                var choices=RfqGoverningChoices(selected!);var governing=command.GoverningDocumentId??record.LibraryRfq!.GoverningDocumentId;
                PartRequire(original.Scope=="MATERIAL_ONLY"&&governing==""||choices.Any(d=>d.Identification.Id==governing),"BOM_UPDATE_DRAWING","Choose the exact approved production drawing for this result.");
                var binding=ResultBinding(record.LibraryRfq!,selected!,governing);
                if(actions.History.LastOrDefault() is {} last&&last.Action=="LINK_APPROVED_RESULT"&&last.ApprovedResult==binding)return new{linked=true,duplicate=true,binding};
                PartRequire(command.ExpectedToken==PartHash(new{view.Token,Packages=PartHash(packages),Lanes=PartHash(lanes)}),"BOM_UPDATE_STALE","Request, Library package or RFQ work changed. Reopen the result before linking.");
                var next=actions with{History=[..actions.History,new(actions.History.Length+1,"LINK_APPROVED_RESULT","Exact final-approved result linked; RFQ adoption pending.",new(persona.Id,persona.DisplayName),DateTimeOffset.UtcNow,command.ExpectedToken,binding)]};next=next with{ContentHash=PartActionHash(next)};await WritePartRecord(PartActionPath(b.Id),next,true);
                return new{linked=true,duplicate=false,binding};
            },batchId);
        }finally{gate.Release();}
    }
    private async Task<object> BomPreviewCore(string id,string batchId,SimPersona persona,SimBomAdoptCommand? adopt=null)
    {
        return await WithBomUpdate(id,async(original,record,lanes,b,actions,packages)=>{
            var linked=LinkedBomResult(actions);PartRequire(linked?.ApprovedResult is not null,"BOM_UPDATE_PENDING","The final-approved result has not been linked by Technical Review yet.");
            var binding=linked!.ApprovedResult!;var package=packages.SingleOrDefault(p=>p.Id==binding.PackageId);var previous=lanes.BomAdoptions?.SingleOrDefault(a=>a.BatchId==batchId);
            if(previous is not null){
                PartRequire(previous.ContentHash==AdoptionHash(previous)&&previous.To==binding,"BOM_UPDATE_INTEGRITY","The adoption result cannot be verified.");
                if(adopt is not null)PartRequire(previous.Id==adopt.RequestId&&previous.RequestToken==adopt.ExpectedToken&&previous.Actor.Id==persona.Id&&record.LibraryRfq==previous.To,"BOM_UPDATE_ALREADY_ADOPTED","This request was already adopted. Reopen its recorded result.");
                return new{status="ADOPTED",adopted=true,duplicate=adopt is not null,adoption=previous};
            }
            var current=await PartViewWithoutLibrary(b,actions,record,lanes);
            PartRequire(current.Current&&current.Status=="APPROVED_UPDATE_AVAILABLE"&&b.Baseline.LibraryPackage==record.LibraryRfq&&package is not null&&packages.LastOrDefault()?.Id==package.Id&&BomResultMatches(b,actions,package)&&binding.PackageHash==package.ContentHash&&binding.BomId==package.Bom.Id&&binding.BomVersion==package.Bom.InternalVersion,"BOM_UPDATE_STALE","The request, selected result or current RFQ baseline changed. Reopen for review; no baseline was replaced.");
            var effective=original with{Binding=binding};var nextRecord=BuildLibraryRfqRecord(effective,package!);
            var comparisons=BomComparison(record,nextRecord);var changed=comparisons.Where(r=>r.Change!="Unchanged").ToArray();
            var recheckM=record.DeLeonScope!="LABOR_ONLY";
            var recheckL=record.DeLeonScope!="MATERIAL_ONLY";
            var blocker=QuotationEditBlocker(id,lanes.Commercial,(await ReadDatasetAsync()).Records);
            var token=PartHash(new{current.Token,Packages=PartHash(packages),Lanes=PartHash(lanes),record.LibraryRfq,To=binding,blocker});
            if(adopt is null)return new{status="APPROVED_UPDATE_AVAILABLE",adopted=false,batchId,rfqId=id,assemblyNumber=b.AssemblyNumber,revision=b.Revision,reason=b.Note,basisReference=b.BasisReference,evidence=PartRequestEvidenceView(b,"materials"),requestedItems=b.Items.Select(i=>PartItemView(i,true,"materials",id,b.Id)),from=record.LibraryRfq,to=binding,token,canAdopt=persona.Can("technical_review.disposition")&&blocker is null,blocker,materialsRecheck=recheckM,laborRecheck=recheckL,rows=comparisons};
            PartRequire(Guid.TryParseExact(adopt.RequestId,"D",out _),"BOM_UPDATE_ID","Choose a valid adoption reference.");
            PartRequire(blocker is null,"BOM_UPDATE_ISSUED",blocker??"This quote has a recorded submission. Its archive cannot be replaced; a deliberate revision workflow is required.");
            PartRequire(adopt.ExpectedToken==token,"BOM_UPDATE_STALE","Materials, Labor, request or Library result changed. Reopen the comparison before adopting.");
            var retained=RetainEstimatePairs(record,lanes);var now=DateTimeOffset.UtcNow;var actor=new SimMaterialPartActor(persona.Id,persona.DisplayName);
            var beforeRows=record.TechnicalReview!.Workflow!.Outputs!.Materials.Candidate.Rows;var afterRows=nextRecord.TechnicalReview!.Workflow!.Outputs!.Materials.Candidate.Rows;
            var material=retained.MaterialsQuote;var removed=material?.Rows.Where(r=>!afterRows.Any(s=>beforeRows.Any(old=>old.Index==r.Index&&old.RowId==s.RowId))).ToArray()??[];
            if(material is not null){
                var copied=afterRows.Select(s=>{var old=beforeRows.SingleOrDefault(x=>x.RowId==s.RowId);var row=old is null?new SimMaterialRow(s.Index):material.Rows.SingleOrDefault(x=>x.Index==old.Index)??new SimMaterialRow(s.Index);row=row with{Index=s.Index};
                    if(row.MfgPartNumber is {} pn&&MaterialIdentityChoices(s).Contains(pn,StringComparer.Ordinal)&&b.Items.Any(i=>i.RowId==s.RowId&&i.QuotedPartNumber==pn))row=row with{MfgPartNumberSource="CONFIRMED_ACCEPTED_BOM",PartReviewMode=null};
                    if(row.MfgPartNumber is {} oldPn&&row.MfgPartNumberSource=="CONFIRMED_ACCEPTED_BOM"&&!MaterialIdentityChoices(s).Contains(oldPn,StringComparer.Ordinal))row=row with{MfgPartNumberSource="MANUAL_QUOTE_ONLY",PartReviewMode="PROPOSED_PART"};
                    // Keep current prices/quantities as review inputs; they are not re-completed.
                    return row;}).ToArray();
                material=material with{Revision=material.Revision+1,CandidateId=nextRecord.TechnicalReview.Workflow.Outputs.Materials.Candidate.Id,BomVersion=binding.BomVersion,Rows=copied,UpdatedBy=persona.DisplayName,AtUtc=now};
            }
            var labor=retained.LaborQuote;if(labor is not null)labor=labor with{Revision=labor.Revision+1,DefinitionId=nextRecord.TechnicalReview!.Workflow!.Outputs!.Manufacturing.Id,UpdatedBy=persona.DisplayName,AtUtc=now};
            var audit=new SimBomAdoption((retained.BomAdoptions?.Length??0)+1,adopt.RequestId,adopt.ExpectedToken,b.Id,b.ContentHash,record.LibraryRfq!,binding,actor,now,recheckM,recheckL,changed.Select(r=>r.Find).ToArray(),removed,"");audit=audit with{ContentHash=AdoptionHash(audit)};
            var updated=retained with{MaterialsQuote=material,LaborQuote=labor,Materials=recheckM&&material is not null?new("IN_PROGRESS",persona.DisplayName,now):retained.Materials,Labor=recheckL&&labor is not null?new("IN_PROGRESS",persona.DisplayName,now):retained.Labor,BomAdoptions=[..retained.BomAdoptions??[],audit]};
            var all=await ReadRfqLanes();all[id]=updated;Directory.CreateDirectory(Path.GetDirectoryName(RfqLanesPath)!);var temp=RfqLanesPath+".adopt-"+Guid.NewGuid().ToString("N");
            try{var text=JsonSerializer.Serialize(all,jsonOptions);await File.WriteAllTextAsync(temp,text);PartRequire(await File.ReadAllTextAsync(temp)==text,"BOM_UPDATE_WRITE","Adoption write verification failed.");BeforeBomAdoptionCommit?.Invoke();File.Move(temp,RfqLanesPath,true);}finally{if(File.Exists(temp))File.Delete(temp);}
            return new{status="ADOPTED",adopted=true,duplicate=false,adoption=audit};
        },batchId);
    }
    internal async Task<object> PreviewBomUpdate(string id,string batchId,SimPersona persona)
    {BomUpdatePermission(persona);await gate.WaitAsync();try{return await BomPreviewCore(id,batchId,persona);}finally{gate.Release();}}
    internal async Task<object> AdoptBomUpdate(string id,string batchId,SimBomAdoptCommand command,SimPersona persona)
    {BomUpdatePermission(persona,true);await gate.WaitAsync();try{return await BomPreviewCore(id,batchId,persona,command);}finally{gate.Release();}}
    internal async Task<object> ReadBomUpdateNotices(string id,SimPersona persona)
    {
        BomUpdatePermission(persona);await gate.WaitAsync();try{
            var record=await RequireRfqRecord(id);var lanes=(await ReadRfqLanes()).GetValueOrDefault(id)??new(new(),new());var items=new List<object>();
            foreach(var b in (await PartBatches()).Where(b=>b.RfqId==id&&b.Baseline.ScenarioId==record.ScenarioId&&b.Baseline.Generation==record.Generation)){
                var actions=await ReadPartActions(b);if(LinkedBomResult(actions) is null)continue;
                var status=await PartBomUpdateStatus(b,actions,(await PartViewWithoutLibrary(b,actions,record,lanes)).Current);
                if(status is "APPROVED_UPDATE_AVAILABLE" or "ADOPTED")items.Add(new{batchId=b.Id,status,packageVersion=LinkedBomResult(actions)!.ApprovedResult!.PackageVersion,reason=b.Note});
            }
            return new{items,canAdopt=persona.Can("technical_review.disposition"),adoptions=lanes.BomAdoptions??[],materialsStatus=lanes.Materials.Status,laborStatus=lanes.Labor.Status};
        }finally{gate.Release();}
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapBomUpdates(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        async Task<IResult> Run(HttpContext c,string permission,Func<SimPersona,Task<object>> action){var denied=DeniedTechnicalReview(c,state,personas,permission);if(denied is not null)return denied;c.Response.Headers.CacheControl="private, no-store";try{return Results.Json(await action(personas.Resolve(c)));}catch(LibraryBomPermissionException){return Results.StatusCode(403);}catch(SimRfqIntakeProblem e){return Results.Json(new{message=e.Message,code=e.Code},statusCode:e.StatusCode);}catch(Exception e)when(e is IOException or JsonException or UnauthorizedAccessException){return Results.Json(new{message="BOM update could not be confirmed. Check saved status before retrying; existing records are retained."},statusCode:503);}}
        app.MapGet("/api/sim/technical-review/part-requests/{batchId}/approved-result",(string batchId,HttpContext c)=>Run(c,"technical_review.view",p=>store.ReadBomResults(batchId,p)));
        app.MapPost("/api/sim/technical-review/part-requests/{batchId}/approved-result",(string batchId,SimBomUpdateCommand command,HttpContext c)=>Run(c,"technical_review.disposition",p=>store.LinkBomResult(batchId,command,p)));
        app.MapGet("/api/sim/rfqs/{id}/bom-updates",(string id,HttpContext c)=>Run(c,"rfq.view",p=>store.ReadBomUpdateNotices(id,p)));
        app.MapGet("/api/sim/rfqs/{id}/bom-updates/{batchId}",(string id,string batchId,HttpContext c)=>Run(c,"rfq.view",p=>store.PreviewBomUpdate(id,batchId,p)));
        app.MapPost("/api/sim/rfqs/{id}/bom-updates/{batchId}/adopt",(string id,string batchId,SimBomAdoptCommand command,HttpContext c)=>Run(c,"technical_review.disposition",p=>store.AdoptBomUpdate(id,batchId,command,p)));
    }
}
