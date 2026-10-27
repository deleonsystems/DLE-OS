using System.Text.Json;

// A user's record of an external manual send, never verified delivery or part approval.
internal sealed record SimQuoteManualSend(string RequestId,string CommandHash,string CopyId,string PreparedCopyHash,string PdfHash,string ActorId,string ActorName,DateTimeOffset RecordedAtUtc,string? Recipient=null,DateTimeOffset? SentAtUtc=null);
internal sealed record SimQuoteManualSendRequest(string RequestId,string ExpectedToken,string PdfHash,string? Recipient=null,DateTimeOffset? SentAtUtc=null);
internal sealed record SimQuoteRevisionBasis(string CopyId,string CopyHash,string PdfHash);
internal sealed record SimQuoteCopyLineInfo(string RfqId,string Assembly,string Revision,int Quantity,int? MaterialsVersion,int? LaborVersion,int PackageVersion,SimQuoteDisclosure[] Differences);
internal sealed record SimQuoteManualSummary(string CopyId,string Name,SimQuoteManualSend Send,bool MatchesCurrentEstimate);

internal sealed partial class SimRfqIntakeStore
{
    private async Task<SimQuoteCopyRecord[]> AllQuoteCopies()
    {
        var path=Path.Combine(QuoteCopyRoot,"copies");if(!Directory.Exists(path))return [];
        var copies=new List<SimQuoteCopyRecord>();foreach(var file in Directory.GetFiles(path,"*.json"))copies.Add(await QuoteCopy(Path.GetFileNameWithoutExtension(file)));return copies.ToArray();
    }
    private static SimQuoteCopyLineInfo[] QuoteCopyLines(SimQuoteCopyRecord copy)=>copy.Lines.Select(l=>new SimQuoteCopyLineInfo(l.Pair.RfqId,l.Pair.Assembly.AssemblyNumber,l.Pair.Assembly.Revision,l.Pair.Assembly.Quantity,l.Pair.MaterialsVersion,l.Pair.LaborVersion,l.Pair.Binding.PackageVersion,copy.Projection.Lines.Single(p=>p.RfqId==l.Pair.RfqId).Differences)).ToArray();
    private async Task<SimQuoteCopyView[]> QuoteCopiesForParent(string parent)
    {
        var result=new List<SimQuoteCopyView>();foreach(var copy in (await AllQuoteCopies()).Where(c=>c.Lines.Any(l=>l.Pair.Binding.ParentIntakeId==parent)).OrderByDescending(c=>c.AtUtc).ThenBy(c=>c.Id)){
            var binding=copy.Lines[0].Pair.Binding;QuoteRequire(LibraryRfqPackageRead is not null,"QUOTE_COPY_SCOPE","Approved package access is unavailable.");var package=await LibraryRfqPackageRead!(binding);
            var query=new Dictionary<string,string>{{"key",binding.LibraryKey},{"drawingRevision",package.Bom.DrawingRevision},{"bomRevision",package.Bom.BomRevision},{"rfqId",copy.Lines[0].Pair.RfqId}};
            result.Add(CopyView(copy) with{PdfUrl="/api/sim/assembly-library/quote-copies/"+copy.Id+"/pdf?"+string.Join("&",query.Select(q=>Uri.EscapeDataString(q.Key)+"="+Uri.EscapeDataString(q.Value)))});
        }return result.ToArray();
    }
    private async Task<SimQuoteRevisionBasis[]> QuoteRevisionBases(IEnumerable<string> rfqIds)
    {
        var copies=(await AllQuoteCopies()).Where(c=>c.ManualSend is not null).ToArray();var chosen=new Dictionary<string,SimQuoteRevisionBasis>();
        foreach(var id in rfqIds.Distinct()){
            var latest=copies.Where(c=>c.Lines.Any(l=>l.Pair.RfqId==id)).OrderByDescending(c=>c.ManualSend!.RecordedAtUtc).ThenBy(c=>c.Id).FirstOrDefault();
            if(latest is not null)chosen[latest.Id]=new(latest.Id,latest.ContentHash,latest.Sha256);
        }
        return chosen.Values.OrderBy(c=>c.CopyId,StringComparer.Ordinal).ToArray();
    }
    private async Task VerifyQuoteRevisionBases(SimQuotePinnedLine[] lines,SimQuoteRevisionBasis[]? provided)
    {
        var expected=await QuoteRevisionBases(lines.Select(l=>l.Pair.RfqId));var actual=(provided??[]).OrderBy(c=>c.CopyId,StringComparer.Ordinal).ToArray();
        QuoteRequire(actual.Select(c=>c.CopyId).Distinct().Count()==actual.Length&&EstimateHash(expected)==EstimateHash(actual),"QUOTE_COPY_REVISION","A manual send has been recorded or changed. Refresh the saved copies and use Prepare revised copy; the sent PDF will stay unchanged.");
    }
    private async Task<SimQuoteManualSummary?> ManualQuoteSummary(SimRfqIntakeRecord record,SimRfqLanes lane)
    {
        var copies=await AllQuoteCopies();var latest=copies.Where(c=>c.ManualSend is not null&&c.Lines.Any(l=>l.Pair.RfqId==record.IntakeId)).OrderByDescending(c=>c.ManualSend!.RecordedAtUtc).ThenBy(c=>c.Id).FirstOrDefault();
        if(latest is null)return null;var pinned=latest.Lines.Single(l=>l.Pair.RfqId==record.IntakeId);var current=await QuoteLine(record,lane);
        return new(latest.Id,QuoteFileName(latest.Projection,latest.AtUtc),latest.ManualSend!,current.Source.Eligible&&current.Source.EstimateId==pinned.Pair.Id&&current.Source.Token==pinned.SourceToken);
    }
    internal async Task<SimQuoteCopyView> RecordManualQuoteSend(string rfqId,string copyId,SimQuoteManualSendRequest request,SimPersona persona)
    {
        QuotePreparePermission(persona);await gate.WaitAsync();try{
            _=QuoteGuid(request.RequestId);var copy=await QuoteCopy(copyId);QuoteRequire(copy.Lines.Any(l=>l.Pair.RfqId==rfqId),"QUOTE_COPY_SCOPE","Choose this RFQ line's exact saved PDF.");
            var command=EstimateHash(new{rfqId,copyId,request,persona.Id});
            if(copy.ManualSend is {} prior){QuoteRequire(prior.RequestId==request.RequestId&&prior.CommandHash==command&&prior.ActorId==persona.Id,"QUOTE_SEND_RECORDED","This exact PDF already has a manual-send record. Refresh its details; no second send was recorded.");return CopyView(copy);}
            QuoteRequire(!(await AllQuoteCopies()).Any(c=>c.ManualSend?.RequestId==request.RequestId),"QUOTE_SEND_REPLAY","This request identity belongs to another saved PDF.");
            QuoteRequire(copy.ContentHash==request.ExpectedToken&&copy.Sha256==request.PdfHash,"QUOTE_SEND_STALE","This saved copy's identity or send record changed. Reopen it before recording a send.");
            var recipient=QuoteText(request.Recipient,300,"Recipient");var at=DateTimeOffset.UtcNow;
            QuoteRequire(request.SentAtUtc is null||request.SentAtUtc<=at.AddMinutes(5),"QUOTE_SEND_TIME","Record an actual past send time, or leave it blank. This action does not schedule sending.");
            var lanes=await ReadRfqLanes();foreach(var selected in copy.Lines){var record=await RequireRfqRecord(selected.Pair.RfqId);_=await VerifyEstimatePair(record,lanes.GetValueOrDefault(record.IntakeId)??new(new(),new()),selected.Pair);}
            var blob=QuoteBlob(copy.Sha256);QuoteRequire(File.Exists(blob)&&PartHashBytes(await File.ReadAllBytesAsync(blob))==copy.Sha256,"QUOTE_COPY_INTEGRITY","The exact archived PDF could not be verified. Nothing was marked sent.");
            var sent=new SimQuoteManualSend(request.RequestId,command,copy.Id,copy.ContentHash,copy.Sha256,persona.Id,persona.DisplayName,at,recipient.Length==0?null:recipient,request.SentAtUtc?.ToUniversalTime());
            copy=copy with{ManualSend=sent,ContentHash=""};copy=copy with{ContentHash=CopyHash(copy)};
            var path=QuoteArchivePath(copy.Id);var temp=path+".write-"+Guid.NewGuid().ToString("N");try{var text=JsonSerializer.Serialize(copy,jsonOptions);await File.WriteAllTextAsync(temp,text);QuoteRequire(await File.ReadAllTextAsync(temp)==text,"QUOTE_SEND_VERIFY","The manual-send record could not be verified.");File.Move(temp,path,true);}finally{if(File.Exists(temp))File.Delete(temp);}
            return CopyView(copy);
        }finally{gate.Release();}
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapManualQuoteSends(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        app.MapPost("/api/sim/rfqs/{id}/quote-copies/{copyId}/manual-send",async Task<IResult>(string id,string copyId,SimQuoteManualSendRequest r,HttpContext c)=>{
            c.Response.Headers.CacheControl="private, no-store";var denied=DeniedTechnicalReview(c,state,personas,"rfq.quote.prepare");if(denied is not null)return denied;
            try{return Results.Json(await store.RecordManualQuoteSend(id,copyId,r,personas.Resolve(c)));}
            catch(SimRfqIntakeProblem e){return Results.Json(new{code=e.Code,message=e.Message},statusCode:e.StatusCode);}
            catch(Exception e)when(e is IOException or JsonException or UnauthorizedAccessException){return Results.Json(new{code="QUOTE_SEND_UNCONFIRMED",message="The manual-send outcome is unconfirmed. Reopen the saved copy before retrying the same request."},statusCode:503);}
        });
    }
}
