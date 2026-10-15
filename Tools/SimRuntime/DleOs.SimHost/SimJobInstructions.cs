using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;

internal sealed record SimJobInstructionDraft(string WorkOrderNumber,long Generation,int Version,string BaselineToken,
    SimLaborOperation[] Operations,string UpdatedBy,DateTimeOffset UpdatedAt);
internal sealed record SimJobInstructionSave(int ExpectedVersion,string BaselineToken,SimLaborOperation[] Operations);
internal sealed record SimJobInstructionAsset(string DocumentId,string Sha256,string Name,string Type,byte[] Bytes);

internal sealed partial class SimProductionService
{
    private async Task<SimLaborSnapshot> InstructionBaseline(SimProductionSource source){
        var record=(SimRfqIntakeRecord)(await intakes.ReadAsync(source.Package.GetProperty("source").GetProperty("acceptedIntakeId").GetString()!))!;
        return record.OrderEntry!.Acceptance.Package.TechnicalSource!.Baseline!.Labor;
    }
    private async Task<SimRfqWorkspace> FrozenInstructionRfq(SimProductionSource source){
        var record=(SimRfqIntakeRecord)(await intakes.ReadAsync(source.Package.GetProperty("source").GetProperty("acceptedIntakeId").GetString()!))!;
        var baseline=record.OrderEntry!.Acceptance.Package.TechnicalSource!.Baseline!;
        var context=source.Package.GetProperty("context");
        return new(baseline.Quote.IntakeId,record.Customer,[new(1,context.GetProperty("assembly").GetString()!,context.GetProperty("revision").GetString()!,baseline.Labor.Quantity)],"",new(new(),new()),"ACCEPTED",baseline.Definition);
    }
    internal Task<object> ReadInstructionSources(string wo,SimPersona actor)=>WithSource(wo,actor,false,async(source,runtime)=>{
        var rfq=await FrozenInstructionRfq(source);var baseline=await InstructionBaseline(source);
        var html=SimRfqIntakeEndpoints.BomReference(rfq);
        var groups=source.Case?.Draft.GetProperty("groups").EnumerateArray().ToArray()??[];
        var process=rfq.Inputs.Materials.Candidate.Rows.Select(row=>{
            var group=groups.FirstOrDefault(g=>Text(g,"sourceRowId")==row.RowId);
            var value=Field(group,"process");
            return value.ValueKind==JsonValueKind.Object?value.Deserialize<SimBomProcessRow>(Json)!:new SimBomProcessRow(SimRfqIntakeStore.BomProcessLineKey(row));
        }).ToArray();
        return (object)new{baselineToken=Hash(baseline),html,rfq,quantity=baseline.Quantity,
            process=new{canEdit=false,rows=process,source="RETAINED_WORK_ORDER_BOM"}};
    });
    internal Task<byte[]> ReadInstructionPage(string wo,string id,string hash,int page,int pixels,SimPersona actor)=>WithSource(wo,actor,false,async(source,runtime)=>{
        var reference=source.Package.GetProperty("technicalDocuments").EnumerateArray().FirstOrDefault(r=>Text(r,"documentId")==id&&Text(r,"sha256")==hash);
        Require(reference.ValueKind==JsonValueKind.Object,"instructions_drawing_scope","Drawing must match the frozen accepted source.");
        var bytes=await documents.Bytes(source.SourceCorrelationId,id);
        Require(Convert.ToHexString(SHA256.HashData(bytes))==hash,"instructions_drawing_hash","Drawing failed frozen source verification.");
        var count=await SimPdfPagePreview.Count(bytes);
        Require(page>=0&&page<=count&&pixels>=512&&pixels<=4096,"instructions_drawing_page","Drawing page is outside the accepted document.");
        return page==0?JsonSerializer.SerializeToUtf8Bytes(new{pageCount=count},Json):await SimPdfPagePreview.Render(bytes,page,pixels);
    });
    // Operator-facing copy. Estimating values remain fixed and are never written back to quotation.
    private static SimLaborOperation[] InstructionOperations(SimLaborSnapshot baseline)=>baseline.Operations.Select(o=>o with{
        Notes=(o.Notes??[]).Where(n=>!n.Removed&&n.Purpose=="PRODUCTION").ToArray()
    }).ToArray();
    internal Task<object> ReadJobInstructions(string wo,SimPersona actor)=>WithSource(wo,actor,false,async(source,runtime)=>{
        var baseline=await InstructionBaseline(source);var token=Hash(baseline);
        var saved=await store.ReadInstructions(SimKittingCases.Normalize(wo),runtime.Generation);
        Require(saved is null||saved.BaselineToken==token,"instructions_baseline_changed","The accepted instruction baseline changed. Retained edits require review.");
        return (object)new {version=saved?.Version??0,baselineToken=token,baselineVersion=baseline.Version,
            canEdit=actor.Can("production.manage"),baseline.DefinitionId,baseline.Quantity,
            operations=saved?.Operations??InstructionOperations(baseline)};
    });
    internal Task<object> SaveJobInstructions(string wo,SimJobInstructionSave request,SimPersona actor)=>WithSource(wo,actor,true,async(source,runtime)=>{
        var baseline=await InstructionBaseline(source);var token=Hash(baseline);wo=SimKittingCases.Normalize(wo);
        Require(request.BaselineToken==token,"instructions_baseline_changed","The accepted instruction baseline changed. Reopen before saving.");
        var original=InstructionOperations(baseline);var incoming=request.Operations;
        Require(incoming is not null&&incoming.Length==original.Length&&incoming.All(o=>o is not null)&&incoming.Select(o=>o.Id).SequenceEqual(original.Select(o=>o.Id)),"instructions_operation_scope","Keep the accepted operation identities and order.");
        for(int i=0;i<original.Length;i++){
            var o=incoming![i];var b=original[i];
            Require(Hash(o with{Slides=b.Slides,SlidesOrganized=b.SlidesOrganized,ExcludedSlideIds=b.ExcludedSlideIds,Instructions=b.Instructions})==Hash(b),
                "instructions_operation_scope","Only instruction text and authored slide content may change in this job draft.");
            Require(o.Instructions is not null&&o.Instructions.Length<=4000,"instructions_text","Use instruction text up to 4000 characters.");
        }
        await ValidateJobSlides(wo,runtime.Generation,baseline,incoming!,source);
        var saved=await store.SaveInstructions(wo,runtime.Generation,request,actor.DisplayName,UtcNow());
        return (object)new{version=saved.Version,baselineToken=token};
    });
    private async Task ValidateJobSlides(string wo,long gen,SimLaborSnapshot baseline,SimLaborOperation[] ops,SimProductionSource source){
        var rfq=await FrozenInstructionRfq(source);
        var bomHash=Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(SimRfqIntakeEndpoints.BomReference(rfq))));
        var cards=ops.SelectMany(o=>o.Slides??[]).ToArray();var ids=new HashSet<string>();var pageCounts=new Dictionary<string,int>();
        void Valid(bool ok,string message)=>Require(ok,"instructions_slide_values",message);
        void Id(string id)=>Valid(Guid.TryParseExact(id,"D",out _)&&ids.Add(id),"Use unique slide, stage and photo identities.");
        Valid(cards.Length<=500&&ops.All(o=>(o.Slides?.Length??0)<=80),"Use up to 80 slides per operation and 500 per job.");
        foreach(var o in ops){
            var excluded=o.ExcludedSlideIds??[];
            Valid(excluded.Length<=500&&excluded.Distinct().Count()==excluded.Length&&excluded.All(id=>Guid.TryParseExact(id,"D",out _)||id=="generated-"+o.Id),"Invalid excluded slide identities.");
            Valid(!ops.Where(p=>p.Id!=o.Id).SelectMany(p=>p.Slides??[]).Any(c=>excluded.Contains(c.Id)),"Excluded pages must belong to their operation.");
            if(o.SlidesOrganized==true)Valid(o.ParentId is null&&o.Slides?.Length>=2&&o.Slides[0].Kind=="START"&&o.Slides[^1].Kind=="END"&&o.Slides.Count(c=>c.Kind=="START")==1&&o.Slides.Count(c=>c.Kind=="END")==1,"Keep the organized operation's Start and End boundaries.");
        }
        foreach(var card in cards){
            Valid(card is not null,"Missing slide.");Id(card!.Id);
            Valid(card.Kind is "DRAWING" or "IMAGE" or "NOTE" or "BLANK" or "START" or "END" or "SUBSTEP" or "BOM","Unsupported slide type.");
            Valid(card.Title is not null&&card.Title.Length<=100&&card.Body is not null&&card.Body.Length<=4000&&card.Page>0&&card.Stages?.Length is >=1 and <=40,"Invalid slide title, text, page or stages.");
            if(card.Kind=="DRAWING"){
                var refs=source.Package.GetProperty("technicalDocuments");
                var reference=refs.EnumerateArray().FirstOrDefault(r=>r.GetProperty("documentId").GetString()==card.Source?.DocumentId);
                Valid(card.Source is not null&&reference.ValueKind!=JsonValueKind.Undefined&&reference.GetProperty("sha256").GetString()==card.Source.Sha256&&card.Source.DefinitionId==baseline.DefinitionId&&card.Source.Assembly==source.Package.GetProperty("context").GetProperty("assembly").GetString()&&card.Source.Revision==source.Package.GetProperty("context").GetProperty("revision").GetString()&&card.Source.Name==reference.GetProperty("name").GetString(),"Drawing must reference this job's frozen verified source.");
                if(!pageCounts.TryGetValue(card.Source!.DocumentId,out var count)){count=await SimPdfPagePreview.Count(await documents.Bytes(source.SourceCorrelationId,card.Source.DocumentId));pageCounts.Add(card.Source.DocumentId,count);}
                Valid(card.Page<=count,"Drawing page does not exist.");
            }else if(card.Kind=="BOM"){
                var version=card.Source?.DocumentId;
                var expected=version=="bom-reference-v3"?bomHash:Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(version+"\n"+bomHash+"\n"+baseline.Quantity.ToString(System.Globalization.CultureInfo.InvariantCulture))));
                Valid(version is "bom-reference-v3" or "bom-reference-v4" or "bom-reference-v5" && card.Source==new SimDrawingSource(version!,expected,baseline.DefinitionId,rfq.Assemblies[0].AssemblyNumber,rfq.Assemblies[0].Revision,"View BOM") && card.Page<=SimRfqIntakeEndpoints.BomReferencePageCount(rfq),"BOM references must originate in the accepted baseline.");
            }else if(card.Kind=="IMAGE")await CheckInstructionAsset(wo,gen,baseline,card.ImageDocumentId,card.ImageSha256);
            else Valid(card.Page==1&&card.Source is null&&card.ImageDocumentId is null&&card.ImageSha256 is null,"Text and canvas slides cannot reference external assets.");
            foreach(var stage in card.Stages!){
                Valid(stage is not null,"Missing stage.");Id(stage!.Id);
                Valid(!string.IsNullOrWhiteSpace(stage.Name)&&stage.Name.Length<=100&&stage.Marks is not null&&stage.SavedView is not null,"Invalid stage name or content.");
                SimRfqIntakeStore.ValidateDrawingNotes(stage.Marks!,stage.SavedView!);
                Valid(stage.SavedView!.Page==card.Page&&stage.Marks!.All(m=>m.Page==card.Page),"Stage marks and view must use the slide page.");
                Valid((stage.Photos?.Length??0)<=20,"Use up to 20 photos per stage.");
                foreach(var photo in stage.Photos??[]){Id(photo.Id);
                    Valid(double.IsFinite(photo.X)&&double.IsFinite(photo.Y)&&double.IsFinite(photo.Width)&&double.IsFinite(photo.Height)&&double.IsFinite(photo.Rotation)&&photo.X>=0&&photo.Y>=0&&photo.Width>=.001&&photo.Height>=.001&&photo.X+photo.Width<=1.000001&&photo.Y+photo.Height<=1.000001&&photo.Rotation is >=-180 and <=180,"Invalid photo bounds.");
                    await CheckInstructionAsset(wo,gen,baseline,photo.DocumentId,photo.Sha256);
                }
            }
        }
    }
    private async Task CheckInstructionAsset(string wo,long gen,SimLaborSnapshot baseline,string? id,string? hash){
        var asset=id is null?null:await store.InstructionAsset(wo,gen,id);
        var frozen=baseline.Operations.SelectMany(o=>o.Visuals??[]).Any(v=>v.DocumentId==id&&v.Sha256==hash)
            ||baseline.Operations.SelectMany(o=>o.Slides??[]).Any(c=>c.ImageDocumentId==id&&c.ImageSha256==hash||c.Stages.SelectMany(s=>s.Photos??[]).Any(p=>p.DocumentId==id&&p.Sha256==hash));
        Require(asset?.Sha256==hash&&asset is not null||frozen,"instructions_asset_scope","Use a retained image from this job or its accepted baseline.");
    }
    internal Task<SimJobInstructionAsset> UploadInstructionAsset(string wo,string token,string name,byte[] bytes,SimPersona actor)=>WithSource(wo,actor,true,async(source,runtime)=>{
        Require(token==Hash(await InstructionBaseline(source)),"instructions_baseline_changed","The accepted baseline changed.");
        Require(bytes.Length is >0 and <=8388608,"instructions_asset_size","Choose an image up to 8 MB.");
        var type=bytes.AsSpan().StartsWith(new byte[]{137,80,78,71,13,10,26,10})?"image/png":bytes.AsSpan().StartsWith(new byte[]{255,216,255})?"image/jpeg":"";
        Require(type!="","instructions_asset_type","Choose PNG or JPEG.");
        var asset=new SimJobInstructionAsset(Guid.NewGuid().ToString(),Convert.ToHexString(SHA256.HashData(bytes)),Path.GetFileName(name)[..Math.Min(Path.GetFileName(name).Length,200)],type,bytes);
        await store.AddInstructionAsset(SimKittingCases.Normalize(wo),runtime.Generation,asset);return asset;
    });
    internal Task<(byte[] Bytes,string Type)> OpenInstructionAsset(string wo,string id,SimPersona actor)=>WithSource(wo,actor,false,async(source,runtime)=>{
        var asset=await store.InstructionAsset(SimKittingCases.Normalize(wo),runtime.Generation,id);
        if(asset is not null){Require(Convert.ToHexString(SHA256.HashData(asset.Bytes))==asset.Sha256,"instructions_asset_integrity","Image integrity check failed.");return(asset.Bytes,asset.Type);}
        var baseline=await InstructionBaseline(source);
        var ids=baseline.Operations.SelectMany(o=>o.Slides??[]).SelectMany(c=>c.Stages.SelectMany(s=>s.Photos??[]).Select(p=>p.DocumentId).Append(c.ImageDocumentId)).Concat(baseline.Operations.SelectMany(o=>o.Visuals??[]).Select(v=>v.DocumentId));
        Require(ids.Contains(id),"instructions_asset_scope","Image does not belong to the accepted job.");
        var bytes=await documents.Bytes(source.SourceCorrelationId,id);
        var hash=Convert.ToHexString(SHA256.HashData(bytes));
        await CheckInstructionAsset(SimKittingCases.Normalize(wo),runtime.Generation,baseline,id,hash);
        return(bytes,bytes.AsSpan().StartsWith(new byte[]{137,80,78,71})?"image/png":"image/jpeg");
    });
}

internal sealed partial class SimProductionStore
{
    internal async Task<SimJobInstructionDraft?> ReadInstructions(string wo,long gen){await using var c=Open(false);await c.OpenAsync();return await Instructions(c,null,wo,gen);}
    private static async Task<SimJobInstructionDraft?> Instructions(SqliteConnection c,SqliteTransaction? t,string wo,long gen){
        if(!await Exists(c,t,"SimJobInstructionDraft"))return null;
        await using var q=c.CreateCommand();q.Transaction=t;q.CommandText="SELECT PayloadJson FROM SimJobInstructionDraft WHERE WorkOrderNumber=@wo AND Generation=@gen ORDER BY Version DESC LIMIT 1";q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",gen);
        return await q.ExecuteScalarAsync() is string text?JsonSerializer.Deserialize<SimJobInstructionDraft>(text,Json):null;
    }
    internal async Task<SimJobInstructionDraft> SaveInstructions(string wo,long gen,SimJobInstructionSave r,string actor,DateTimeOffset now){
        await gate.WaitAsync();try{await using var c=Open(true);await c.OpenAsync();await using var t=c.BeginTransaction();
            var prior=await Instructions(c,t,wo,gen);
            if((prior?.Version??0)!=r.ExpectedVersion)throw KittingCaseProblem.Conflict("instructions_version_changed","Another session saved this job. Keep your draft and reopen to review before retrying.");
            if(prior is not null&&prior.BaselineToken!=r.BaselineToken)throw KittingCaseProblem.Conflict("instructions_baseline_changed","The accepted baseline changed.");
            var next=new SimJobInstructionDraft(wo,gen,r.ExpectedVersion+1,r.BaselineToken,r.Operations,actor,now);
            await Exec(c,t,"CREATE TABLE IF NOT EXISTS SimJobInstructionDraft(WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,Version INTEGER NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(WorkOrderNumber,Generation,Version))");
            await Exec(c,t,"INSERT INTO SimJobInstructionDraft VALUES(@wo,@gen,@version,@json)",("@wo",wo),("@gen",gen),("@version",next.Version),("@json",JsonSerializer.Serialize(next,Json)));await t.CommitAsync();return next;
        }finally{gate.Release();}
    }
    internal async Task<SimJobInstructionAsset?> InstructionAsset(string wo,long gen,string id){await using var c=Open(false);await c.OpenAsync();if(!await Exists(c,null,"SimJobInstructionAsset"))return null;
        await using var q=c.CreateCommand();q.CommandText="SELECT PayloadJson FROM SimJobInstructionAsset WHERE WorkOrderNumber=@wo AND Generation=@gen AND DocumentId=@id";q.Parameters.AddWithValue("@wo",wo);q.Parameters.AddWithValue("@gen",gen);q.Parameters.AddWithValue("@id",id);return await q.ExecuteScalarAsync() is string text?JsonSerializer.Deserialize<SimJobInstructionAsset>(text,Json):null;}
    internal async Task AddInstructionAsset(string wo,long gen,SimJobInstructionAsset asset){await gate.WaitAsync();try{await using var c=Open(true);await c.OpenAsync();await using var t=c.BeginTransaction();
        await Exec(c,t,"CREATE TABLE IF NOT EXISTS SimJobInstructionAsset(WorkOrderNumber TEXT NOT NULL,Generation INTEGER NOT NULL,DocumentId TEXT NOT NULL,PayloadJson TEXT NOT NULL,PRIMARY KEY(WorkOrderNumber,Generation,DocumentId))");
        await Exec(c,t,"INSERT INTO SimJobInstructionAsset VALUES(@wo,@gen,@id,@json)",("@wo",wo),("@gen",gen),("@id",asset.DocumentId),("@json",JsonSerializer.Serialize(asset,Json)));await t.CommitAsync();
    }finally{gate.Release();}}
}
