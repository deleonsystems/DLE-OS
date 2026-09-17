using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimMaterialNote(string Id,string Owner,string Purpose,string Text,string Author="",DateTimeOffset CreatedAt=default);
internal sealed record SimMaterialAttachment(string DocumentId,string IntakeId,string Owner,string Kind,string Category,
    string Name,string Type,long Size,string Sha256,string Reference,string AddedBy,DateTimeOffset AddedAt,bool Removed=false,string? RemovedBy=null,DateTimeOffset? RemovedAt=null);
internal sealed record SimMaterialEvidence(SimMaterialNote[] Notes,SimMaterialAttachment[] Attachments);
internal sealed record SimMaterialEvidenceUpload(int ExpectedRevision,string CandidateId,int BomVersion,int Index,string? FeeId,string Kind,string Category);

internal sealed partial class SimIntakeDocuments
{
    internal async Task WriteMaterialAttachment(string draft,SimMaterialAttachment value)
    {
        var path=FilePath(draft,value.DocumentId,".material.json");
        var text=JsonSerializer.Serialize(value,json);
        await File.WriteAllTextAsync(path,text);
        if(await File.ReadAllTextAsync(path)!=text)throw new IOException("Material attachment metadata verification failed.");
    }
    internal async Task<SimMaterialAttachment> ReadMaterialAttachment(string draft,string id)
    {
        var path=FilePath(draft,id,".material.json");
        if(!File.Exists(path))throw SimRfqIntakeProblem.NotFound("MATERIAL_ATTACHMENT_NOT_FOUND","Material attachment not found.");
        return JsonSerializer.Deserialize<SimMaterialAttachment>(await File.ReadAllTextAsync(path),json) ?? throw new IOException("Invalid attachment metadata.");
    }
}
internal sealed partial class SimRfqIntakeStore
{
    internal static string MaterialOwner(SimMaterialPlan plan,int index,string? feeId=null)=>$"{plan.CandidateId}:{plan.BomVersion}:{index}:{feeId ?? "parent"}";
    private static IEnumerable<(string Owner,SimMaterialEvidence? Evidence)> MaterialEvidenceRows(SimMaterialPlan plan,IEnumerable<SimMaterialRow> rows)=>
        rows.SelectMany(r=>new[]{(MaterialOwner(plan,r.Index),r.Evidence)}.Concat((r.Charges ?? []).Select(c=>(MaterialOwner(plan,r.Index,c.Id),c.Evidence))));
    private static object? MaterialEvidenceContent(SimMaterialEvidence? value)=>value is null?null:new {
        Notes=value.Notes.OrderBy(n=>n.Id).Select(n=>new {n.Id,n.Owner,n.Purpose,n.Text}).ToArray(),
        Attachments=value.Attachments.OrderBy(a=>a.DocumentId).Select(a=>new {a.DocumentId,a.Owner,a.Kind,a.Category,a.Sha256,a.Removed}).ToArray()
    };
    internal async Task<SimMaterialAttachment> StageMaterialAttachment(string id,SimMaterialEvidenceUpload request,string name,Stream input,SimPersona persona)
    {
        await gate.WaitAsync();
        try {
            var record=(await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==id&&RfqEligible(r)) ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_READY","Qualified RFQ not found.");
            var view=MaterialView(RfqView(record,await ReadRfqLanes()));
            if(view.Plan.Revision!=request.ExpectedRevision||view.Plan.CandidateId!=request.CandidateId||view.Plan.BomVersion!=request.BomVersion)
                throw SimRfqIntakeProblem.Conflict("MATERIALS_STALE","Materials changed. Reopen before attaching evidence.");
            if(!view.Plan.Rows.Any(r=>r.Index==request.Index)||request.FeeId is not null&&!Guid.TryParseExact(request.FeeId,"D",out _))
                throw SimRfqIntakeProblem.BadRequest("MATERIAL_EVIDENCE_SCOPE","Choose a valid Material row or fee.");
            // A new, unsaved fee may upload. Saving still validates its stable parent and unique ID.
            if(request.FeeId is not null&&view.Plan.Rows.Concat(view.Plan.Versions.SelectMany(v=>v.Rows.Select(r=>r.Quote))).Any(r=>r.Index!=request.Index&&(r.Charges ?? []).Any(c=>c.Id==request.FeeId)))
                throw SimRfqIntakeProblem.Conflict("MATERIAL_EVIDENCE_SCOPE","This fee belongs to another Material row.");
            if(request.Kind is not ("VISUAL" or "FILE")||request.Kind=="FILE"&&request.Category is not ("VENDOR_QUOTE" or "DATASHEET" or "SPECIFICATION" or "SUPPORTING_DOCUMENT" or "OTHER"))
                throw SimRfqIntakeProblem.BadRequest("MATERIAL_EVIDENCE_TYPE","Choose a supported evidence type.");
            var extension=Path.GetExtension(name).ToLowerInvariant();
            if(request.Kind=="FILE"&&extension is not (".pdf" or ".xls" or ".xlsx" or ".doc" or ".docx" or ".txt" or ".csv" or ".png" or ".jpg" or ".jpeg"))
                throw SimRfqIntakeProblem.BadRequest("MATERIAL_EVIDENCE_TYPE","Choose PDF, Office, text, CSV, PNG or JPEG evidence.");
            using var memory=new MemoryStream();var buffer=new byte[81920];int read;
            var limit=(request.Kind=="VISUAL"?8:20)*1024*1024;
            while((read=await input.ReadAsync(buffer))>0){if(memory.Length+read>limit)throw SimRfqIntakeProblem.BadRequest("MATERIAL_EVIDENCE_SIZE","Visuals support 8 MB; files support 20 MB.");memory.Write(buffer,0,read);}
            var bytes=memory.ToArray();
            var imageType=bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})?"image/png":bytes.AsSpan().StartsWith(new byte[]{255,216,255})?"image/jpeg":"";
            if(request.Kind=="VISUAL"&&imageType=="")throw SimRfqIntakeProblem.BadRequest("MATERIAL_EVIDENCE_TYPE","Paste or choose a PNG or JPEG image.");
            memory.Position=0;
            var doc=await documents.Stage(record.RequestCorrelationId,name,0,memory,persona.DisplayName);
            var value=new SimMaterialAttachment(doc.DocumentId!,id,MaterialOwner(view.Plan,request.Index,request.FeeId),request.Kind,request.Kind=="VISUAL"?"VISUAL":request.Category,
                doc.Name,request.Kind=="VISUAL"?imageType:doc.Type,bytes.Length,Convert.ToHexString(SHA256.HashData(bytes)),doc.DocumentReference!,persona.DisplayName,DateTimeOffset.UtcNow);
            try{await documents.WriteMaterialAttachment(record.RequestCorrelationId,value);}
            catch{await documents.Remove(record.RequestCorrelationId,doc.DocumentId!,persona.DisplayName);throw;}
            return value;
        }finally{gate.Release();}
    }
    private async Task<SimMaterialAttachment> VerifiedMaterialAttachment(SimRfqIntakeRecord record,string documentId)
    {
        var value=await documents.ReadMaterialAttachment(record.RequestCorrelationId,documentId);
        var bytes=await documents.Bytes(record.RequestCorrelationId,documentId);
        if(value.IntakeId!=record.IntakeId||value.DocumentId!=documentId||value.Size!=bytes.Length||value.Sha256!=Convert.ToHexString(SHA256.HashData(bytes)))
            throw SimRfqIntakeProblem.Conflict("MATERIAL_EVIDENCE_REFERENCE","Material evidence failed verification.");
        return value;
    }
    internal async Task<(SimMaterialAttachment Attachment,byte[] Bytes)> OpenMaterialAttachment(string id,string documentId)
    {
        await gate.WaitAsync();try{
            var record=(await ReadDatasetAsync()).Records.SingleOrDefault(r=>r.IntakeId==id) ?? throw SimRfqIntakeProblem.NotFound("RFQ_NOT_FOUND","RFQ not found.");
            var value=await VerifiedMaterialAttachment(record,documentId);
            return (value,await documents.Bytes(record.RequestCorrelationId,documentId));
        }finally{gate.Release();}
    }
    private async Task<SimMaterialRow[]> ValidateMaterialEvidence(SimRfqIntakeRecord record,SimMaterialPlan plan,SimMaterialRequest request,SimPersona persona)
    {
        var prior=MaterialEvidenceRows(plan,plan.Rows.Concat(plan.Versions.SelectMany(v=>v.Rows.Select(r=>r.Quote)))).ToArray();
        var incoming=MaterialEvidenceRows(plan,request.Rows).ToArray();
        if(prior.Concat(incoming).Any(e=>e.Evidence is not null)&&request.EvidenceContractVersion!=1)
            throw SimRfqIntakeProblem.Conflict("MATERIAL_EVIDENCE_CLIENT","Reload Materials to preserve its notes and evidence.");
        var notes=incoming.SelectMany(e=>e.Evidence?.Notes ?? []).ToArray();var attachments=incoming.SelectMany(e=>e.Evidence?.Attachments ?? []).ToArray();
        if(notes.Length>1000||attachments.Length>1000||incoming.Any(e=>e.Evidence is not null&&(e.Evidence.Notes is null||e.Evidence.Attachments is null||e.Evidence.Notes.Length>50||e.Evidence.Attachments.Length>50))||
            notes.Any(n=>n is null||!Guid.TryParseExact(n.Id,"D",out _)||n.Purpose is not ("SOURCING_PURCHASING" or "INTERNAL_QUOTE")||string.IsNullOrWhiteSpace(n.Text)||n.Text.Length>2000)||notes.Select(n=>n.Id).Distinct().Count()!=notes.Length||
            attachments.Any(a=>a is null)||attachments.Select(a=>a.DocumentId).Distinct().Count()!=attachments.Length)
            throw SimRfqIntakeProblem.BadRequest("MATERIAL_EVIDENCE_VALUES","Use unique evidence, up to 50 notes and attachments per row; notes require a purpose and 1–2000 characters.");
        async Task<SimMaterialEvidence?> Normalize(string owner,SimMaterialEvidence? supplied,SimMaterialEvidence? old)
        {
            if(supplied is null&&old is null)return null;
            // Notes are append-only audit entries. Older notes cannot be silently edited or dropped.
            var resultNotes=(old?.Notes ?? []).ToList();
            foreach(var n in supplied?.Notes ?? []){
                var previous=prior.SelectMany(e=>e.Evidence?.Notes ?? []).FirstOrDefault(p=>p.Id==n.Id);
                if(n.Owner!=owner||previous is not null&&(previous.Owner!=owner||previous.Text!=n.Text.Trim()||previous.Purpose!=n.Purpose))
                    throw SimRfqIntakeProblem.Conflict("MATERIAL_EVIDENCE_SCOPE","Notes must remain with their original Material row or fee.");
                if(!resultNotes.Any(p=>p.Id==n.Id))resultNotes.Add(previous ?? n with {Text=n.Text.Trim(),Author=persona.DisplayName,CreatedAt=DateTimeOffset.UtcNow});
            }
            if(resultNotes.Count>50)throw SimRfqIntakeProblem.BadRequest("MATERIAL_EVIDENCE_VALUES","Use up to 50 notes per row.");
            SimMaterialAttachment Remove(SimMaterialAttachment a)=>a.Removed?a:a with{Removed=true,RemovedBy=persona.DisplayName,RemovedAt=DateTimeOffset.UtcNow};
            var resultFiles=new List<SimMaterialAttachment>();
            foreach(var a in supplied?.Attachments ?? []){
                var trusted=await VerifiedMaterialAttachment(record,a.DocumentId);
                if(trusted.Owner!=owner)throw SimRfqIntakeProblem.Conflict("MATERIAL_EVIDENCE_SCOPE","Attachments must remain with their original Material row or fee.");
                var priorFile=old?.Attachments.SingleOrDefault(p=>p.DocumentId==a.DocumentId);
                resultFiles.Add(priorFile?.Removed==true?priorFile:a.Removed?Remove(trusted):trusted);
            }
            resultFiles.AddRange((old?.Attachments ?? []).Where(a=>!resultFiles.Any(n=>n.DocumentId==a.DocumentId)).Select(Remove));
            if(resultFiles.Count>50)throw SimRfqIntakeProblem.BadRequest("MATERIAL_EVIDENCE_VALUES","Use up to 50 attachments per row, including removed references.");
            return new(resultNotes.ToArray(),resultFiles.ToArray());
        }
        var result=new List<SimMaterialRow>();
        foreach(var row in request.Rows){
            var old=plan.Rows.Single(r=>r.Index==row.Index);var charges=new List<SimMaterialCharge>();
            foreach(var c in row.Charges ?? [])charges.Add(c with {Evidence=await Normalize(MaterialOwner(plan,row.Index,c.Id),c.Evidence,old.Charges?.SingleOrDefault(p=>p.Id==c.Id)?.Evidence)});
            result.Add(row with {Evidence=await Normalize(MaterialOwner(plan,row.Index),row.Evidence,old.Evidence),Charges=row.Charges is null?null:charges.ToArray()});
        }
        return result.ToArray();
    }
}
internal static partial class SimRfqIntakeEndpoints
{
    private static void MapMaterialEvidence(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        app.MapPost("/api/sim/rfqs/{id}/materials/attachments",async Task<IResult>(string id,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.disposition");if(denied is not null)return denied;
            if(!context.Request.Headers.ContainsKey("X-SIM-Document-Upload")||!context.Request.HasFormContentType)return Results.BadRequest();
            try{
                if(context.Request.ContentLength>21*1024*1024)return Results.StatusCode(413);
                var form=await context.Request.ReadFormAsync(new Microsoft.AspNetCore.Http.Features.FormOptions{MultipartBodyLengthLimit=21*1024*1024,ValueLengthLimit=4096});
                if(form.Files.Count!=1||form["metadata"].ToString().Length>4096)return Results.BadRequest();
                var request=JsonSerializer.Deserialize<SimMaterialEvidenceUpload>(form["metadata"].ToString(),new JsonSerializerOptions(JsonSerializerDefaults.Web));if(request is null)return Results.BadRequest();
                var file=form.Files[0];await using var input=file.OpenReadStream();
                return Results.Json(await store.StageMaterialAttachment(id,request,file.FileName,input,personas.Resolve(context)));
            }catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(JsonException){return Results.BadRequest(new{message="Invalid evidence metadata."});}
            catch(InvalidDataException){return Results.BadRequest(new{message="Choose one file up to 20 MB (visuals up to 8 MB)."});}
            catch(IOException){return Results.Json(new{message="Evidence could not be staged. Retry."},statusCode:503);}
        });
        app.MapGet("/api/sim/rfqs/{id}/materials/attachments/{documentId}",async Task<IResult>(string id,string documentId,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            try{
                var result=await store.OpenMaterialAttachment(id,documentId);var a=result.Attachment;
                context.Response.Headers.CacheControl="private, no-store";context.Response.Headers["X-Content-Type-Options"]="nosniff";
                context.Response.Headers["Content-Security-Policy"]="default-src 'none'; sandbox";
                context.Response.Headers["Content-Disposition"]=new System.Net.Http.Headers.ContentDispositionHeaderValue(a.Kind=="VISUAL"||a.Type=="application/pdf"?"inline":"attachment"){FileNameStar=a.Name}.ToString();
                return Results.File(result.Bytes,a.Type);
            }catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="SIM evidence storage is unavailable."},statusCode:503);}
        });
    }
}
