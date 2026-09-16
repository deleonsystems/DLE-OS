using System.Text.Json;
internal static class LaborNoteChecks
{
    internal static async Task Run(string root, SimRfqIntakeRecord record, SimPersona persona)
    {
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: Labor notes "+label);}
        async Task Block(Func<Task> action,string label){try{await action();}catch(SimRfqIntakeProblem){Check(true,label);return;}throw new Exception(label);}
        var store=new SimRfqIntakeStore(root);var id=record.IntakeId;var view=await store.ReadLabor(id);
        var materials=JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote);
        var priorVersions=JsonSerializer.Serialize(view.Plan.Versions);
        var source=await File.ReadAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"));
        SimLaborRequest Request(SimLaborOperation[] rows,bool complete=false)=>new(view.Plan.Revision,view.Plan.DefinitionId,view.Plan.Quantity,rows,75,0,complete,view.Plan.CalculationVersion,1,1);
        var p=new SimLaborOperation("note-parent","SMT Setup",Instructions:"General instruction",OperationQuantity:1,RunSeconds:900);
        var c=new SimLaborOperation("note-child","Feeder Setup",ParentId:p.Id,OperationQuantity:55,RunSeconds:30);
        var other=new SimLaborOperation("note-other","Kitting",OperationQuantity:0,RunSeconds:0);
        var production=new SimLaborNote(Guid.NewGuid().ToString("D"),p.Id,"PRODUCTION","Use synthetic tool HT-101.",Author:"Forged",CreatedAt:DateTimeOffset.MinValue);
        var internalNote=new SimLaborNote(Guid.NewGuid().ToString("D"),c.Id,"INTERNAL_RFQ","Quoted assuming a supplied stencil.");
        SimLaborOperation[] rows=[p with{Notes=[production]},c with{Notes=[internalNote]},other];
        await Block(()=>store.SaveLabor(id,Request(rows) with{NoteContractVersion=0},persona),"legacy client cannot introduce notes");
        foreach(var bad in new[]{production with{Purpose="OTHER"},production with{Text=" "},production with{Text=new string('x',2001)},production with{RowId=c.Id}})
            await Block(()=>store.SaveLabor(id,Request([p with{Notes=[bad]}]),persona),"invalid purpose/text/row rejected");
        view=await store.SaveLabor(id,Request(rows,true),persona);
        var note=view.Plan.Operations[0].Notes![0];
        Check(note.Author==persona.DisplayName&&note.CreatedAt>DateTimeOffset.MinValue&&note.Sequence=="10"&&view.Plan.Operations[1].Notes![0].Sequence=="10.1","server stamps author/time and parent/child sequence");
        var versions=JsonSerializer.Serialize(view.Plan.Versions);
        Check(JsonSerializer.Serialize(view.Plan.Versions.Take(view.Plan.Versions.Length-1))==priorVersions,"existing completed versions unchanged");
        await Block(()=>store.SaveLabor(id,Request(view.Plan.Operations) with{NoteContractVersion=0},persona),"older client cannot erase saved notes");
        await Block(()=>store.SaveLabor(id,Request([other with{Notes=[note with{RowId=other.Id}]}]),persona),"existing note cannot move to a different row");
        rows=view.Plan.Operations;
        view=await store.SaveLabor(id,Request([rows[2],rows[0],rows[1]]),persona);
        view=await new SimRfqIntakeStore(root).ReadLabor(id);
        Check(view.Plan.Operations[1].Id==p.Id&&view.Plan.Operations[1].Notes![0].Id==production.Id&&view.Plan.Operations[2].Notes![0].Purpose=="INTERNAL_RFQ","reorder and restart preserve stable row associations and purposes");
        Check(view.Plan.Operations[1].Instructions=="General instruction"&&view.Totals.TotalSeconds==1650&&JsonSerializer.Serialize(view.Rfq.Lanes.MaterialsQuote)==materials,"instructions math and Materials remain independent");
        rows=view.Plan.Operations.Select(o=>o.Id==p.Id?o with{Notes=[note with{Text="Edited synthetic HT-101 note",Author="Forged again"}]}:o).ToArray();
        view=await store.SaveLabor(id,Request(rows),persona);
        var edited=view.Plan.Operations[1].Notes![0];
        Check(edited.Author==note.Author&&edited.CreatedAt==note.CreatedAt&&edited.UpdatedBy==persona.DisplayName&&edited.UpdatedAt is not null,"edit preserves original authorship and records editor/time");
        view=await store.SaveLabor(id,Request(view.Plan.Operations.Select(o=>o.Id==c.Id?o with{Notes=o.Notes!.Select(n=>n with{Removed=true}).ToArray()}:o).ToArray()),persona);
        Check(view.Plan.Operations[2].Notes![0].RemovedAt is not null&&JsonSerializer.Serialize(view.Plan.Versions)==versions,"removal audited without rewriting completed snapshot");
        view=await store.SaveLabor(id,Request([other]),persona);
        view=await new SimRfqIntakeStore(root).ReadLabor(id);
        Check(view.Plan.RemovedNotes!.Length==2&&view.Plan.RemovedNotes.All(n=>n.Removed),"row deletion retains note audit across restart");
        Check(await File.ReadAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"))==source,"Intake and Technical Review bytes unchanged");
        Check(!JsonSerializer.Serialize(other).Contains("Notes")&&!JsonSerializer.Serialize(other).Contains("Visuals"),"absent optional content does not add fields to unrelated rows");
    }
}
