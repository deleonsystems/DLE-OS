using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// Production-facing BOM annotations. Intentionally separate from FAIR and purchasing classifications/notes.
internal sealed record SimBomProcessRow(string Key, string ComponentType = "UNKNOWN", string CustomLabel = "", string Notes = "");
internal sealed record SimBomProcessDocument(int Revision, SimBomProcessRow[] Rows, string? UpdatedBy = null, DateTimeOffset? AtUtc = null);
internal sealed record SimBomProcessRequest(string ContentToken, int ExpectedRevision, SimBomProcessRow[] Rows);
internal sealed record SimBomProcessView(string ContentToken, string SourceHash, int Revision, bool CanEdit, SimBomProcessRow[] Rows, string? UpdatedBy, DateTimeOffset? AtUtc);
internal sealed partial class SimRfqIntakeStore
{
    private string BomProcessPath => Path.Combine(Path.GetDirectoryName(dataPath)!, "bom-process.json");
    private static string ProcessHash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    internal static string BomProcessScope(SimRfqWorkspace rfq) => ProcessHash(JsonSerializer.Serialize(new {
        rfq.Customer.CustomerId, rfq.Assemblies[0].AssemblyNumber, rfq.Assemblies[0].Revision,
        rfq.Inputs.Materials.Version, rfq.Inputs.Materials.Candidate.Id, rfq.Inputs.Materials.Candidate.GoverningSha256
    }));
    internal static string BomProcessLineKey(SimCandidateRow row) => ProcessHash(JsonSerializer.Serialize(new {
        row.RowId, Values = row.Values.OrderBy(p=>p.Key,StringComparer.Ordinal).Select(p=>new[]{p.Key,p.Value}).ToArray()
    }));
    private async Task<Dictionary<string,SimBomProcessDocument>> ReadBomProcessDocuments() => File.Exists(BomProcessPath)
        ? JsonSerializer.Deserialize<Dictionary<string,SimBomProcessDocument>>(await File.ReadAllTextAsync(BomProcessPath),jsonOptions) ?? throw new IOException("BOM process data unreadable.") : new();
    private static SimBomProcessView ProcessView(SimRfqWorkspace rfq, Dictionary<string,SimBomProcessDocument> documents, SimPersona persona)
    {
        var scope=BomProcessScope(rfq);documents.TryGetValue(scope,out var saved);
        var keys=rfq.Inputs.Materials.Candidate.Rows.Select(BomProcessLineKey).ToArray();
        var unique=keys.Distinct(StringComparer.Ordinal).Count()==keys.Length;
        var stored=(saved?.Rows ?? []).ToDictionary(r=>r.Key,StringComparer.Ordinal);
        var rows=keys.Select(k=>stored.GetValueOrDefault(k)??new SimBomProcessRow(k)).ToArray();
        return new(ProcessHash(scope+"\n"+string.Join("\n",keys.Order(StringComparer.Ordinal))),
            ProcessHash(SimRfqIntakeEndpoints.BomReference(rfq)),saved?.Revision??0,
            unique&&persona.Can("technical_review.disposition"),rows,saved?.UpdatedBy,saved?.AtUtc);
    }
    private async Task<SimRfqWorkspace> BomProcessRfq(string id)
    {
        var record=(await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==id&&RfqEligible(r))
            ??throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY","Qualified RFQ not found.");
        return RfqView(record,await ReadRfqLanes());
    }
    internal async Task<SimBomProcessView> ReadBomProcess(string id,SimPersona persona)
    {
        await gate.WaitAsync();try{return ProcessView(await BomProcessRfq(id),await ReadBomProcessDocuments(),persona);}finally{gate.Release();}
    }
    internal async Task<SimBomProcessView> SaveBomProcess(string id,SimBomProcessRequest request,SimPersona persona)
    {
        if(!persona.Can("technical_review.disposition"))throw SimRfqIntakeProblem.Conflict("BOM_PROCESS_DENIED","BOM note editing is not permitted.");
        await gate.WaitAsync();try{
            var rfq=await BomProcessRfq(id);var documents=await ReadBomProcessDocuments();var view=ProcessView(rfq,documents,persona);
            if(!view.CanEdit)throw SimRfqIntakeProblem.Conflict("BOM_PROCESS_IDENTITY","Some source lines cannot be identified uniquely. Review the accepted BOM first.");
            if(request.ContentToken!=view.ContentToken||request.ExpectedRevision!=view.Revision)
                throw SimRfqIntakeProblem.Conflict("BOM_PROCESS_STALE","The BOM or shared notes changed. Your edits remain here; cancel and reopen Edit to review the latest values.");
            if(request.Rows is null||request.Rows.Length!=view.Rows.Length||request.Rows.Any(r=>r is null)||request.Rows.Select(r=>r.Key).Distinct().Count()!=view.Rows.Length||request.Rows.Any(r=>!view.Rows.Any(v=>v.Key==r.Key)))
                throw SimRfqIntakeProblem.Conflict("BOM_PROCESS_ROWS","BOM line identities must match the accepted BOM.");
            var rows=request.Rows.Select(r=>r with{CustomLabel=(r.CustomLabel??"").Trim(),Notes=(r.Notes??"").Trim()}).ToArray();
            if(rows.Any(r=>r.ComponentType is not ("UNKNOWN" or "TH" or "SMT" or "PCB" or "WIRE" or "SUB_ASSY" or "MANUAL")||r.CustomLabel.Length>80||r.Notes.Length>4000||r.ComponentType=="MANUAL"&&r.CustomLabel.Length==0))
                throw SimRfqIntakeProblem.BadRequest("BOM_PROCESS_VALUES","Choose a component type; manual labels need 1–80 characters and notes may contain up to 4000 characters.");
            rows=rows.Select(r=>r.ComponentType=="MANUAL"?r:r with{CustomLabel=""}).ToArray();
            documents[BomProcessScope(rfq)]=new(view.Revision+1,rows,persona.DisplayName,DateTimeOffset.UtcNow);
            Directory.CreateDirectory(Path.GetDirectoryName(BomProcessPath)!);var temporary=BomProcessPath+".write-"+Guid.NewGuid().ToString("N");
            try{var text=JsonSerializer.Serialize(documents,jsonOptions);await File.WriteAllTextAsync(temporary,text);if(await File.ReadAllTextAsync(temporary)!=text)throw new IOException("BOM write verification failed.");File.Move(temporary,BomProcessPath,true);}finally{if(File.Exists(temporary))File.Delete(temporary);}
            return ProcessView(rfq,documents,persona);
        }finally{gate.Release();}
    }
}
internal static partial class SimRfqIntakeEndpoints
{
    private static void MapBomProcess(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        app.MapGet("/api/sim/rfqs/{id}/bom-process",async Task<IResult>(string id,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            try{context.Response.Headers.CacheControl="no-store";return Results.Json(await store.ReadBomProcess(id,personas.Resolve(context)));}
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="Shared BOM values unavailable. Retry."},statusCode:503);}
        });
        app.MapPut("/api/sim/rfqs/{id}/bom-process",async Task<IResult>(string id,SimBomProcessRequest request,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.disposition");if(denied is not null)return denied;
            try{return Results.Json(await store.SaveBomProcess(id,request,personas.Resolve(context)));}
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="Shared BOM values could not be saved. Your edits remain here; retry."},statusCode:503);}
        });
    }
}
