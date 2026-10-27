// Same-request reason/evidence updates append to the existing request action journal.
// The original batch, approved BOM and previously reviewed evidence are never rewritten.
internal sealed record SimMaterialPartUpdate(int Revision,string Note,string? BasisReference,SimMaterialEvidence Evidence,string UpdateId,string CommandHash);
internal sealed record SimMaterialPartUpdateRequest(string ExpectedToken,string UpdateId,string Note,string? BasisReference=null,string[]? AttachmentIds=null);
internal sealed record SimMaterialPartRevisionView(int Revision,string Note,string? BasisReference,SimMaterialPartEvidenceView? Evidence,SimMaterialPartActor Actor,DateTimeOffset AtUtc);

internal sealed partial class SimRfqIntakeStore
{
    private static int PartRevision(SimMaterialPartActions actions)=>1+actions.History.Count(h=>h.Update is not null);
    private static SimMaterialPartBatch PartCurrentContent(SimMaterialPartBatch batch,SimMaterialPartActions actions)=>actions.History.LastOrDefault(h=>h.Update is not null)?.Update is {} update
        ?batch with{Note=update.Note,BasisReference=update.BasisReference,RequestEvidence=update.Evidence}:batch;
    private static SimMaterialPartRevisionView[] PartRevisions(SimMaterialPartBatch batch,SimMaterialPartActions actions,string scope)=>
        [new(1,batch.Note,batch.BasisReference,PartRequestEvidenceView(batch,scope),batch.SubmittedBy,batch.SubmittedAtUtc),
         ..actions.History.Where(h=>h.Update is not null).Select(h=>new SimMaterialPartRevisionView(h.Update!.Revision,h.Update.Note,h.Update.BasisReference,PartRequestEvidenceView(batch with{RequestEvidence=h.Update.Evidence},scope),h.Actor,h.AtUtc))];

    internal async Task<SimMaterialPartBatchView> UpdateMaterialPartRequest(string rfqId,string batchId,SimMaterialPartUpdateRequest request,SimPersona persona)
    {
        PartPermission(persona,"materials",true);await gate.WaitAsync();try{
            var batch=await ReadPartBatch(batchId);PartRequire(batch.RfqId==rfqId,"PART_REQUEST_SCOPE","Choose a request belonging to this RFQ line.");
            PartRequire(Guid.TryParseExact(request.UpdateId,"D",out _),"PART_REQUEST_ID","Choose a valid update identity.");
            var note=PartText(request.Note,2000,"Reason");PartRequire(note.Length>0,"PART_REQUEST_REASON","Enter the reason for this request.");
            var reference=PartText(request.BasisReference,4000,"Evidence reference");var ids=request.AttachmentIds??[];
            PartRequire(ids.Length<=20&&ids.Distinct().Count()==ids.Length,"PART_REQUEST_EVIDENCE","Use up to 20 distinct request attachments.");
            var commandHash=PartHash(new{request.ExpectedToken,request.UpdateId,Note=note,BasisReference=reference,AttachmentIds=ids});
            var actions=await ReadPartActions(batch);var current=await PartView(batch,"materials",persona);
            var repeated=actions.History.SingleOrDefault(h=>h.Update?.UpdateId==request.UpdateId);
            if(repeated is not null){PartRequire(repeated.Actor.Id==persona.Id&&repeated.Update!.CommandHash==commandHash,"PART_REQUEST_REPLAY","This update identity already contains different content. Reopen the request.");return current;}
            PartRequire(current.CanUpdate,"PART_REQUEST_FIXED","Only the request preparer or an administrator can update this pending or returned request. Routed or approved requests are fixed.");
            PartRequire(request.ExpectedToken==current.Token,"PART_REQUEST_STALE","This request changed. Reopen it before saving an update.");
            var content=PartCurrentContent(batch,actions);var previous=content.RequestEvidence??new SimMaterialEvidence([],[]);
            var files=previous.Attachments.ToList();var record=await RequireRfqRecord(rfqId);
            foreach(var id in ids){var file=await VerifiedMaterialAttachment(record,id);PartRequire(file.Owner=="part-request-update:"+batchId+":"+request.UpdateId&&!file.Removed,"PART_REQUEST_EVIDENCE","Choose evidence uploaded for this request update.");if(files.All(f=>f.Sha256!=file.Sha256))files.Add(file);}
            PartRequire(files.Count<=20,"PART_REQUEST_EVIDENCE","Use up to 20 request attachments.");
            foreach(var old in previous.Attachments)_=await ArchivedPartBytes(old);
            var added=files.Where(f=>previous.Attachments.All(old=>old.DocumentId!=f.DocumentId)).ToArray();
            if(note==content.Note&&(content.BasisReference??"")==reference&&added.Length==0)return current;
            await ArchivePartEvidence(record,added);
            var update=new SimMaterialPartUpdate(PartRevision(actions)+1,note,reference.Length==0?null:reference,new(previous.Notes,files.ToArray()),request.UpdateId,commandHash);
            var next=actions with{History=[..actions.History,new(actions.History.Length+1,"UPDATE_REQUEST",note,new(persona.Id,persona.DisplayName),DateTimeOffset.UtcNow,request.ExpectedToken,Update:update)]};
            next=next with{ContentHash=PartActionHash(next)};await WritePartRecord(PartActionPath(batch.Id),next,true);
            return await PartView(batch,"materials",persona);
        }finally{gate.Release();}
    }
}
