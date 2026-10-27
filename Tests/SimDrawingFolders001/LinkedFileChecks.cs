using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
internal static class LinkedFileChecks
{
    internal static async Task Run(string fixture, string dataPath, SimRfqIntakeRecord saved, SimPersona actor, SimDrawingFolders sources)
    {
        var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var r=saved with{Status="TECHNICAL_REVIEW_IN_PROGRESS",RequestCorrelationId=Guid.NewGuid().ToString("D")};
        await File.WriteAllTextAsync(dataPath,JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",version=1,lastIntakeSequence=9001,updatedAtUtc=DateTimeOffset.UtcNow,records=new[]{r}},json));
        var store=new SimRfqIntakeStore(Path.Combine(fixture,"state"));
        var sourcePath=Path.Combine(fixture,"nas","Customer","Assembly","Rev A","drawing.txt");
        var relative="Customer/Assembly/Rev A/drawing.txt";
        void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS "+message);}
        async Task Reject(Func<Task> operation,string message){try{await operation();}catch(SimRfqIntakeProblem){Console.WriteLine("PASS "+message);return;}throw new Exception(message);}
        async Task<SimRfqIntakeRecord> Record()=>JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
        async Task<SimLinkedFileRequest> Select(string path= "Customer/Assembly/Rev A/drawing.txt",string role="BOM_REFERENCE",string type="BOM_ONLY"){
            var v=JsonSerializer.SerializeToElement(await store.DescribeLinkedDrawingFile(r.IntakeId,1,path,role,sources),json);
            Check(!v.ToString().Contains(fixture),"descriptor does not expose physical root or source bytes");
            return new(1,v.GetProperty("folderToken").GetString()!,path,role,v.GetProperty("source").GetProperty("sourceToken").GetString()!,Guid.NewGuid().ToString("D"),type);
        }
        async Task Save(SimLinkedFileRequest request)=>await store.AddReviewDocument(r.IntakeId,"",0,new(request.Type,"PARENT_ASSEMBLY"),Stream.Null,actor,request,sources);
        var directory=Path.GetDirectoryName(sourcePath)!;
        var empty=Path.Combine(directory,"empty.txt");await File.WriteAllTextAsync(empty,"");
        await Reject(()=>store.DescribeLinkedDrawingFile(r.IntakeId,1,"Customer/Assembly/Rev A/empty.txt","BOM_REFERENCE",sources),"empty file rejected");
        var large=Path.Combine(directory,"large.txt");using(var oversized=File.Create(large))oversized.SetLength(20*1024*1024+1);
        await Reject(()=>store.DescribeLinkedDrawingFile(r.IntakeId,1,"Customer/Assembly/Rev A/large.txt","BOM_REFERENCE",sources),"oversized file rejected before reading");
        var pristine=await File.ReadAllBytesAsync(dataPath);
        var selected=await Select();Check(pristine.SequenceEqual(await File.ReadAllBytesAsync(dataPath)),"file selection reads only and leaves dataset unchanged");
        await Reject(()=>store.DescribeLinkedDrawingFile(r.IntakeId,1,"Customer/elsewhere.txt","BOM_REFERENCE",sources),"outside linked folder rejected");
        await Reject(()=>store.DescribeLinkedDrawingFile(r.IntakeId,1,"Customer/Assembly/Rev A/../drawing.txt","BOM_REFERENCE",sources),"file traversal rejected");
        await Reject(()=>store.DescribeLinkedDrawingFile(r.IntakeId,1,relative,"DRAWING_REFERENCE",sources),"unsupported drawing TXT rejected");
        await Reject(()=>Save(selected with{LineNumber=2}),"wrong assembly selection rejected");
        await Reject(()=>Save(selected with{Type="DRAWING"}),"role/document type mismatch rejected");
        await File.AppendAllTextAsync(sourcePath," changed");
        await Reject(()=>Save(selected),"changed file rejected before snapshot");Check((await Record()).TechnicalFiles.Length==0,"stale save adds no documents");
        selected=await Select();var sourceBytes=await File.ReadAllBytesAsync(sourcePath);
        await Save(selected);var result=await Record();var file=result.TechnicalFiles.Single();var provenance=file.ReviewOrigin!.LinkedSource!;
        Check(provenance.RelativePath==relative&&provenance.RootId=="drawings"&&provenance.Sha256==Convert.ToHexString(SHA256.HashData(sourceBytes))&&provenance.AssemblyNumber=="TEST-A"&&provenance.Role=="BOM_REFERENCE","snapshot provenance and assembly context recorded");
        Check(JsonSerializer.Serialize(result.DrawingFolders,json)==JsonSerializer.Serialize(r.DrawingFolders,json),"saved folder association preserved");
        Check(result.TechnicalReview!.CandidateBom==r.TechnicalReview!.CandidateBom&&result.TechnicalReview.Workflow==r.TechnicalReview.Workflow&&result.TechnicalReview.PresentationDraft==r.TechnicalReview.PresentationDraft,"no BOM extraction, workflow or drawing selection changes");
        Check(result.TechnicalReview.TechnicalPackage!.GoverningBomDocumentId is null&&result.TechnicalReview.TechnicalPackage.Documents.Single().Role=="UNRESOLVED","new file is not governing or accepted");
        await Save(selected);Check((await Record()).TechnicalFiles.Length==1,"retry same selection does not duplicate snapshot");
        await File.WriteAllTextAsync(sourcePath,"later source revision");
        var opened=await store.OpenDocument(r.IntakeId,file.DocumentId!);Check(opened.Bytes.SequenceEqual(sourceBytes),"later source changes do not alter saved verified snapshot");
        File.Delete(sourcePath);await Save(selected);Check((await Record()).TechnicalFiles.Length==1,"uncertain-response retry returns existing copy even if original moved");
        try{await store.DescribeLinkedDrawingFile(r.IntakeId,1,relative,"BOM_REFERENCE",sources);throw new Exception("missing source accepted");}catch(FileNotFoundException){Console.WriteLine("PASS missing source fails before copy");}
        await File.WriteAllBytesAsync(sourcePath,sourceBytes);
        await Reject(()=>Save(selected with{SelectionId=Guid.NewGuid().ToString("D"),ExpectedFolderToken="stale"}),"stale folder token rejected");
        Check(sourceBytes.SequenceEqual(await File.ReadAllBytesAsync(sourcePath)),"save operations leave source bytes unchanged");
        var word=Path.Combine(directory,"reference.docx");
        using(var archive=System.IO.Compression.ZipFile.Open(word,System.IO.Compression.ZipArchiveMode.Create))
        {using var writer=new StreamWriter(archive.CreateEntry("word/document.xml").Open());writer.Write("<document>Synthetic reference</document>");}
        var drawing=await Select("Customer/Assembly/Rev A/reference.docx","DRAWING_REFERENCE","DRAWING");await Save(drawing);
        var afterDrawing=await Record();Check(afterDrawing.TechnicalFiles.Length==2&&afterDrawing.TechnicalReview!.PresentationDraft is null,"drawing copy saved without selecting reference or generating rendition");
        Check(afterDrawing.TechnicalFiles.Last().ReviewOrigin!.LinkedSource!.Role=="DRAWING_REFERENCE","drawing role provenance retained");
        Console.WriteLine("PASS linked-file synthetic tests; no active state or real source share accessed");
    }
}
