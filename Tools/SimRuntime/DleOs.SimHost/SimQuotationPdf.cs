using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed record SimQuotePdfOutput(string QuoteNumber, string Url, string Sha256);
internal static class SimQuotationPdf
{
    internal static string QuoteNumber(SimFinalApproval approval)
    {
        var match=Regex.Match(approval.Summary.IntakeId,@"^RFQI-SIM-(\d+)$");
        if(!match.Success)throw SimRfqIntakeProblem.Conflict("QUOTE_ID","Unsupported canonical quote identifier.");
        return "SIM-Q-"+match.Groups[1].Value+"-R"+approval.Version.ToString("00");
    }
    internal static object CustomerProjection(SimFinalApproval approval)
        => CustomerProjection(approval.Summary, approval.Answers, QuoteNumber(approval), approval.ApprovedAt, false);
    internal static object CustomerProjection(SimFinalSummary s, SimFinalAnswers answers, string reference, DateTimeOffset date, bool preview)
    {
        if(!s.MaterialsComplete||!s.LaborComplete||s.CombinedUnitPrice is null||s.Total is null)
            throw SimRfqIntakeProblem.Conflict("QUOTE_INCOMPLETE","Approved pricing is incomplete.");
        // Deliberate allowlist: internal review notes, split costs, rates and markup never cross this boundary.
        return new {quoteNumber=reference,quoteDate=date.ToString("yyyy-MM-dd"),preview,
            customer=s.Customer,assembly=s.Assembly,revision=s.Revision,quantity=s.Quantity,description=s.Description,
            unitPrice=s.CombinedUnitPrice,productTotal=s.Total,nreTotal=s.NreTotal,grandTotal=s.QuoteTotal,
            materialCharges=(s.MaterialSupplemental?.Charges ?? []).Where(c=>c.Treatment!="BLEND").Select(c=>new{label=c.Description,amount=c.SellAmount,treatment=c.Treatment}),
            materialSeparateTotal=s.MaterialSupplemental?.SeparateCharges ?? 0,materialNreTotal=s.MaterialSupplemental?.MaterialNre ?? 0,
            delivery=answers.Delivery,nreLines=s.NreLines.Select(c=>new{label=c.Label,amount=c.Amount}),
            customerSuppliedItems=(s.CustomerSuppliedItems??[]).Select(r=>new{findNo=r.FindNo,internalPartNumber=r.InternalPartNumber})};
    }

    // Both modes use the same customer projection and installed PDF renderer.
    // Preview output is transient; it never enters the approved document store.
    internal static Task<byte[]> Render(object projection, bool pages = false)
        => RenderDocument(projection, "sim_quotation_pdf.py", pages);

    internal static async Task<byte[]> RenderDocument(object projection, string renderer, bool pages = false)
    {
        var logo=Path.Combine(AppContext.BaseDirectory,"Quotation","no back-black font.png");
        if(!File.Exists(logo))throw SimRfqIntakeProblem.Conflict("QUOTE_LOGO","The approved DLE logo asset is not installed.");
        var directory=Path.Combine(Path.GetTempPath(),"dle-quote-render-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try {
            var input=Path.Combine(directory,"input.json");var output=Path.Combine(directory,"output.pdf");
            await File.WriteAllTextAsync(input,JsonSerializer.Serialize(projection));
            var python=Environment.GetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".cache","codex-runtimes","codex-primary-runtime","dependencies","python","python.exe");
            var info=new ProcessStartInfo(python){UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true,RedirectStandardOutput=true};
            foreach(var arg in new[]{Path.Combine(AppContext.BaseDirectory,renderer),input,logo,output})info.ArgumentList.Add(arg);
            if(pages)info.ArgumentList.Add("--pages");
            using var process=Process.Start(info)??throw new IOException("PDF renderer could not start.");
            var stderr=process.StandardError.ReadToEndAsync();var stdout=process.StandardOutput.ReadToEndAsync();
            using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(45));
            try{await process.WaitForExitAsync(timeout.Token);}catch(OperationCanceledException){process.Kill(true);await process.WaitForExitAsync();throw new IOException("PDF generation timed out.");}
            await Task.WhenAll(stderr,stdout);
            if(process.ExitCode!=0)throw new IOException("PDF renderer failed.");
            var bytes=await File.ReadAllBytesAsync(output);
            if(bytes.Length<500||(!pages&&System.Text.Encoding.ASCII.GetString(bytes,0,5)!="%PDF-"))throw new IOException("Invalid PDF output.");
            return bytes;
        } finally {Directory.Delete(directory,true);}
    }
}

internal sealed partial class SimRfqIntakeStore
{
    internal async Task<byte[]> PreviewQuotationPdf(string id, SimFinalApproveRequest request, bool pages = false)
    {
        var view=await ReadFinalReview(id);
        if(request.SourceToken!=view.SourceToken||request.ExpectedApprovalCount!=view.Approvals.Length)
            throw SimRfqIntakeProblem.Conflict("FINAL_STALE","Source work or approval history changed. Reopen Final Review before previewing.");
        if(view.Blockers.Length>0)throw SimRfqIntakeProblem.Conflict("FINAL_BLOCKED",string.Join(" ",view.Blockers));
        var approved=view.ApprovalCurrent?view.Approvals.Last():null;
        var answers=approved?.Answers??ValidateFinalAnswers(request.Answers);
        var projection=SimQuotationPdf.CustomerProjection(approved?.Summary??view.Summary,answers,
            "PREVIEW / "+id,approved?.ApprovedAt??DateTimeOffset.UtcNow,true);
        return await SimQuotationPdf.Render(projection,pages);
    }
    private string QuotePdfDirectory(SimFinalApproval approval,int layout=2) => layout==1 ? Path.Combine(Path.GetDirectoryName(dataPath)!,"quotation-pdfs",approval.Id) : Path.Combine(Path.GetDirectoryName(dataPath)!,"quotation-pdfs",approval.Id,"layout-v2");
    internal async Task<SimQuotePdfOutput> GenerateQuotationPdf(string id,int version)
    {
        var view=await ReadFinalReview(id);
        var approval=view.Approvals.SingleOrDefault(a=>a.Version==version)
            ?? throw SimRfqIntakeProblem.Conflict("QUOTE_NOT_APPROVED","Approve this quotation before generating a PDF.");
        var projection=SimQuotationPdf.CustomerProjection(approval);
        await gate.WaitAsync();
        try {
            var directory=QuotePdfDirectory(approval);var pdf=Path.Combine(directory,"quotation.pdf");
            if(!File.Exists(pdf)) {
                Directory.CreateDirectory(directory);
                var temporary=Path.Combine(directory,Guid.NewGuid().ToString("N")+".pdf");
                try {
                    var bytes=await SimQuotationPdf.Render(projection);
                    await File.WriteAllBytesAsync(temporary,bytes);
                    var hash=Convert.ToHexString(SHA256.HashData(bytes));
                    await File.WriteAllTextAsync(Path.Combine(directory,"manifest.json"),JsonSerializer.Serialize(new{renderer="DLE_QUOTE_PDF_V2",quoteNumber=SimQuotationPdf.QuoteNumber(approval),sha256=hash,approval},jsonOptions));
                    File.Move(temporary,pdf,false);
                }finally{if(File.Exists(temporary))File.Delete(temporary);}
            }
            var content=await VerifiedQuotationPdf(approval);
            return new(SimQuotationPdf.QuoteNumber(approval),$"/api/sim/rfqs/{id}/final-review/{version}/pdf?layout=2",Convert.ToHexString(SHA256.HashData(content)));
        }finally{gate.Release();}
    }
    private async Task<byte[]> VerifiedQuotationPdf(SimFinalApproval approval,int layout=2)
    {
        var directory=QuotePdfDirectory(approval,layout);var path=Path.Combine(directory,"quotation.pdf");
        if(!File.Exists(path))throw SimRfqIntakeProblem.NotFound("QUOTE_PDF","Generate the quotation PDF first.");
        var bytes=await File.ReadAllBytesAsync(path);
        using var manifest=JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(directory,"manifest.json")));
        if(manifest.RootElement.GetProperty("sha256").GetString()!=Convert.ToHexString(SHA256.HashData(bytes)))throw new IOException("PDF integrity verification failed.");
        return bytes;
    }
    internal async Task<(byte[] Bytes,string Name)> ReadQuotationPdf(string id,int version,int layout=2)
    {
        var view=await ReadFinalReview(id);var approval=view.Approvals.SingleOrDefault(a=>a.Version==version)
            ??throw SimRfqIntakeProblem.NotFound("QUOTE_APPROVAL","Approved quotation not found.");
        return(await VerifiedQuotationPdf(approval,layout),SimQuotationPdf.QuoteNumber(approval)+".pdf");
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapQuotationPdf(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        app.MapPost("/api/sim/rfqs/{id}/final-review/preview/pages",async Task<IResult>(string id,SimFinalApproveRequest request,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            try{
                var bytes=await store.PreviewQuotationPdf(id,request,true);
                context.Response.Headers.CacheControl="no-store";
                return Results.Bytes(bytes,"application/json");
            }
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(Exception e) when(e is IOException or System.ComponentModel.Win32Exception){return Results.Json(new{message="Quotation preview could not be rendered."},statusCode:503);}
        });
        app.MapPost("/api/sim/rfqs/{id}/final-review/preview",async Task<IResult>(string id,SimFinalApproveRequest request,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            try{
                var bytes=await store.PreviewQuotationPdf(id,request);
                context.Response.Headers.CacheControl="no-store";
                context.Response.Headers["X-Content-Type-Options"]="nosniff";
                context.Response.Headers.ContentDisposition="inline; filename=\"PREVIEW-NOT-APPROVED.pdf\"";
                return Results.File(bytes,"application/pdf");
            }
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message,code=p.Code},statusCode:p.StatusCode);}
            catch(Exception e) when(e is IOException or System.ComponentModel.Win32Exception){return Results.Json(new{message="Quotation preview could not be rendered."},statusCode:503);}
        });
        app.MapPost("/api/sim/rfqs/{id}/final-review/{version:int}/pdf",async Task<IResult>(string id,int version,HttpContext context)=>{
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.disposition");if(denied is not null)return denied;
            try{return Results.Json(await store.GenerateQuotationPdf(id,version));}
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message},statusCode:p.StatusCode);}
            catch(Exception e) when(e is IOException or System.ComponentModel.Win32Exception){return Results.Json(new{message="Quotation PDF could not be generated or verified."},statusCode:503);}
        });
        app.MapGet("/api/sim/rfqs/{id}/final-review/{version:int}/pdf",async Task<IResult>(string id,int version,int? layout,HttpContext context)=>{
            if(layout is not (null or 1 or 2))return Results.BadRequest();
            var denied=DeniedTechnicalReview(context,state,personas,"technical_review.view");if(denied is not null)return denied;
            try{var pdf=await store.ReadQuotationPdf(id,version,layout??1);context.Response.Headers.CacheControl="no-store";context.Response.Headers["X-Content-Type-Options"]="nosniff";context.Response.Headers.ContentDisposition="inline; filename=\""+pdf.Name+"\"";return Results.File(pdf.Bytes,"application/pdf");}
            catch(SimRfqIntakeProblem p){return Results.Json(new{message=p.Message},statusCode:p.StatusCode);}
            catch(IOException){return Results.Json(new{message="Quotation PDF integrity verification failed."},statusCode:503);}
        });
    }
}
