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
    {
        var s=approval.Summary;
        if(!s.MaterialsComplete||!s.LaborComplete||s.CombinedUnitPrice is null||s.Total is null)
            throw SimRfqIntakeProblem.Conflict("QUOTE_INCOMPLETE","Approved pricing is incomplete.");
        // Deliberate allowlist: internal review notes, split costs, rates and markup never cross this boundary.
        return new {quoteNumber=QuoteNumber(approval),quoteDate=approval.ApprovedAt.ToString("yyyy-MM-dd"),
            customer=s.Customer,assembly=s.Assembly,revision=s.Revision,quantity=s.Quantity,description=s.Description,
            unitPrice=s.CombinedUnitPrice,productTotal=s.Total,nreTotal=s.NreTotal,grandTotal=s.QuoteTotal,
            materialCharges=(s.MaterialSupplemental?.Charges ?? []).Where(c=>c.Treatment!="BLEND").Select(c=>new{label=c.Description,amount=c.SellAmount,treatment=c.Treatment}),
            materialSeparateTotal=s.MaterialSupplemental?.SeparateCharges ?? 0,materialNreTotal=s.MaterialSupplemental?.MaterialNre ?? 0,
            delivery=approval.Answers.Delivery,nreLines=s.NreLines.Select(c=>new{label=c.Label,amount=c.Amount}),
            customerSuppliedItems=(s.CustomerSuppliedItems??[]).Select(r=>new{findNo=r.FindNo,internalPartNumber=r.InternalPartNumber})};
    }
}

internal sealed partial class SimRfqIntakeStore
{
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
                var logo=Path.Combine(AppContext.BaseDirectory,"Quotation","no back-black font.png");
                if(!File.Exists(logo))throw SimRfqIntakeProblem.Conflict("QUOTE_LOGO","The approved DLE logo asset is not installed. PDF generation is unavailable.");
                Directory.CreateDirectory(directory);
                var token=Guid.NewGuid().ToString("N");var input=Path.Combine(directory,token+".json");var temporary=Path.Combine(directory,token+".pdf");
                try {
                    await File.WriteAllTextAsync(input,JsonSerializer.Serialize(projection));
                    var python=Environment.GetEnvironmentVariable("DLE_OS_SIM_BOM_PYTHON")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".cache","codex-runtimes","codex-primary-runtime","dependencies","python","python.exe");
                    var info=new ProcessStartInfo(python){UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true,RedirectStandardOutput=true};
                    foreach(var arg in new[]{Path.Combine(AppContext.BaseDirectory,"sim_quotation_pdf.py"),input,logo,temporary})info.ArgumentList.Add(arg);
                    using var process=Process.Start(info)??throw new IOException("PDF renderer could not start.");
                    var stderr=process.StandardError.ReadToEndAsync();var stdout=process.StandardOutput.ReadToEndAsync();
                    using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(45));
                    try{await process.WaitForExitAsync(timeout.Token);}catch(OperationCanceledException){process.Kill(true);throw new IOException("PDF generation timed out.");}
                    await Task.WhenAll(stderr,stdout);
                    if(process.ExitCode!=0)throw new IOException("PDF renderer failed.");
                    var bytes=await File.ReadAllBytesAsync(temporary);
                    if(bytes.Length<500||System.Text.Encoding.ASCII.GetString(bytes,0,5)!="%PDF-")throw new IOException("Invalid PDF output.");
                    var hash=Convert.ToHexString(SHA256.HashData(bytes));
                    await File.WriteAllTextAsync(Path.Combine(directory,"manifest.json"),JsonSerializer.Serialize(new{renderer="DLE_QUOTE_PDF_V2",quoteNumber=SimQuotationPdf.QuoteNumber(approval),sha256=hash,approval},jsonOptions));
                    File.Move(temporary,pdf,false);
                }finally{if(File.Exists(input))File.Delete(input);if(File.Exists(temporary))File.Delete(temporary);}
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
