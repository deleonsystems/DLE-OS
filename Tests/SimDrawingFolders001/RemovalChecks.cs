using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
internal static class RemovalChecks
{
    internal static async Task Run(string fixture,string dataPath,SimPersona actor)
    {
        var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);var store=new SimRfqIntakeStore(Path.Combine(fixture,"state"));
        async Task<SimRfqIntakeRecord> Read()=>JsonNode.Parse(await File.ReadAllTextAsync(dataPath))!["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
        var initial=await Read();var id=initial.TechnicalFiles[0].DocumentId!;
        async Task Write(SimRfqIntakeRecord r,DleAnalysisJob[]? jobs=null)=>await File.WriteAllTextAsync(dataPath,JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",version=1,lastIntakeSequence=9001,updatedAtUtc=DateTimeOffset.UtcNow,records=new[]{r},analysisJobs=jobs??[]},json));
        async Task<string> Token()=>JsonSerializer.SerializeToElement(await store.ReadReviewDocumentRemoval(initial.IntakeId,id),json).GetProperty("token").GetString()!;
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+label);}
        async Task Reject(SimRfqIntakeRecord r,string label,DleAnalysisJob[]? jobs=null){await Write(r,jobs);var before=await File.ReadAllBytesAsync(dataPath);try{await store.ChangeReviewDocumentRemoval(r.IntakeId,id,new(await Token(),"REMOVE"),actor);throw new Exception(label);}catch(SimRfqIntakeProblem){Check(before.SequenceEqual(await File.ReadAllBytesAsync(dataPath)),label+"; data preserved");}}
        var originals=Directory.GetFiles(Path.Combine(fixture,"state","intake-documents"),"*",SearchOption.AllDirectories).ToDictionary(p=>p,p=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p))));
        var initialJson=JsonSerializer.Serialize(initial,json);var savedToken=await Token();
        await store.ChangeReviewDocumentRemoval(initial.IntakeId,id,new(savedToken,"REMOVE"),actor);
        var removed=await Read();Check(removed.TechnicalFiles.Length==initial.TechnicalFiles.Length-1&&!removed.TechnicalReview!.TechnicalPackage!.Documents.Any(d=>d.DocumentId==id),"removal hides active package/reference choices");
        Check(removed.ReviewDocumentRemovals!.Single().File==initial.TechnicalFiles[0]&&removed.ReviewDocumentRemovals![0].RemovedBy==actor.DisplayName,"removed copy and provenance archived with reviewer audit");
        Check(originals.All(x=>File.Exists(x.Key)&&x.Value==Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(x.Key)))) ,"all stored binary and manifest bytes retained");
        store=new SimRfqIntakeStore(Path.Combine(fixture,"state"));Check(JsonSerializer.SerializeToElement(await store.ReadReviewDocumentRemoval(initial.IntakeId,id),json).GetProperty("canRestore").GetBoolean(),"restore survives store reload");
        await store.ChangeReviewDocumentRemoval(initial.IntakeId,id,new(await Token(),"RESTORE"),actor);
        var restored=await Read();Check(JsonSerializer.Serialize(restored with{ReviewDocumentRemovals=null},json)==initialJson,"restore recovers exact active record without changing decisions");
        Check(restored.ReviewDocumentRemovals![0].RestoredAtUtc is not null&&restored.ReviewDocumentRemovals[0].RemovedAtUtc!=default,"remove/restore audit retained");
        try{await store.ChangeReviewDocumentRemoval(initial.IntakeId,id,new(savedToken,"REMOVE"),actor);throw new Exception("stale token allowed");}catch(SimRfqIntakeProblem){Console.WriteLine("PASS stale remove token rejected");}
        await Reject(initial with{TechnicalReview=initial.TechnicalReview! with{PresentationDraft=new(1,id,null,"UNKNOWN",[])}},"current drawing reference blocked");
        await Reject(initial with{TechnicalReview=initial.TechnicalReview! with{TechnicalPackage=initial.TechnicalReview.TechnicalPackage! with{GoverningBomDocumentId=id}}},"governing BOM blocked");
        await Reject(initial with{TechnicalReview=initial.TechnicalReview! with{PresentationDraft=new(1,null,null,"UNKNOWN",[new("slide","REFERENCE","token",id,1,"Fixture","",null!)])}},"slide source dependency blocked");
        await Reject(initial with{TechnicalReview=initial.TechnicalReview! with{PresentationDraft=new(1,null,null,"UNKNOWN",[],ProductionAcceptances:[new("accepted",1,"hash","Fixture",DateTimeOffset.UtcNow)])}},"accepted slide history protected");
        var now=DateTimeOffset.UtcNow;var job=new DleAnalysisJob(new("job","BUILD_CANDIDATE_BOM",initial.IntakeId,"A","R",1,id,[],1,10,"v","v","v","hash","rule","Fixture",now,now),"FAILED",now);
        await Reject(initial,"retained extraction history blocked",[job]);
        await Reject(initial with{Status="READY_FOR_RFQ_WORKING_QUEUE"},"released review blocked");
        await Write(initial);var noPermission=actor with{Permissions=[]};
        try{await store.ChangeReviewDocumentRemoval(initial.IntakeId,id,new(await Token(),"REMOVE"),noPermission);throw new Exception("permission bypass");}catch(SimRfqIntakeProblem){Console.WriteLine("PASS disposition permission required");}
        var tokenBefore=await Token();await Write(initial with{TechnicalReview=initial.TechnicalReview! with{ReviewerNotes="concurrent edit"}});
        try{await store.ChangeReviewDocumentRemoval(initial.IntakeId,id,new(tokenBefore,"REMOVE"),actor);throw new Exception("concurrent edit lost");}catch(SimRfqIntakeProblem){Check((await Read()).TechnicalReview!.ReviewerNotes=="concurrent edit","concurrent review edits preserved");}
        await Write(initial);await store.ChangeReviewDocumentRemoval(initial.IntakeId,id,new(await Token(),"REMOVE"),actor);
        var origin=initial.TechnicalFiles[0].ReviewOrigin!.LinkedSource!;
        var request=new SimLinkedFileRequest(origin.LineNumber,"unused",origin.RelativePath,origin.Role,origin.SourceToken,origin.SelectionId,"BOM_ONLY");
        try{await store.AddReviewDocument(initial.IntakeId,"",0,new("BOM_ONLY","PARENT_ASSEMBLY"),Stream.Null,actor,request,new SimDrawingFolders(null));throw new Exception("removed copy recreated by retry");}catch(SimRfqIntakeProblem p)when(p.Code=="SIM_LINKED_COPY_REMOVED"){Console.WriteLine("PASS old picker retry cannot recreate removed copy");}
        Check(originals.All(x=>File.Exists(x.Key)&&x.Value==Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(x.Key)))) ,"dependency tests never delete or alter retained binaries");
        Console.WriteLine("PASS synthetic removal/restore and dependency checks; no active records modified");
    }
}
