using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ProductionSlidesAcceptanceChecks
{
    internal static async Task Run(string sourceRoot,string root)
    {
        if(Directory.Exists(root))throw new Exception("Use a new isolated fixture directory.");
        var json=DleAnalysisContract.Json;var livePath=Path.Combine(sourceRoot,"data","rfq-intakes.json");var live=await File.ReadAllBytesAsync(livePath);
        var data=JsonNode.Parse(live)!;var record=data["records"]!.AsArray().Single(r=>r!["intakeId"]!.GetValue<string>()=="RFQI-SIM-0047")!.DeepClone();
        var id=record["intakeId"]!.GetValue<string>();var correlation=record["requestCorrelationId"]!.GetValue<string>();
        var path=Path.Combine(root,"data","rfq-intakes.json");Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        record["technicalReview"]!["presentationDraft"]!.AsObject().Remove("productionAcceptances");
        data["records"]=new JsonArray(record);await File.WriteAllTextAsync(path,data.ToJsonString());
        var folder=Path.Combine(root,"intake-documents",correlation);Directory.CreateDirectory(folder);var hashes=new Dictionary<string,string>();
        foreach(var document in record["technicalFiles"]!.AsArray())foreach(var extension in new[]{".bin",".json"})
        {
            var name=document!["documentId"]!.GetValue<string>()+extension;var bytes=await File.ReadAllBytesAsync(Path.Combine(sourceRoot,"intake-documents",correlation,name));
            hashes[name]=Convert.ToHexString(SHA256.HashData(bytes));await File.WriteAllBytesAsync(Path.Combine(folder,name),bytes);
        }
        var store=new SimRfqIntakeStore(root);var actor=new SimPersona("slide-reviewer","slide-reviewer","Production slide fixture reviewer","ACTIVE",[],[],false,"test");
        JsonNode Node(object value)=>JsonSerializer.SerializeToNode(value,json)!;
        async Task<JsonNode> Read()=>Node(await store.ReadPresentation(id));
        SimReviewPresentation Draft(JsonNode view)=>view["draft"]!.Deserialize<SimReviewPresentation>(json)!;
        SimProductionSlidesState State(JsonNode view)=>view["productionSlides"]!.Deserialize<SimProductionSlidesState>(json)!;
        void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS: "+name);}
        async Task Denied(Func<Task> run,string name)
        {
            var before=await File.ReadAllBytesAsync(path);
            try{await run();throw new Exception("Not rejected: "+name);}catch(SimRfqIntakeProblem){}
            Check(before.SequenceEqual(await File.ReadAllBytesAsync(path)),name+" is nonmutating");
        }
        async Task<JsonNode> Accept()
        {
            var view=await Read();var state=State(view);
            return Node(await store.AcceptProductionSlides(id,new(Draft(view).Revision,state.Fingerprint),actor));
        }
        async Task<JsonNode> Save(SimReviewPresentation draft)
        {
            var view=await Read();return Node(await store.SavePresentation(id,new(Draft(view).Revision,view["bomToken"]!.GetValue<string>(),draft),actor));
        }
        var beforeRead=await File.ReadAllBytesAsync(path);var view=await Read();var draft=Draft(view);var state=State(view);var baseline=view["record"]!.DeepClone();
        Check(state.CanAccept&&!state.Ready&&state.Acceptance is null&&beforeRead.SequenceEqual(await File.ReadAllBytesAsync(path)),"read computes saved deck fingerprint without acceptance or writes");
        await Denied(async()=>{await store.AcceptProductionSlides(id,new(draft.Revision-1,state.Fingerprint),actor);},"stale saved revision");
        await Denied(async()=>{await store.AcceptProductionSlides(id,new(draft.Revision,"stale"),actor);},"stale source fingerprint");
        view=await Accept();state=State(view);draft=Draft(view);
        Check(state.Ready&&state.Acceptance!.AcceptedBy==actor.DisplayName&&state.Acceptance.Revision==draft.Revision&&state.Acceptance.AcceptedAtUtc!=default,"explicit saved deck acceptance records reviewer, time, revision and fingerprint");
        var compared=view["record"]!.DeepClone();compared["technicalReview"]!["presentationDraft"]!.AsObject().Remove("productionAcceptances");
        Check(JsonNode.DeepEquals(compared,baseline),"acceptance changes only its audit; files, BOM, marks, order, exclusions, qualification and workflow stay unchanged");
        await store.RequireProductionSlidesAccepted(view["record"]!.Deserialize<SimRfqIntakeRecord>(json)!);
        var acceptedBytes=await File.ReadAllBytesAsync(path);await Accept();Check(acceptedBytes.SequenceEqual(await File.ReadAllBytesAsync(path)),"repeated current acceptance is idempotent without write");
        var audit=draft.ProductionAcceptances!;
        view=await Save(draft with{ProductionAcceptances=[new("forged",draft.Revision,"forged","Not the reviewer",DateTimeOffset.UtcNow)]});
        Check(!State(view).Ready&&Draft(view).ProductionAcceptances!.SequenceEqual(audit),"ordinary save cannot forge or erase acceptance history and requires current revision acceptance");
        view=await Accept();
        var noteId=Guid.NewGuid().ToString("D");var note=new SimReviewSlide(noteId,"NOTE",noteId,null,1,"Fixture instructions","Known draft instructions",new(Guid.NewGuid().ToString("D"),"Draft annotations",[],new(1,.5,.5,1,1)));
        view=await Save(Draft(view) with{Slides=Draft(view).Slides.Append(note).ToArray()});
        Check(!State(view).Ready&&Draft(view).ProductionAcceptances!.Length==2,"added instruction invalidates acceptance and retains prior audit");view=await Accept();
        draft=Draft(view);var notes=draft.Slides.ToArray();var index=Array.FindIndex(notes,s=>s.Id==noteId);notes[index]=notes[index] with{Body="Edited saved instruction"};
        view=await Save(draft with{Slides=notes});Check(!State(view).Ready,"instruction text change invalidates acceptance");view=await Accept();
        draft=Draft(view);var reference=draft.RenditionDocumentId??draft.TeamDocumentId;view=await Save(draft with{SlideOrder=["TRAVELER:1","BOM:1","NOTE:"+noteId,"REFERENCE:"+reference+":1"]});
        Check(!State(view).Ready,"saved slide ordering invalidates acceptance");view=await Accept();
        draft=Draft(view);notes=draft.Slides.ToArray();index=Array.FindIndex(notes,s=>s.Id==noteId);
        notes[index]=notes[index] with{Stage=notes[index].Stage with{Marks=[new(Guid.NewGuid().ToString("D"),1,"text",[new(.2,.2)],"Fixture annotation")]}};
        view=await Save(draft with{Slides=notes});Check(!State(view).Ready&&Draft(view).Slides[index].Stage.Marks.Length==1,"saved annotation invalidates acceptance while preserving its source identity");view=await Accept();
        draft=Draft(view);notes=draft.Slides.ToArray();notes[index]=notes[index] with{Stage=notes[index].Stage with{SavedView=new(1,.5,.5,.8,.8)}};
        view=await Save(draft with{Slides=notes});Check(!State(view).Ready&&Draft(view).Slides[index].Stage.Marks.Length==1,"saved annotation view invalidates acceptance and retains marks");view=await Accept();
        view=Node(await store.SaveReviewReference(id,new(Draft(view).Revision,view["bomToken"]!.GetValue<string>(),Draft(view).TeamDocumentId),actor));
        Check(!State(view).Ready&&Draft(view).Slides.Any(s=>s.Id==noteId),"reference selection save requires current deck acceptance without removing annotations");view=await Accept();
        view=await Save(Draft(view) with{ExcludedSlideKeys=(Draft(view).ExcludedSlideKeys??[]).Append("NOTE:"+noteId).Distinct().ToArray()});
        Check(!State(view).Ready&&Draft(view).Slides.Any(s=>s.Id==noteId),"saved exclusion invalidates acceptance while retaining instruction data");view=await Accept();
        var savedFixture=await File.ReadAllTextAsync(path);
        async Task ChangedSource(Action<JsonNode> change,string name)
        {
            var current=JsonNode.Parse(savedFixture)!;change(current["records"]![0]!);await File.WriteAllTextAsync(path,current.ToJsonString());
            var changed=await Read();Check(!State(changed).Ready&&Draft(changed).ProductionAcceptances!.Length==Draft(view).ProductionAcceptances!.Length,name+" invalidates without deleting acceptance audit");
            await Denied(async()=>{await store.AcceptProductionSlides(id,new(Draft(view).Revision,State(view).Fingerprint),actor);},name+" stale acceptance");
            await File.WriteAllTextAsync(path,savedFixture);
        }
        await ChangedSource(r=>r["technicalReview"]!["candidateBom"]!["rows"]![0]!["values"]!["description"]="Concurrent saved BOM value","BOM content change");
        await ChangedSource(r=>r["assemblies"]![0]!["quantity"]=2,"traveler quantity change");
        await ChangedSource(r=>r["customer"]!["customerName"]="Changed traveler customer","traveler customer change");
        await ChangedSource(r=>r["technicalReview"]!["presentationDraft"]!["referenceStatus"]="CUSTOMER_RELEASED","reference status change");
        foreach(var source in new[]{Draft(view).TeamDocumentId,Draft(view).RenditionDocumentId}.Where(x=>x is not null).Distinct())
        {
            var binary=Path.Combine(folder,source+".bin");var bytes=await File.ReadAllBytesAsync(binary);var corrupted=bytes.ToArray();corrupted[^1]^=1;await File.WriteAllBytesAsync(binary,corrupted);
            var invalid=await Read();Check(!State(invalid).CanAccept&&!State(invalid).Ready,"original/rendition hash mismatch blocks acceptance: "+source);
            await Denied(async()=>{await store.AcceptProductionSlides(id,new(Draft(view).Revision,State(view).Fingerprint),actor);},"unverified source acceptance");await File.WriteAllBytesAsync(binary,bytes);
        }
        var altered=JsonNode.Parse(savedFixture)!;altered["records"]![0]!["technicalFiles"]![0]!["name"]="renamed-original.docx";await File.WriteAllTextAsync(path,altered.ToJsonString());
        Check(!State(await Read()).CanAccept,"changed original filename metadata fails stored-source verification");await File.WriteAllTextAsync(path,savedFixture);
        foreach(var status in new[]{"ON_HOLD","READY_FOR_RFQ_WORKING_QUEUE"})
        {
            altered=JsonNode.Parse(savedFixture)!;altered["records"]![0]!["status"]=status;await File.WriteAllTextAsync(path,altered.ToJsonString());
            if(status=="ON_HOLD")Check(!State(await Read()).CanAccept,"hold blocks acceptance readiness while saved deck remains intact");
            await Denied(async()=>{await store.AcceptProductionSlides(id,new(Draft(view).Revision,State(view).Fingerprint),actor);},status+" acceptance");
        }
        await File.WriteAllTextAsync(path,savedFixture);view=await Read();
        Check(State(view).Ready,"fresh-store read verifies the unchanged accepted saved deck");
        foreach(var item in hashes)Check(Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(folder,item.Key))))==item.Value,"source/rendition bytes and metadata retained: "+item.Key);
        Check(live.SequenceEqual(await File.ReadAllBytesAsync(livePath)),"actual SIM dataset remains byte-for-byte unchanged; no actual acceptance or submission");
        Console.WriteLine("Fixture: "+root);
    }
}
