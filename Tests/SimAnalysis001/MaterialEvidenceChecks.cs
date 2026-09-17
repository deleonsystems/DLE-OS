using System.Text;
using System.Text.Json;
internal static class MaterialEvidenceChecks
{
    internal static async Task Run(string root,SimRfqIntakeRecord record,SimPersona persona)
    {
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: Material evidence "+label);}
        async Task Block(Func<Task> action,string label){try{await action();}catch(SimRfqIntakeProblem){Check(true,label);return;}throw new Exception(label);}
        var path=Path.Combine(root,"data","rfq-lanes.json");var before=await File.ReadAllTextAsync(path);
        try{
            var store=new SimRfqIntakeStore(root);var v=await store.ReadMaterials(record.IntakeId);var first=v.Plan.Rows[0];
            var legacyVersions=JsonSerializer.Serialize(v.Plan.Versions);var labor=JsonSerializer.Serialize(v.Rfq.Lanes.LaborQuote);
            var fee=new SimMaterialCharge(Guid.NewGuid().ToString("D"),"Synthetic evidence fee","OTHER",2,"BLEND","NONE");
            SimMaterialEvidenceUpload Upload(string? feeId,string kind="FILE")=>new(v.Plan.Revision,v.Plan.CandidateId,v.Plan.BomVersion,first.Index,feeId,kind,"VENDOR_QUOTE");
            var pdf=Encoding.ASCII.GetBytes("%PDF-1.4\n% SYNTHETIC INTERNAL MATERIAL EVIDENCE\n%%EOF");
            var png=Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=");
            var parentFile=await store.StageMaterialAttachment(record.IntakeId,Upload(null),"synthetic-supplier.pdf",new MemoryStream(pdf),persona);
            var parentVisual=await store.StageMaterialAttachment(record.IntakeId,Upload(null,"VISUAL"),"synthetic-parent.png",new MemoryStream(png),persona);
            var feeFile=await store.StageMaterialAttachment(record.IntakeId,Upload(fee.Id),"synthetic-fee.pdf",new MemoryStream(pdf),persona);
            var feeVisual=await store.StageMaterialAttachment(record.IntakeId,Upload(fee.Id,"VISUAL"),"synthetic-fee.png",new MemoryStream(png),persona);
            SimMaterialNote Note(string? feeId)=>new(Guid.NewGuid().ToString("D"),SimRfqIntakeStore.MaterialOwner(v.Plan,first.Index,feeId),"SOURCING_PURCHASING","SYNTHETIC PRIVATE EVIDENCE","forged author");
            var parentNote=Note(null);var feeNote=Note(fee.Id);
            var rows=v.Plan.Rows.Select(r=>r.Index==first.Index?r with{Evidence=new([parentNote],[parentFile,parentVisual]),Charges=[fee with{Evidence=new([feeNote],[feeFile,feeVisual])}]}:r).ToArray();
            SimMaterialRequest Request(SimMaterialRow[] values,bool complete=false)=>new(v.Plan.Revision,values,complete,v.Plan.MarkupPercent,2,1);
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(rows) with{EvidenceContractVersion=0},persona),"old client blocked");
            var swapped=rows.Select(r=>r.Index==first.Index?r with{Evidence=new([parentNote],[feeFile])}:r).ToArray();
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(swapped),persona),"fee file cannot move to parent");
            await Block(()=>store.StageMaterialAttachment(record.IntakeId,Upload(null) with{CandidateId="wrong"},"test.pdf",new MemoryStream(pdf),persona),"stale BOM upload blocked");
            await Block(()=>store.StageMaterialAttachment(record.IntakeId,Upload(null,"VISUAL"),"test.png",new MemoryStream(pdf),persona),"invalid image signature blocked");
            await Block(()=>store.StageMaterialAttachment(record.IntakeId,Upload(null),"test.exe",new MemoryStream(pdf),persona),"executable attachment blocked");
            v=await store.SaveMaterials(record.IntakeId,Request(rows),persona);
            v=await new SimRfqIntakeStore(root).ReadMaterials(record.IntakeId);
            Check(v.Plan.Rows[0].Evidence!.Notes.Single().Author==persona.DisplayName&&v.Plan.Rows[0].Evidence!.Notes.Single().CreatedAt!=default,"server-owned note author and timestamp survive reopen");
            Check(v.Plan.Rows[0].Charges![0].Evidence!.Attachments.Length==2&&v.Plan.Rows[0].Evidence!.Attachments.Length==2,"parent and fee references survive new store");
            foreach(var a in new[]{parentFile,parentVisual,feeFile,feeVisual}){var opened=await new SimRfqIntakeStore(root).OpenMaterialAttachment(record.IntakeId,a.DocumentId);Check(opened.Bytes.SequenceEqual(a.Kind=="VISUAL"?png:pdf),"verified staged bytes reopen "+a.Name);}
            var forged=v.Plan.Rows.Select(r=>r.Index==first.Index?r with{Evidence=r.Evidence! with{Attachments=r.Evidence!.Attachments.Select(a=>a with{Name="forged",Sha256="forged",AddedBy="forged"}).ToArray()}}:r).ToArray();
            v=await store.SaveMaterials(record.IntakeId,Request(forged),persona);
            Check(v.Plan.Rows[0].Evidence!.Attachments[0].Name==parentFile.Name&&v.Plan.Rows[0].Evidence!.Attachments[0].AddedBy==persona.DisplayName,"attachment metadata restored from verified upload journal");
            var completeRows=v.Plan.Rows.Select(r=>r with{Vendor="Synthetic",VendorSource="MANUAL_QUOTE_ONLY",UnitPrice=2,LeadDays=1,LeadTimeMode=null,LeadTimeValue=null,Notes="Synthetic supply assumption",OrderQuantityMode="AUTO"}).ToArray();
            v=await store.SaveMaterials(record.IntakeId,Request(completeRows,true),persona);
            var count=v.Plan.Versions.Length;var snapshot=JsonSerializer.Serialize(v.Plan.Versions.Last());
            v=await store.SaveMaterials(record.IntakeId,Request(v.Plan.Rows,true),persona);
            Check(v.Plan.Versions.Length==count,"unchanged recompletion remains idempotent");
            var removed=v.Plan.Rows.Select(r=>r.Index==first.Index?r with{Evidence=r.Evidence! with{Attachments=r.Evidence!.Attachments.Select(a=>a with{Removed=true}).ToArray()}}:r).ToArray();
            v=await store.SaveMaterials(record.IntakeId,Request(removed),persona);
            Check(JsonSerializer.Serialize(v.Plan.Versions.Last())==snapshot&&v.Plan.Rows[0].Evidence!.Attachments.All(a=>a.Removed),"working removal retains immutable completed references");
            Check((await store.OpenMaterialAttachment(record.IntakeId,parentVisual.DocumentId)).Bytes.SequenceEqual(png),"removed working visual stays available to historical reference");
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(v.Plan.Rows) with{EvidenceContractVersion=0},persona),"legacy save cannot strip persisted evidence");
            var altered=v.Plan.Rows.Select(r=>r.Index==first.Index?r with{Evidence=r.Evidence! with{Notes=[parentNote with{Text="altered"}]}}:r).ToArray();
            await Block(()=>store.SaveMaterials(record.IntakeId,Request(altered),persona),"original note audit cannot be overwritten");
            var final=await store.ReadFinalReview(record.IntakeId);
            var projection=JsonSerializer.Serialize(SimQuotationPdf.CustomerProjection(new("test",1,"token",final.Summary with{MaterialsComplete=true,LaborComplete=true,CombinedUnitPrice=10,Total=250,NreTotal=20},new("1 Week",null,null,null,"","","",null,""),"Fixture","fixture",DateTimeOffset.UtcNow)));
            Check(!projection.Contains(parentFile.DocumentId)&&!projection.Contains("SYNTHETIC PRIVATE EVIDENCE")&&!projection.Contains("synthetic-supplier.pdf"),"customer quote projection excludes notes and attachments");
            Check(JsonSerializer.Serialize(v.Plan.Versions.Take(JsonSerializer.Deserialize<SimMaterialSnapshot[]>(legacyVersions)!.Length))==legacyVersions,"existing completed snapshots unchanged");
            Check(JsonSerializer.Serialize(v.Rfq.Lanes.LaborQuote)==labor,"Labor untouched");
            var binary=Path.Combine(root,"intake-documents",record.RequestCorrelationId,parentFile.DocumentId+".bin");
            var original=await File.ReadAllBytesAsync(binary);try{await File.WriteAllTextAsync(binary,"corrupted synthetic fixture");await Block(()=>store.OpenMaterialAttachment(record.IntakeId,parentFile.DocumentId),"hash mismatch blocks retrieval");}finally{await File.WriteAllBytesAsync(binary,original);}
        }finally{await File.WriteAllTextAsync(path,before);}
    }
}
