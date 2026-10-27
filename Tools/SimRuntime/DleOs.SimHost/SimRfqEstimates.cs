using System.Security.Cryptography;
using System.Text.Json;

// References to authoritative completed components; no duplicate worksheet payloads.
internal sealed record SimEstimatePair(int Version,string Id,string RfqId,SimLibraryRfqBinding Binding,SimRfqIntakeCustomer Customer,SimRfqIntakeAssembly Assembly,
    int? MaterialsVersion,string? MaterialsHash,string? MaterialSourceHash,int? LaborVersion,string? LaborHash,DateTimeOffset AtUtc);

internal sealed partial class SimRfqIntakeStore
{
    private static string EstimateHash<T>(T value)=>Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value,new JsonSerializerOptions(JsonSerializerDefaults.Web))));
    private static void EstimateRequire(bool condition,string message){if(!condition)throw SimRfqIntakeProblem.Conflict("ESTIMATE_HISTORY",message);}
    private static void EstimatePermission(SimPersona persona){if(!persona.IsActive||!persona.Can("assembly_library.view")||!persona.Can("rfq.view"))throw SimRfqIntakeProblem.Conflict("ESTIMATE_DENIED","Library and RFQ viewing access are required.");}
    private static SimCandidateRow[] EstimateMaterialSources(SimRfqIntakeRecord record,SimMaterialSnapshot snapshot)
    {
        var acceptance=record.TechnicalReview?.BomAcceptances?.SingleOrDefault(a=>a.Version==snapshot.BomVersion&&a.Candidate.Id==snapshot.CandidateId);
        if(acceptance is not null)return acceptance.Candidate.Rows;
        var source=record.TechnicalReview?.Workflow?.Outputs?.Materials;
        if(source?.Version==snapshot.BomVersion&&source.Candidate.Id==snapshot.CandidateId)return source.Candidate.Rows;
        throw SimRfqIntakeProblem.Conflict("ESTIMATE_SOURCE","The original BOM source for this estimate is unavailable. Current draft rows will not be substituted.");
    }
    private static SimEstimatePair[] EstimatePairs(SimRfqIntakeRecord record,SimRfqLanes lanes)
    {
        var saved=lanes.EstimatePairs??[];
        EstimateRequire(saved.Select(p=>p.Id).Distinct().Count()==saved.Length&&saved.Select((p,i)=>p.Version==i+1&&p.RfqId==record.IntakeId).All(v=>v),"Estimate version references could not be verified.");
        if(record.LibraryRfq is null)return saved;
        var needsM=record.DeLeonScope!="LABOR_ONLY";var needsL=record.DeLeonScope!="MATERIAL_ONLY";
        var ready=FinalReviewView(record,lanes).Summary;
        if(needsM&&!ready.MaterialsComplete||needsL&&!ready.LaborComplete)return saved;
        var m=needsM?lanes.MaterialsQuote?.Versions.LastOrDefault():null;
        var l=needsL?lanes.LaborQuote?.Versions.LastOrDefault():null;
        var mh=m is null?null:EstimateHash(m);var lh=l is null?null:EstimateHash(l);
        var sh=m is null?null:EstimateHash(EstimateMaterialSources(record,m));
        var id=EstimateHash(new{record.IntakeId,record.LibraryRfq,materialsVersion=m?.Version,materialsHash=mh,materialSourceHash=sh,laborVersion=l?.Version,laborHash=lh});
        if(saved.Any(p=>p.Id==id))return saved;
        var at=m is null?l!.AtUtc:l is null?m.AtUtc:m.AtUtc>l.AtUtc?m.AtUtc:l.AtUtc;
        return [..saved,new(saved.Length+1,id,record.IntakeId,record.LibraryRfq,record.Customer,record.Assemblies.Single(),m?.Version,mh,sh,l?.Version,lh,at)];
    }
    // Called only within an already-authorized component save/revision transaction.
    // Preserves an eligible prior pair before opening a draft, then captures the new pair on completion.
    private static SimRfqLanes RetainEstimatePairs(SimRfqIntakeRecord record,SimRfqLanes lanes)
    {
        if(record.LibraryRfq is null)return lanes;
        var pairs=EstimatePairs(record,lanes);return pairs.Length==0?lanes:lanes with{EstimatePairs=pairs};
    }
    private async Task<bool> EstimateRevisionMatches(SimLibraryRfqBinding binding,string key,string drawingRevision,string bomRevision)
    {
        if(binding.LibraryKey!=key)return false;
        EstimateRequire(LibraryRfqPackageRead is not null,"Approved package access is unavailable.");
        var package=await LibraryRfqPackageRead!(binding);
        return package.Bom.DrawingRevision.Trim()==drawingRevision.Trim()&&package.Bom.BomRevision.Trim()==bomRevision.Trim();
    }
    private async Task<(SimMaterialSnapshot? Materials,SimLaborSnapshot? Labor,SimCandidateRow[] Sources)> VerifyEstimatePair(SimRfqIntakeRecord record,SimRfqLanes lanes,SimEstimatePair pair)
    {
        EstimateRequire(pair.RfqId==record.IntakeId&&record.LibraryRfq is not null&&pair.Binding.ProjectId==record.LibraryRfq.ProjectId,"This estimate belongs to a different RFQ line.");
        var m=pair.MaterialsVersion is null?null:lanes.MaterialsQuote?.Versions.SingleOrDefault(s=>s.Version==pair.MaterialsVersion);
        var l=pair.LaborVersion is null?null:lanes.LaborQuote?.Versions.SingleOrDefault(s=>s.Version==pair.LaborVersion);
        EstimateRequire(pair.MaterialsVersion is null||m is not null&&EstimateHash(m)==pair.MaterialsHash&&m.RfqQuantity==pair.Assembly.Quantity,"The original completed Materials version could not be verified. No draft was substituted.");
        EstimateRequire(pair.LaborVersion is null||l is not null&&EstimateHash(l)==pair.LaborHash&&l.Quantity==pair.Assembly.Quantity,"The original completed Labor version could not be verified. No draft was substituted.");
        var original=await EstimateRecordForPair(record,pair);
        var sources=m is null?[]:EstimateMaterialSources(original,m);
        EstimateRequire(m is null||EstimateHash(sources)==pair.MaterialSourceHash,"The original estimate BOM identities could not be verified. No current identities were substituted.");
        return(m,l,sources);
    }
    private static string? CurrentEstimateReview(SimRfqIntakeRecord record,SimRfqLanes lanes,SimEstimatePair[] pairs)
    {
        var ready=FinalReviewView(record,lanes).Summary;
        return (record.DeLeonScope=="LABOR_ONLY"||ready.MaterialsComplete)&&(record.DeLeonScope=="MATERIAL_ONLY"||ready.LaborComplete)?pairs.LastOrDefault()?.Id:null;
    }
    internal async Task<object> ReadAssemblyEstimates(string key,string drawingRevision,string bomRevision,SimPersona persona)
    {
        EstimatePermission(persona);await gate.WaitAsync();try{
            var lanes=await ReadRfqLanes();var items=new List<object>();
            foreach(var record in (await RfqRecords()).Where(r=>r.LibraryRfq?.LibraryKey==key).OrderBy(r=>r.IntakeId,StringComparer.Ordinal)){
                var state=lanes.GetValueOrDefault(record.IntakeId)??new(new(),new());var pairs=EstimatePairs(record,state);var visible=new List<SimEstimatePair>();
                foreach(var p in pairs)if(await EstimateRevisionMatches(p.Binding,key,drawingRevision,bomRevision)){_=await VerifyEstimatePair(record,state,p);visible.Add(p);}
                if(visible.Count==0)continue;
                var latest=visible.Last();items.Add(new{rfqId=record.IntakeId,parentRfqId=latest.Binding.ParentIntakeId,lineNumber=latest.Binding.LineNumber,customer=latest.Customer,assembly=latest.Assembly,versions=visible.ToArray(),quoteCopies=await QuoteCopiesForAssembly(key,drawingRevision,bomRevision,record.IntakeId),materialsStatus=state.Materials.Status,laborStatus=state.Labor.Status,currentReviewId=CurrentEstimateReview(record,state,pairs)});
            }
            return new{contractVersion=1,items,estimateOnly=true};
        }finally{gate.Release();}
    }
    internal async Task<object> ReadAssemblyEstimate(string key,string drawingRevision,string bomRevision,string rfqId,string estimateId,SimPersona persona)
    {
        EstimatePermission(persona);await gate.WaitAsync();try{
            var record=await RequireRfqRecord(rfqId);var state=(await ReadRfqLanes()).GetValueOrDefault(rfqId)??new(new(),new());
            var pairs=EstimatePairs(record,state);var pair=pairs.SingleOrDefault(p=>p.Id==estimateId);
            EstimateRequire(pair is not null,"This estimate version is unavailable.");
            EstimateRequire(await EstimateRevisionMatches(pair!.Binding,key,drawingRevision,bomRevision),"This estimate belongs to another assembly or revision.");
            var data=await VerifyEstimatePair(record,state,pair);
            var materials=data.Materials?.Rows.Select(r=>{
                var s=data.Sources.SingleOrDefault(s=>s.Index==r.Quote.Index);EstimateRequire(s is not null,"An original material row is unavailable.");
                return new{snapshot=r,find=s!.Values.GetValueOrDefault("lineNumber")??(r.Quote.Index+1).ToString(),customerPartNumber=CustomerNumber(s),approvedPartNumbers=MaterialIdentityChoices(s),description=s.Values.GetValueOrDefault("description"),referenceDesignators=s.Values.GetValueOrDefault("designators"),quantityPerAssembly=s.Values.GetValueOrDefault("quantity")};
            }).ToArray();
            return new{contractVersion=1,pair,materials=data.Materials,materialRows=materials,labor=data.Labor,estimateOnly=true,isCurrentReview=CurrentEstimateReview(record,state,pairs)==pair.Id,materialEditContractVersion=1,canEditMaterials=record.DeLeonScope!="LABOR_ONLY"&&persona.Can("rfq.materials.edit")&&QuotationEditBlocker(record.IntakeId,state.Commercial,(await ReadDatasetAsync()).Records) is null};
        }finally{gate.Release();}
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapAssemblyEstimates(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        async Task<IResult> Run(HttpContext c,Func<SimPersona,Task<object>> action){
            c.Response.Headers.CacheControl="private, no-store";
            var denied=DeniedTechnicalReview(c,state,personas,"assembly_library.view");if(denied is not null)return denied;
            try{return Results.Json(await action(personas.Resolve(c)));}
            catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(Exception e)when(e is IOException or UnauthorizedAccessException or JsonException){return Results.Json(new{message="Estimate history could not be verified. No worksheets were changed."},statusCode:503);}
        }
        app.MapGet("/api/sim/assembly-library/estimates",(string key,string drawingRevision,string bomRevision,HttpContext c)=>Run(c,p=>store.ReadAssemblyEstimates(key,drawingRevision,bomRevision,p)));
        app.MapGet("/api/sim/assembly-library/estimates/version",(string key,string drawingRevision,string bomRevision,string rfqId,string estimateId,HttpContext c)=>Run(c,p=>store.ReadAssemblyEstimate(key,drawingRevision,bomRevision,rfqId,estimateId,p)));
    }
}
