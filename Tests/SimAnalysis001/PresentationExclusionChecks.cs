using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class PresentationExclusionChecks
{
    internal static async Task Run(string sourceRoot,string root)
    {
        if(Directory.Exists(root))throw new Exception("Use a new isolated fixture directory.");
        var json=DleAnalysisContract.Json;
        var livePath=Path.Combine(sourceRoot,"data","rfq-intakes.json");
        var liveBytes=await File.ReadAllBytesAsync(livePath);
        var data=JsonNode.Parse(liveBytes)!;
        var record=data["records"]!.AsArray().Single(r=>r!["intakeId"]!.GetValue<string>()=="RFQI-SIM-0047")!.DeepClone();
        var id=record["intakeId"]!.GetValue<string>();
        var correlation=record["requestCorrelationId"]!.GetValue<string>();
        var fixturePath=Path.Combine(root,"data","rfq-intakes.json");
        Directory.CreateDirectory(Path.GetDirectoryName(fixturePath)!);
        data["records"]=new JsonArray(record);
        record["technicalReview"]!["presentationDraft"]!.AsObject().Remove("excludedSlideKeys");
        await File.WriteAllTextAsync(fixturePath,data.ToJsonString());
        var folder=Path.Combine(root,"intake-documents",correlation);
        Directory.CreateDirectory(folder);
        var sourceHashes=new Dictionary<string,string>();
        foreach(var doc in record["technicalFiles"]!.AsArray())
            foreach(var ext in new[]{".bin",".json"})
            {
                var name=doc!["documentId"]!.GetValue<string>()+ext;
                var bytes=await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,name));
                sourceHashes[name]=Convert.ToHexString(SHA256.HashData(bytes));
                await File.WriteAllBytesAsync(Path.Combine(folder,name),bytes);
            }
        var store=new SimRfqIntakeStore(root);
        var actor=new SimPersona("fixture","fixture","Draft exclusion test","ACTIVE",[],[],true,"test");
        JsonNode Node(object value)=>JsonSerializer.SerializeToNode(value,json)!;
        async Task<JsonNode> Read()=>Node(await new SimRfqIntakeStore(root).ReadPresentation(id));
        SimReviewPresentation Draft(JsonNode value)=>value["draft"]!.Deserialize<SimReviewPresentation>(json)!;
        void Check(bool success,string message){if(!success)throw new Exception(message);Console.WriteLine("PASS: "+message);}
        async Task<JsonNode> Save(SimReviewPresentation draft)
        {
            var v=await Read();
            return Node(await store.SavePresentation(id,new(Draft(v).Revision,v["bomToken"]!.GetValue<string>(),draft),actor));
        }
        async Task Denied(SimReviewPresentation draft,string code,string message)
        {
            var before=await File.ReadAllBytesAsync(fixturePath);
            try{await Save(draft);throw new Exception("Save was not rejected: "+message);}
            catch(SimRfqIntakeProblem error) when(error.Code==code){}
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(fixturePath)),message+" without writes");
        }
        var view=await Read();
        Check(Draft(view).ExcludedSlideKeys is null&&view["draft"]!["excludedSlideKeys"] is null,"older draft omits optional exclusions without migration");
        var baseline=view["record"]!.DeepClone();
        var reference=view["reference"]??throw new Exception("Fixture requires a linked PDF rendition.");
        var pdfId=reference["documentId"]!.GetValue<string>();
        Check(reference["pageCount"]!.GetValue<int>()>=2,"reference fixture includes page 2");
        var originalId=Draft(view).TeamDocumentId;
        var noteId=Guid.NewGuid().ToString("D");
        SimLaborSlideStage Stage(int page,string text)=>new(Guid.NewGuid().ToString("D"),"Retained named annotations",[new(Guid.NewGuid().ToString("D"),page,"text",[new(.27,.36)],text)],new(page,.5,.5,.8,.8));
        var note=new SimReviewSlide(noteId,"NOTE",noteId,null,1,"Retain instruction","Saved instruction content",Stage(1,"Saved note annotation"));
        var pdf=new SimReviewSlide(Guid.NewGuid().ToString("D"),"REFERENCE",reference["token"]!.GetValue<string>(),pdfId,2,"Reference page 2","Saved source annotations",Stage(2,"Saved page 2 annotation"));
        view=await Save(Draft(view) with{Slides=Draft(view).Slides.Concat(new[]{note,pdf}).ToArray()});
        var referenceKey="REFERENCE:"+pdfId+":2";
        var noteKey="NOTE:"+noteId;
        var order=new[]{"TRAVELER:1","BOM:1","REFERENCE:"+pdfId+":1",referenceKey,noteKey};
        var slides=view["draft"]!["slides"]!.DeepClone();
        view=await Save(Draft(view) with{SlideOrder=order,ExcludedSlideKeys=[referenceKey,noteKey]});
        view=await Read();
        Check(Draft(view).ExcludedSlideKeys!.SequenceEqual(new[]{referenceKey,noteKey}),"reference and note exclusions survive fresh-store reopen");
        Check(Draft(view).SlideOrder!.SequenceEqual(order)&&JsonNode.DeepEquals(slides,view["draft"]!["slides"]),"deleting from slideshow preserves order, source cards and nonempty annotation identities");
        var compared=view["record"]!.DeepClone();
        compared["technicalReview"]!["presentationDraft"]=baseline["technicalReview"]!["presentationDraft"]!.DeepClone();
        Check(JsonNode.DeepEquals(compared,baseline),"entire record outside presentation remains unchanged including source links, BOM and workflow status");
        Check(view["record"]!["technicalReview"]!["candidateBom"]!["rows"]!.AsArray().Count==6,"all six saved BOM rows remain unchanged");
        Check(Draft(view).TeamDocumentId==originalId&&Draft(view).RenditionDocumentId==pdfId,"original document and linked PDF stay selected");
        view=await Save(Draft(view) with{ExcludedSlideKeys=null});
        Check(Draft(view).ExcludedSlideKeys!.SequenceEqual(new[]{referenceKey,noteKey}),"older client save retains existing exclusions");
        view=await Save(Draft(view) with{ExcludedSlideKeys=[]});
        view=await Read();
        Check(Draft(view).ExcludedSlideKeys is {Length:0}&&Draft(view).SlideOrder!.SequenceEqual(order)&&JsonNode.DeepEquals(slides,view["draft"]!["slides"]),"explicit empty exclusions restores visibility without moving or removing saved content");
        view=await Save(Draft(view) with{ExcludedSlideKeys=[referenceKey,noteKey]});
        var current=Draft(view);
        await Denied(current with{ExcludedSlideKeys=["TRAVELER:1"]},"SIM_DRAFT_EXCLUSIONS","traveler exclusion rejected");
        await Denied(current with{ExcludedSlideKeys=["BOM:1"]},"SIM_DRAFT_EXCLUSIONS","BOM exclusion rejected");
        await Denied(current with{ExcludedSlideKeys=[referenceKey,referenceKey]},"SIM_DRAFT_EXCLUSIONS","duplicate exclusions rejected");
        await Denied(current with{ExcludedSlideKeys=["NOTE:"+Guid.NewGuid().ToString("D")]},"SIM_DRAFT_EXCLUSIONS","unknown instruction exclusion rejected");
        await Denied(current with{ExcludedSlideKeys=["REFERENCE:"+Guid.NewGuid().ToString("D")+":1"]},"SIM_DRAFT_EXCLUSIONS","unrelated reference exclusion rejected");
        await Denied(current with{ExcludedSlideKeys=["REFERENCE:"+originalId+":1"]},"SIM_DRAFT_EXCLUSIONS","non-PDF original exclusion rejected");
        foreach(var page in new[]{"0","501","02"})await Denied(current with{ExcludedSlideKeys=["REFERENCE:"+pdfId+":"+page]},"SIM_DRAFT_EXCLUSIONS","invalid page "+page+" rejected");
        await Denied(current with{ExcludedSlideKeys=["REFERENCE:not-a-guid:1"]},"SIM_DRAFT_EXCLUSIONS","malformed source key rejected");
        await Denied(current with{ExcludedSlideKeys=[null!]},"SIM_DRAFT_EXCLUSIONS","null exclusion rejected");
        await Denied(current with{ExcludedSlideKeys=[new string('X',101)]},"SIM_DRAFT_EXCLUSIONS","overlong exclusion rejected");
        await Denied(current with{ExcludedSlideKeys=Enumerable.Range(1,1101).Select(n=>"REFERENCE:"+pdfId+":"+n).ToArray()},"SIM_DRAFT_EXCLUSIONS","oversized exclusion list rejected");
        await Denied(current with{Slides=current.Slides.Where(s=>s.Id!=pdf.Id).ToArray()},"SIM_DRAFT_SLIDES","excluded reference annotations cannot be deleted from storage");
        await Denied(current with{Slides=current.Slides.Select(s=>s.Id==pdf.Id?s with{SourceToken="changed"}:s).ToArray()},"SIM_DRAFT_SOURCE","excluded source annotations cannot be rebound");
        var beforeStale=await File.ReadAllBytesAsync(fixturePath);
        try{await store.SavePresentation(id,new(current.Revision-1,view["bomToken"]!.GetValue<string>(),current),actor);throw new Exception("Stale exclusion accepted.");}
        catch(SimRfqIntakeProblem error) when(error.Code=="SIM_DRAFT_CHANGED"){}
        Check(beforeStale.SequenceEqual(await File.ReadAllBytesAsync(fixturePath)),"stale exclusion revision rejected without writes");
        // A source selection change makes old positions dormant rather than losing exclusions or marks.
        view=await Save(current with{TeamDocumentId=null,RenditionDocumentId=null});
        Check(view["reference"] is null&&Draft(view).ExcludedSlideKeys!.SequenceEqual(new[]{referenceKey,noteKey})&&JsonNode.DeepEquals(slides,view["draft"]!["slides"]),"source selection change preserves dormant excluded pages and annotations");
        view=await Save(Draft(view) with{TeamDocumentId=originalId,RenditionDocumentId=pdfId});
        Check(view["reference"] is not null&&Draft(view).ExcludedSlideKeys!.Contains(referenceKey),"returning to prior reference retains its saved exclusion");
        var dormantKey="REFERENCE:"+Guid.NewGuid().ToString("D")+":1";
        var fixture=JsonNode.Parse(await File.ReadAllTextAsync(fixturePath))!;
        fixture["records"]![0]!["technicalReview"]!["presentationDraft"]!["excludedSlideKeys"]!.AsArray().Add(dormantKey);
        await File.WriteAllTextAsync(fixturePath,fixture.ToJsonString());
        view=await Read();view=await Save(Draft(view));
        Check(Draft(view).ExcludedSlideKeys!.Contains(dormantKey),"previously retained dormant reference exclusion remains compatible");
        foreach(var item in sourceHashes)
        {
            var copied=await File.ReadAllBytesAsync(Path.Combine(folder,item.Key));
            var original=await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,item.Key));
            Check(Convert.ToHexString(SHA256.HashData(copied))==item.Value&&Convert.ToHexString(SHA256.HashData(original))==item.Value,"attachment bytes and metadata unchanged: "+item.Key);
        }
        Check(liveBytes.SequenceEqual(await File.ReadAllBytesAsync(livePath)),"live RFQI-SIM-0047 and all other saved scenarios untouched");
        await File.WriteAllTextAsync(Path.Combine(root,"result.json"),view.ToJsonString());
        Console.WriteLine("Fixture: "+root);
    }
}
