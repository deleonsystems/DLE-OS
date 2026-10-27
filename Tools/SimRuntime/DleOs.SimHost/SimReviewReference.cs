using System.Diagnostics;
using System.Security.Cryptography;

internal sealed record SimReviewReferenceRequest(int ExpectedRevision,string ExpectedBomToken,string? TeamDocumentId);
internal sealed partial class SimRfqIntakeStore
{
    // Reference selection only: never edits BOM, approval status, or existing annotation sources.
    internal async Task<object> SaveReviewReference(string id,SimReviewReferenceRequest request,SimPersona actor)
    {
        await gate.WaitAsync();
        try
        {
            var data=await ReadDatasetAsync();var index=data.Records.FindIndex(r=>r.IntakeId==id&&IsTechnicalReviewRecord(r));
            if(index<0)throw SimRfqIntakeProblem.NotFound("SIM_REVIEW_NOT_FOUND","Technical Review not found.");
            var r=data.Records[index];var old=Presentation(r);
            if(r.Environment!="SIM"||r.Status is not ("TECHNICAL_REVIEW_IN_PROGRESS" or "ON_HOLD")||r.TechnicalReview?.Workflow is not {Outputs:null}||!string.IsNullOrEmpty(r.TechnicalReview.DownstreamHandoffState))throw SimRfqIntakeProblem.Conflict("SIM_DRAFT_READ_ONLY","This review is no longer editable.");
            if(old.Revision!=request.ExpectedRevision||request.ExpectedBomToken!=ReviewBomToken(r))throw SimRfqIntakeProblem.Conflict("SIM_DRAFT_CHANGED","The reference or BOM changed. Reopen before saving.");
            string? rendition=null;
            if(request.TeamDocumentId is not null)
            {
                var source=await OpenDocument(id,request.TeamDocumentId);
                if(source.Document.Type=="application/pdf")await SimPdfPagePreview.Count(source.Bytes);
                else if(old.TeamDocumentId==request.TeamDocumentId&&old.RenditionDocumentId is not null)
                {
                    // Stored binaries are immutable and hash-verified by OpenDocument.
                    var existing=await OpenDocument(id,old.RenditionDocumentId);
                    await SimPdfPagePreview.Count(existing.Bytes);rendition=old.RenditionDocumentId;
                }
                else
                {
                    var pdf=await SimReferencePdf.Convert(source.Document.Name,source.Bytes);
                    await SimPdfPagePreview.Count(pdf);
                    var name=Path.GetFileNameWithoutExtension(source.Document.Name);
                    name=name[..Math.Min(name.Length,200)]+".view.pdf";
                    var derived=await documents.Stage(r.RequestCorrelationId,name,0,new MemoryStream(pdf),actor.DisplayName);
                    rendition=derived.DocumentId;
                    r=r with{TechnicalFiles=r.TechnicalFiles.Append(derived).ToArray()};
                }
            }
            var now=DateTimeOffset.UtcNow;
            data.Records[index]=r with{TechnicalReview=r.TechnicalReview! with{PresentationDraft=old with{TeamDocumentId=request.TeamDocumentId,RenditionDocumentId=rendition,Revision=old.Revision+1,UpdatedBy=actor.DisplayName,UpdatedAtUtc=now}}};
            data.UpdatedAtUtc=now;await WriteVerifiedAsync(data);
        }
        finally{gate.Release();}
        return await ReadPresentation(id);
    }
}
internal static class SimReferencePdf
{
    private static readonly SemaphoreSlim Slots=new(1);
    internal static async Task<byte[]> Convert(string name,byte[] original)
    {
        if(!string.Equals(Path.GetExtension(name),".docx",StringComparison.OrdinalIgnoreCase))throw SimRfqIntakeProblem.BadRequest("SIM_REFERENCE_FORMAT","Choose a PDF or Word .docx reference. Other formats require a separate PDF rendition; the original is retained.");
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var folder=Path.Combine(Path.GetTempPath(),"dle-reference-"+Guid.NewGuid().ToString("N"));
        var acquired=false;using var process=new Process();
        try
        {
            await Slots.WaitAsync(timeout.Token);acquired=true;Directory.CreateDirectory(folder);
            var input=Path.Combine(folder,"reference.docx");var output=Path.Combine(folder,"reference.pdf");
            await File.WriteAllBytesAsync(input,original,timeout.Token);
            process.StartInfo=new("powershell.exe"){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
            foreach(var arg in new[]{"-NoProfile","-NonInteractive","-ExecutionPolicy","RemoteSigned","-File",Path.Combine(AppContext.BaseDirectory,"sim_reference_pdf.ps1"),"-InputPath",input,"-OutputPath",output})process.StartInfo.ArgumentList.Add(arg);
            process.Start();var stdout=process.StandardOutput.ReadToEndAsync(timeout.Token);var stderr=process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);await stdout;await stderr;
            if(process.ExitCode!=0||!File.Exists(output))throw new IOException("Local Word-to-PDF conversion failed. Original and saved selection are unchanged.");
            var pdf=await File.ReadAllBytesAsync(output,timeout.Token);
            if(pdf.Length>20*1024*1024||!pdf.AsSpan().StartsWith("%PDF-"u8)||!SHA256.HashData(original).SequenceEqual(SHA256.HashData(await File.ReadAllBytesAsync(input,timeout.Token))))throw new IOException("PDF rendition verification failed.");
            return pdf;
        }
        catch(Exception e) when(e is OperationCanceledException or System.ComponentModel.Win32Exception){throw new IOException("Local Word-to-PDF conversion is unavailable or timed out. Original and saved selection are unchanged.",e);}
        finally
        {
            try{if(process.Id>0&&!process.HasExited)process.Kill(entireProcessTree:true);}catch(InvalidOperationException){}
            try{if(Directory.Exists(folder))Directory.Delete(folder,true);}catch(IOException){}catch(UnauthorizedAccessException){}
            if(acquired)Slots.Release();
        }
    }
}
