using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class PresentationOrderChecks
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
        // Exercise pre-arrangement records even if the caller already has an arrangement.
        record["technicalReview"]!["presentationDraft"]!.AsObject().Remove("slideOrder");
        await File.WriteAllTextAsync(fixturePath,data.ToJsonString());
        var docFolder=Path.Combine(root,"intake-documents",correlation);
        Directory.CreateDirectory(docFolder);
        var originalDocumentHashes=new Dictionary<string,string>();
        foreach(var doc in record["technicalFiles"]!.AsArray())
            foreach(var ext in new[]{".bin",".json"})
            {
                var name=doc!["documentId"]!.GetValue<string>()+ext;
                var source=Path.Combine(sourceRoot,"intake-documents",correlation,name);
                var bytes=await File.ReadAllBytesAsync(source);
                originalDocumentHashes[name]=Convert.ToHexString(SHA256.HashData(bytes));
                await File.WriteAllBytesAsync(Path.Combine(docFolder,name),bytes);
            }
        var store=new SimRfqIntakeStore(root);
        var actor=new SimPersona("fixture","fixture","Draft arrangement test","ACTIVE",[],[],true,"test");
        JsonNode Node(object value)=>JsonSerializer.SerializeToNode(value,json)!;
        async Task<JsonNode> Read()=>Node(await new SimRfqIntakeStore(root).ReadPresentation(id));
        SimReviewPresentation Draft(JsonNode value)=>value["draft"]!.Deserialize<SimReviewPresentation>(json)!;
        void Check(bool success,string message){if(!success)throw new Exception(message);Console.WriteLine("PASS: "+message);}
        async Task<JsonNode> Save(SimReviewPresentation draft)
        {
            var current=await Read();
            return Node(await store.SavePresentation(id,new(current["draft"]!["revision"]!.GetValue<int>(),current["bomToken"]!.GetValue<string>(),draft),actor));
        }
        async Task Denied(SimReviewPresentation draft,string code,string message)
        {
            var before=await File.ReadAllBytesAsync(fixturePath);
            try{await Save(draft);throw new Exception("Save was not rejected: "+message);}
            catch(SimRfqIntakeProblem error) when(error.Code==code){}
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(fixturePath)),message+" without changing the fixture");
        }
        var view=await Read();
        Check(Draft(view).SlideOrder is null&&view["draft"]!["slideOrder"] is null,"older draft opens without arrangement metadata");
        var baseline=view["record"]!.DeepClone();
        var bomToken=view["bomToken"]!.GetValue<string>();
        var reference=view["reference"]??throw new Exception("Fixture requires an existing linked PDF rendition.");
        var pdfId=reference["documentId"]!.GetValue<string>();
        var pdfToken=reference["token"]!.GetValue<string>();
        SimLaborSlideStage Stage(string text)=>new(Guid.NewGuid().ToString("D"),"Saved annotations",[new(Guid.NewGuid().ToString("D"),1,"text",[new(.23,.31)],text)],new(1,.5,.5,.8,.8));
        var firstId=Guid.NewGuid().ToString("D");
        var secondId=Guid.NewGuid().ToString("D");
        var first=new SimReviewSlide(firstId,"NOTE",firstId,null,1,"First instruction","Keep source details",Stage("First saved mark"));
        var second=new SimReviewSlide(secondId,"NOTE",secondId,null,1,"Second instruction","Inspect assembly",Stage("Second saved mark"));
        var bom=new SimReviewSlide(Guid.NewGuid().ToString("D"),"BOM",bomToken,null,1,"BOM annotation","",Stage("Saved BOM mark"));
        var pdf=new SimReviewSlide(Guid.NewGuid().ToString("D"),"REFERENCE",pdfToken,pdfId,1,"PDF annotation","",Stage("Saved reference mark"));
        view=await Save(Draft(view) with{Slides=Draft(view).Slides.Concat(new[]{first,second,bom,pdf}).ToArray()});
        var slides=view["draft"]!["slides"]!.DeepClone();
        var order=new[]{"TRAVELER:1","BOM:1","REFERENCE:"+pdfId+":1","NOTE:"+secondId,"REFERENCE:"+pdfId+":2","NOTE:"+firstId};
        view=await Save(Draft(view) with{SlideOrder=order});
        view=await Read();
        Check(Draft(view).SlideOrder!.SequenceEqual(order),"arrangement survives fresh-store reopen without operations");
        Check(JsonNode.DeepEquals(slides,view["draft"]!["slides"]),"organizing preserves nonempty notes, mark identities, source bindings and camera views");
        var preserved=view["record"]!.DeepClone();
        preserved["technicalReview"]!["presentationDraft"]=baseline["technicalReview"]!["presentationDraft"]!.DeepClone();
        Check(JsonNode.DeepEquals(preserved,baseline),"all record fields outside draft remain unchanged, including BOM, approval, qualification and attachments");
        Check(view["record"]!["technicalReview"]!["candidateBom"]!["rows"]!.AsArray().Count==6,"all six saved BOM rows remain");
        view=await Save(Draft(view) with{SlideOrder=null});
        Check(Draft(view).SlideOrder!.SequenceEqual(order),"older client save retains an existing arrangement");
        var current=Draft(view);
        await Denied(current with{SlideOrder=["TRAVELER:1","TRAVELER:1"]},"SIM_DRAFT_ORDER","duplicate positions rejected");
        await Denied(current with{SlideOrder=["NOTE:"+Guid.NewGuid().ToString("D")]},"SIM_DRAFT_ORDER","unknown note rejected");
        await Denied(current with{SlideOrder=["REFERENCE:"+Guid.NewGuid().ToString("D")+":1"]},"SIM_DRAFT_ORDER","unrelated PDF reference rejected");
        await Denied(current with{SlideOrder=["REFERENCE:"+current.TeamDocumentId+":1"]},"SIM_DRAFT_ORDER","non-PDF original rejected as a viewing page");
        await Denied(current with{SlideOrder=["BOM:0"]},"SIM_DRAFT_ORDER","page zero rejected");
        await Denied(current with{SlideOrder=["BOM:501"]},"SIM_DRAFT_ORDER","page above 500 rejected");
        await Denied(current with{SlideOrder=["BOM:01"]},"SIM_DRAFT_ORDER","ambiguous noncanonical page key rejected");
        await Denied(current with{SlideOrder=[null!]},"SIM_DRAFT_ORDER","null position rejected");
        await Denied(current with{SlideOrder=[new string('X',101)]},"SIM_DRAFT_ORDER","oversized position rejected");
        await Denied(current with{SlideOrder=Enumerable.Range(1,1101).Select(i=>"BOM:"+i).ToArray()},"SIM_DRAFT_ORDER","oversized arrangement rejected");
        await Denied(current with{Slides=current.Slides.Where(s=>s.Id!=firstId).ToArray()},"SIM_DRAFT_SLIDES","organizing cannot drop existing annotations");
        await Denied(current with{Slides=current.Slides.Select(s=>s.Id==pdf.Id?s with{SourceToken="other source"}:s).ToArray()},"SIM_DRAFT_SOURCE","organizing cannot rebind source annotations");
        var bytesBeforeStale=await File.ReadAllBytesAsync(fixturePath);
        try{await store.SavePresentation(id,new(current.Revision-1,bomToken,current),actor);throw new Exception("Stale arrangement accepted.");}
        catch(SimRfqIntakeProblem error) when(error.Code=="SIM_DRAFT_CHANGED"){}
        Check(bytesBeforeStale.SequenceEqual(await File.ReadAllBytesAsync(fixturePath)),"stale arrangement rejected without writes");
        // Retained references can be dormant after selection changes; they are not annotations on the new source.
        var dormantId=Guid.NewGuid().ToString("D");
        var dormantKey="REFERENCE:"+dormantId+":1";
        var fixture=JsonNode.Parse(await File.ReadAllTextAsync(fixturePath))!;
        var fixtureDraft=fixture["records"]![0]!["technicalReview"]!["presentationDraft"]!;
        fixtureDraft["slideOrder"]!.AsArray().Add(dormantKey);
        await File.WriteAllTextAsync(fixturePath,fixture.ToJsonString());
        view=await Read();
        view=await Save(Draft(view));
        Check(Draft(view).SlideOrder!.Contains(dormantKey),"existing dormant reference position remains saved");
        var edited=Draft(view).Slides.Select(s=>s.Id==firstId?s with{Body="Updated instructions",Stage=s.Stage with{Marks=s.Stage.Marks.Append(new(Guid.NewGuid().ToString("D"),1,"text",[new(.45,.42)],"New draft mark")).ToArray()}}:s).ToArray();
        view=await Save(Draft(view) with{Slides=edited});
        view=await Read();
        var reopened=Draft(view);
        Check(reopened.SlideOrder!.Contains(dormantKey)&&reopened.SlideOrder!.Where(k=>k!=dormantKey).SequenceEqual(order)&&reopened.Slides.Single(s=>s.Id==firstId).Stage.Marks.Length==2&&reopened.Slides.Single(s=>s.Id==firstId).Body=="Updated instructions","edit, save and reopen retain arrangement plus original and new marks");
        foreach(var document in originalDocumentHashes)
        {
            var copied=await File.ReadAllBytesAsync(Path.Combine(docFolder,document.Key));
            var original=await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,document.Key));
            Check(Convert.ToHexString(SHA256.HashData(copied))==document.Value&&Convert.ToHexString(SHA256.HashData(original))==document.Value,"attachment bytes and metadata preserved: "+document.Key);
        }
        Check(liveBytes.SequenceEqual(await File.ReadAllBytesAsync(livePath)),"live SIM scenarios untouched by isolated fixture checks");
        await File.WriteAllTextAsync(Path.Combine(root,"result.json"),view.ToJsonString());
        Console.WriteLine("Fixture: "+root);
    }
}
