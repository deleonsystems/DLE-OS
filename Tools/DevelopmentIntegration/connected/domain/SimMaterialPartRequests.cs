using System.Text.Json;

// A saved quotation proposal and routing history. This never changes an approved BOM or grants part approval.
internal sealed record SimMaterialPartActor(string Id,string Name);
internal sealed record SimMaterialPartRecipient(string? Id,string Name,string? Address=null);
internal sealed record SimMaterialPartBaseline(string CandidateId,int BomVersion,string GoverningDocumentId,string GoverningSha256,
    SimLibraryRfqBinding? LibraryPackage,string ScenarioId,long Generation,int Quantity,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? RequirementsHash=null);
internal sealed record SimMaterialPartFlag(int Index,string RowId,string Find,string InternalPartNumber,string[] ApprovedPartNumbers,string? QuotedPartNumber,string Intent);
internal sealed record SimMaterialPartItem(int Index,string RowId,string Find,string InternalPartNumber,string[] ApprovedPartNumbers,string? QuotedPartNumber,
    string Intent,SimMaterialEvidence Evidence,string CurrentItemToken,string? CurrentQuotedPartNumber=null);
internal sealed record SimMaterialPartBatch(string Id,int ContractVersion,string RequestHash,string RfqId,string DisplayId,string RequestCorrelationId,
    string Customer,string AssemblyNumber,string Revision,SimMaterialPartBaseline Baseline,int PlanRevision,string Route,SimMaterialPartRecipient Recipient,
    string Note,SimMaterialPartItem[] Items,SimMaterialPartActor SubmittedBy,DateTimeOffset SubmittedAtUtc,string ContentHash,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Purpose=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? BasisReference=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialEvidence? RequestEvidence=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? ParentBatchId=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] bool? RequirementsPermitInternal=null);
internal sealed record SimMaterialPartAction(int Version,string Action,string Note,SimMaterialPartActor Actor,DateTimeOffset AtUtc,string ExpectedToken,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimLibraryRfqBinding? ApprovedResult=null,[property: System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] SimMaterialPartUpdate? Update=null);
internal sealed record SimMaterialPartActions(string BatchId,string BatchHash,SimMaterialPartAction[] History,string ContentHash);
// Legacy RequirementsPermitInternal input is retained for old clients only; ignored for new requests. Historical batch fields remain immutable.
internal sealed record SimMaterialPartCreate(string ExpectedToken,string RequestId,string Route,int[] Indexes,string? Note=null,
    string? RecipientId=null,string? RecipientName=null,string? RecipientAddress=null,int RoutingContractVersion=0,string? BasisReference=null,string[]? AttachmentIds=null,bool RequirementsPermitInternal=false,string? ParentBatchId=null,
    [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)] bool ReviewOnly=false);
internal sealed record SimMaterialPartActionRequest(string ExpectedToken,string Action,string? Note=null);
internal sealed record SimMaterialPartAttachmentView(string DocumentId,string Owner,string Kind,string Category,string Name,string Type,long Size,string Sha256,
    string AddedBy,DateTimeOffset AddedAt,string DownloadUrl);
internal sealed record SimMaterialPartEvidenceView(SimMaterialNote[] Notes,SimMaterialPartAttachmentView[] Attachments);
internal sealed record SimMaterialPartItemView(int Index,string RowId,string Find,string InternalPartNumber,string[] ApprovedPartNumbers,string? QuotedPartNumber,
    string Intent,SimMaterialPartEvidenceView Evidence,string CurrentItemToken,bool Current,string? CurrentQuotedPartNumber=null);
internal sealed record SimMaterialPartBatchView(string Id,string RfqId,string DisplayId,string Customer,string AssemblyNumber,string Revision,
    SimMaterialPartBaseline Baseline,string Route,SimMaterialPartRecipient Recipient,string Note,SimMaterialPartActor SubmittedBy,DateTimeOffset SubmittedAtUtc,
    string Status,bool Current,string Token,SimMaterialPartItemView[] Items,SimMaterialPartAction[] Actions,bool CanSendToLibrary,bool CanReturnToMaterials,string? Purpose=null,string? BasisReference=null,SimMaterialPartEvidenceView? RequestEvidence=null,string? ParentBatchId=null,bool CanCancel=false,bool CanRespond=false,int BomUpdateContractVersion=1,bool? EstimateAllowed=null,bool CanAllowEstimate=false,int RequestRevision=1,bool CanUpdate=false,SimMaterialPartRevisionView[]? Revisions=null);
internal sealed record SimMaterialPartSourceView(int ContractVersion,string RfqId,string DisplayId,string Customer,string AssemblyNumber,string Revision,
    SimMaterialPartBaseline Baseline,string Token,int PlanRevision,SimMaterialPartItemView[] Items,SimMaterialPartBatchView[] Batches,
    SimMaterialPartRecipient[] Recipients,bool CanCreate,int RoutingContractVersion=2,string[]? CustomerRequirements=null,bool CanAllowEstimate=false,int RequestSubmissionContractVersion=3,bool GenericAttestationRemoved=false,int ReviewOnlySubmissionVersion=0);
internal sealed record SimMaterialPartQueue(int ContractVersion,SimMaterialPartBatchView[] Items,bool CanReview);
internal sealed record SimMaterialPartDownload(string Name,string Type,byte[] Bytes);

internal sealed partial class SimRfqIntakeStore
{
    private string MaterialPartRoot=>Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(dataPath)!)!,"material-part-requests-v1");
    private const string MaterialPartTeam="TECHNICAL_REVIEW_TEAM";
    private static string PartHash<T>(T value)=>SimLibraryBomStore.Hash(JsonSerializer.SerializeToUtf8Bytes(value,SimLibraryBomStore.Json));
    private static void PartRequire(bool ok,string code,string message){if(!ok)throw SimRfqIntakeProblem.Conflict(code,message);}
    private static void PartPermission(SimPersona p,string scope,bool write=false)
    {
        if(scope is not("materials" or "technical-review" or "library"))throw SimRfqIntakeProblem.BadRequest("PART_REQUEST_SCOPE","Choose a supported part request workspace.");
        var permission=scope=="library"?(write?"assembly_library.edit":"assembly_library.view"):scope=="materials"?(write?"rfq.part_requests.create":"rfq.view"):(write?"technical_review.disposition":"technical_review.view");
        if(!p.IsActive||!p.Can(permission))throw new LibraryBomPermissionException();
    }
    private static string PartText(string? value,int max,string label)
    {
        value=(value??"").Trim();
        if(value.Length>max||value.Any(c=>char.IsControl(c)&&c is not ('\r' or '\n' or '\t')))throw SimRfqIntakeProblem.BadRequest("PART_REQUEST_TEXT",label+" is too long or contains invalid characters.");
        return value;
    }
    private static bool PartRowEligible(SimCandidateRow source)=>source.ComponentType is not ("DNP" or "REFERENCE_ONLY") && source.Values.GetValueOrDefault("lineNumber")!="NOB";
    internal static string? MaterialPartIntent(SimMaterialRow row)
    {
        if(row.PartReviewMode=="REQUEST_ALTERNATE")return "REQUEST_ALTERNATE";
        if(row.PartReviewMode=="PROPOSED_PART" || !string.IsNullOrWhiteSpace(row.MfgPartNumber)&&row.MfgPartNumberSource!="CONFIRMED_ACCEPTED_BOM")return "PROPOSED_PART";
        return null;
    }
    private static void ValidateMaterialPartFlags(SimMaterialRequest request,SimMaterialView view)
    {
        if(request.Rows.Concat(view.Plan.Rows).Any(r=>r.PartReviewMode is not null||MaterialPartIntent(r) is not null)&&request.PartReviewContractVersion!=1)
            throw SimRfqIntakeProblem.Conflict("MATERIAL_PART_CLIENT","Reload Materials to preserve its part-review flags and quotation-only numbers.");
        foreach(var row in request.Rows)
        {
            if(row.PartReviewMode is not(null or "PROPOSED_PART" or "REQUEST_ALTERNATE"))throw SimRfqIntakeProblem.BadRequest("MATERIAL_PART_MODE","Choose Proposed part or Request alternate.");
            if(row.PartReviewMode is not null)
            {
                var source=view.Rfq.Inputs.Materials.Candidate.Rows.Single(r=>r.Index==row.Index);
                PartRequire(PartRowEligible(source),"MATERIAL_PART_SCOPE","DNP, optional NOB and reference rows cannot request a part change.");
            }
            if(row.PartReviewMode=="PROPOSED_PART")PartRequire(!string.IsNullOrWhiteSpace(row.MfgPartNumber)&&row.MfgPartNumberSource!="CONFIRMED_ACCEPTED_BOM","MATERIAL_PART_PROPOSAL","Enter the quotation-only proposed part number, or choose Request alternate.");
        }
    }
    internal static SimMaterialPartFlag[] MaterialPartFlags(SimMaterialPlan? plan,SimCandidateBom? bom)
    {
        if(plan is null||bom is null)return [];
        return MaterialPartFlagsForRows(plan.Rows,bom);
    }
    private static SimMaterialPartFlag[] MaterialPartFlagsForRows(IEnumerable<SimMaterialRow> rows,SimCandidateBom bom)
    {
        return rows.Select(r=>(Row:r,Source:bom.Rows.SingleOrDefault(s=>s.Index==r.Index),Intent:MaterialPartIntent(r)))
            .Where(x=>x.Source is not null&&PartRowEligible(x.Source)&&x.Intent is not null)
            .Select(x=>new SimMaterialPartFlag(x.Row.Index,x.Source!.RowId??x.Row.Index.ToString(System.Globalization.CultureInfo.InvariantCulture),
                x.Source.Values.GetValueOrDefault("lineNumber",""),CustomerNumber(x.Source),
                MaterialIdentityChoices(x.Source),x.Row.MfgPartNumberSource!="CONFIRMED_ACCEPTED_BOM"?x.Row.MfgPartNumber:null,x.Intent!)).ToArray();
    }
    private string PartBatchPath(string id)
    {
        if(!Guid.TryParseExact(id,"D",out _))throw SimRfqIntakeProblem.BadRequest("PART_REQUEST_ID","Choose a valid part request.");
        return Path.Combine(MaterialPartRoot,id+".json");
    }
    private string PartActionPath(string id)=>PartBatchPath(id)+".actions";
    private static string PartBatchHash(SimMaterialPartBatch b)=>PartHash(b with{ContentHash=""});
    private static string PartActionHash(SimMaterialPartActions a)=>PartHash(a with{ContentHash=""});
    private async Task<SimMaterialPartBatch> ReadPartBatch(string id)
    {
        var path=PartBatchPath(id);if(!File.Exists(path))throw SimRfqIntakeProblem.NotFound("PART_REQUEST_NOT_FOUND","Part request not found.");
        var b=JsonSerializer.Deserialize<SimMaterialPartBatch>(await File.ReadAllTextAsync(path),jsonOptions);
        PartRequire(b is not null&&b.Id==id&&b.ContractVersion is 1 or 2 or 3&&b.ContentHash==PartBatchHash(b),"PART_REQUEST_INTEGRITY","The saved part request could not be verified.");
        return b!;
    }
    private async Task<SimMaterialPartActions> ReadPartActions(SimMaterialPartBatch batch)
    {
        var path=PartActionPath(batch.Id);
        if(!File.Exists(path)){var empty=new SimMaterialPartActions(batch.Id,batch.ContentHash,[],"");return empty with{ContentHash=PartActionHash(empty)};}
        var a=JsonSerializer.Deserialize<SimMaterialPartActions>(await File.ReadAllTextAsync(path),jsonOptions);
        PartRequire(a is not null&&a.BatchId==batch.Id&&a.BatchHash==batch.ContentHash&&a.ContentHash==PartActionHash(a)&&a.History.Select((h,i)=>h.Version==i+1).All(v=>v),"PART_REQUEST_INTEGRITY","The part request routing history could not be verified.");
        PartRequire(a!.History.Where(h=>h.Update is not null).Select((h,i)=>h.Action=="UPDATE_REQUEST"&&h.Update!.Revision==i+2).All(v=>v),"PART_REQUEST_INTEGRITY","The request update history could not be verified.");
        return a!;
    }
    private async Task WritePartRecord<T>(string path,T record,bool replace)
    {
        Directory.CreateDirectory(MaterialPartRoot);var temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
        try{var text=JsonSerializer.Serialize(record,jsonOptions);await File.WriteAllTextAsync(temporary,text);if(await File.ReadAllTextAsync(temporary)!=text)throw new IOException("Part request write verification failed.");File.Move(temporary,path,replace);}
        finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
    private async Task<SimMaterialPartBatch[]> PartBatches()
    {
        if(!Directory.Exists(MaterialPartRoot))return [];
        var result=new List<SimMaterialPartBatch>();
        foreach(var file in Directory.EnumerateFiles(MaterialPartRoot,"*.json"))result.Add(await ReadPartBatch(Path.GetFileNameWithoutExtension(file)));
        return result.OrderByDescending(b=>b.SubmittedAtUtc).ToArray();
    }
    private static SimMaterialPartBaseline PartBaseline(SimRfqIntakeRecord record,SimMaterialView view)=>new(view.Plan.CandidateId,view.Plan.BomVersion,
        view.Rfq.Inputs.Materials.Candidate.GoverningDocumentId,view.Rfq.Inputs.Materials.Candidate.GoverningSha256,record.LibraryRfq,record.ScenarioId,record.Generation,view.Rfq.Assemblies[0].Quantity,PartRequirementsHash(record));
    private static SimMaterialPartItem[] PartItems(SimMaterialView view,SimMaterialPartBaseline baseline)
    {
        return MaterialPartFlags(view.Plan,view.Rfq.Inputs.Materials.Candidate).Select(flag=>{
            var row=view.Plan.Rows.Single(r=>r.Index==flag.Index);
            var evidence=new SimMaterialEvidence(row.Evidence?.Notes??[],row.Evidence?.Attachments.Where(a=>!a.Removed).ToArray()??[]);
            var item=new SimMaterialPartItem(flag.Index,flag.RowId,flag.Find,flag.InternalPartNumber,flag.ApprovedPartNumbers,
                flag.Intent=="PROPOSED_PART"?flag.QuotedPartNumber:null,flag.Intent,evidence,"",row.MfgPartNumber);
            return item with{CurrentItemToken=PartHash(new{baseline,item,row.MfgPartNumber,row.MfgPartNumberSource,row.PartReviewMode})};
        }).ToArray();
    }
    internal Func<SimPersona[]>? MaterialPartRecipients {get;set;}
    internal Func<Task<SimPersona[]>>? VerifiedMaterialPartRecipients {get;set;}
    private async Task<SimMaterialPartRecipient[]> PartRecipients()=>new[]{new SimMaterialPartRecipient(MaterialPartTeam,"Technical Review team")}
        .Concat((VerifiedMaterialPartRecipients is not null ? await VerifiedMaterialPartRecipients() : MaterialPartRecipients?.Invoke()??SimPersonaCatalog.All).Where(p=>p.IsActive&&p.Can("technical_review.disposition")).Select(p=>new SimMaterialPartRecipient(p.Id,p.DisplayName))).ToArray();
    private static string PartStatus(SimMaterialPartBatch b,SimMaterialPartActions a)=>a.History.LastOrDefault(h=>h.Action!="ALLOW_ESTIMATE")?.Action switch {
        "RETURN_TO_MATERIALS"=>"RETURNED_TO_MATERIALS","SEND_TO_LIBRARY"=>"IN_LIBRARY",_=>b.Route=="CUSTOMER"?"PREPARED":"AWAITING_REVIEW"};
    private static string PartViewToken(SimMaterialPartBatch b,SimMaterialPartActions a)=>PartHash(new{b.ContentHash,Actions=a.ContentHash});
    private static string PartEvidenceUrl(string scope,string rfq,string batch,string document)=>scope switch {
        "library"=>$"/api/sim/assembly-library/part-requests/{Uri.EscapeDataString(batch)}/evidence/{Uri.EscapeDataString(document)}",
        "technical-review"=>$"/api/sim/technical-review/part-requests/{Uri.EscapeDataString(batch)}/evidence/{Uri.EscapeDataString(document)}",
        _=>batch.Length==0?$"/api/sim/rfqs/{Uri.EscapeDataString(rfq)}/materials/attachments/{Uri.EscapeDataString(document)}":$"/api/sim/rfqs/{Uri.EscapeDataString(rfq)}/materials/part-requests/{Uri.EscapeDataString(batch)}/evidence/{Uri.EscapeDataString(document)}"};
    private static SimMaterialPartItemView PartItemView(SimMaterialPartItem i,bool current,string scope,string rfq,string batch)=>new(i.Index,i.RowId,i.Find,i.InternalPartNumber,
        i.ApprovedPartNumbers,i.QuotedPartNumber,i.Intent,new(i.Evidence.Notes,i.Evidence.Attachments.Select(a=>new SimMaterialPartAttachmentView(a.DocumentId,a.Owner,a.Kind,a.Category,a.Name,a.Type,a.Size,a.Sha256,a.AddedBy,a.AddedAt,PartEvidenceUrl(scope,rfq,batch,a.DocumentId))).ToArray()),i.CurrentItemToken,current,i.CurrentQuotedPartNumber);
    private static bool PartVisible(SimMaterialPartBatch b,SimMaterialPartActions a,string scope)=>scope switch {
        "technical-review"=>b.Route=="TECHNICAL_REVIEW","library"=>b.Route=="TECHNICAL_REVIEW"&&a.History.Any(h=>h.Action=="SEND_TO_LIBRARY"),_=>true};
    private async Task<SimMaterialPartBatchView> PartView(SimMaterialPartBatch batch,string scope,SimPersona persona)
    {
        var actions=await ReadPartActions(batch);
        PartRequire(PartVisible(batch,actions,scope),"PART_REQUEST_SCOPE","This part request has not been routed to this workspace.");
        SimMaterialPartItem[] current=[];bool baselineCurrent=false;
        try{
            var record=await RequireRfqRecord(batch.RfqId);var view=MaterialView(RfqView(record,await ReadRfqLanes()));var baseline=PartBaseline(record,view);
            baselineCurrent=PartHash(batch.ContractVersion==1&&batch.Baseline.RequirementsHash is null?baseline with{RequirementsHash=null}:baseline)==PartHash(batch.Baseline)&&record.RequestCorrelationId==batch.RequestCorrelationId;
            if(baselineCurrent)current=PartItems(view,baseline);
        }catch(Exception e)when(e is SimRfqIntakeProblem or IOException or UnauthorizedAccessException){/* Retain the frozen request even when its source is unavailable. */}
        var items=batch.Items.Select(i=>PartItemView(i,baselineCurrent&&current.Any(c=>c.Index==i.Index&&c.CurrentItemToken==i.CurrentItemToken),scope,batch.RfqId,batch.Id)).ToArray();
        var allCurrent=items.Length>0&&items.All(i=>i.Current);var status=PartStatus(batch,actions);
        if(batch.ContractVersion>=2){if(actions.History.Any(h=>h.Action=="CANCEL"))status="CANCELLED";else if(!allCurrent)status="SUPERSEDED";else if(batch.Route=="CUSTOMER"&&await PartHasResponse(batch.Id))status="RESPONSE_ROUTED";}
        var updateStatus=await PartBomUpdateStatus(batch,actions,allCurrent);if(updateStatus is not null)status=updateStatus;
        var canAct=scope=="technical-review"&&allCurrent&&status=="AWAITING_REVIEW"&&persona.Can("technical_review.disposition");
        var content=PartCurrentContent(batch,actions);var canUpdate=batch.ContractVersion>=2&&batch.Route=="TECHNICAL_REVIEW"&&allCurrent&&status is "AWAITING_REVIEW" or "RETURNED_TO_MATERIALS"&&!actions.History.Any(h=>h.Action is "SEND_TO_LIBRARY" or "LINK_APPROVED_RESULT")&&PartCanSubmit(persona)&&(persona.IsSuperAdmin||batch.SubmittedBy.Id==persona.Id)&&await PartCanEdit(batch.RfqId);
        return new(batch.Id,batch.RfqId,batch.DisplayId,batch.Customer,batch.AssemblyNumber,batch.Revision,batch.Baseline,batch.Route,batch.Recipient,content.Note,
            batch.SubmittedBy,batch.SubmittedAtUtc,status,allCurrent,PartViewToken(batch,actions),items,actions.History,canAct,canAct,batch.Purpose,content.BasisReference,PartRequestEvidenceView(content,scope),batch.ParentBatchId,batch.ContractVersion>=2&&PartCanSubmit(persona)&&PartRequestOwner(batch,persona)&&scope=="materials"&&status is not ("CANCELLED" or "RESPONSE_ROUTED")&&!actions.History.Any(h=>h.Action=="SEND_TO_LIBRARY")&&await PartCanEdit(batch.RfqId),batch.Purpose=="ASK_CUSTOMER"&&status is "PREPARED" or "SUPERSEDED"&&baselineCurrent&&items.All(i=>current.Any(c=>c.Index==i.Index&&c.RowId==i.RowId))&&!await PartHasResponse(batch.Id)&&scope=="materials"&&PartCanSubmit(persona)&&PartRequestOwner(batch,persona)&&await PartCanEdit(batch.RfqId),1,allCurrent&&status is not("CANCELLED" or "SUPERSEDED" or "RETURNED_TO_MATERIALS")&&PartEstimateAllowed(batch,actions),allCurrent&&(batch.ContractVersion==3||actions.History.Any(h=>h.Update is not null))&&batch.Purpose=="INTERNAL_BOM_UPDATE"&&status is "AWAITING_REVIEW" or "IN_LIBRARY"&&!PartEstimateAllowed(batch,actions)&&persona.Can("technical_review.disposition"),PartRevision(actions),canUpdate,PartRevisions(batch,actions,scope));
    }
    private async Task<SimMaterialPartSourceView> PartSource(string id,SimPersona persona)
    {
        var record=await RequireRfqRecord(id);RequireRequestedRfqDepartment(record,"materials");
        var view=MaterialView(RfqView(record,await ReadRfqLanes()));var baseline=PartBaseline(record,view);var items=PartItems(view,baseline);
        var batches=new List<SimMaterialPartBatchView>();foreach(var b in (await PartBatches()).Where(b=>b.RfqId==id&&b.Baseline.ScenarioId==record.ScenarioId&&b.Baseline.Generation==record.Generation))batches.Add(await PartView(b,"materials",persona));
        var token=PartHash(new{baseline,view.Plan.Revision,items=items.Select(i=>i.CurrentItemToken).ToArray(),batches=batches.Select(b=>b.Token).ToArray()});
        var assembly=view.Rfq.Assemblies[0];
        return new(1,id,id,record.Customer.CustomerName,assembly.AssemblyNumber,assembly.Revision,baseline,token,view.Plan.Revision,
            items.Select(i=>PartItemView(i,true,"materials",id,"")).ToArray(),batches.ToArray(),await PartRecipients(),PartCanSubmit(persona)&&await PartCanEdit(id),2,PartRequirements(record),persona.Can("technical_review.disposition"),3,true,1);
    }
    internal async Task<SimMaterialPartSourceView> ReadMaterialPartRequests(string id,SimPersona persona)
    {PartPermission(persona,"materials");await gate.WaitAsync();try{return await PartSource(id,persona);}finally{gate.Release();}}
    internal async Task<SimMaterialPartBatchView> CreateMaterialPartRequest(string id,SimMaterialPartCreate request,SimPersona persona)
    {
        PartPermission(persona,"materials",true);if(!persona.Can("technical_review.disposition")&&request.RoutingContractVersion!=2)throw SimRfqIntakeProblem.Conflict("PART_REQUEST_CLIENT","Reload the request preparation screen before submitting.");if(request.RoutingContractVersion==2)return await CreateRoutedPartRequest(id,request,persona);await gate.WaitAsync();try{
            _=PartBatchPath(request.RequestId);
            PartRequire(await PartCanEdit(id),"PART_REQUEST_COMMITTED","This quotation is no longer editable here.");
            PartRequire(request.Route is "TECHNICAL_REVIEW" or "CUSTOMER","PART_REQUEST_ROUTE","Choose Technical Review or a prepared customer copy.");
            var commandHash=PartHash(request);
            if(File.Exists(PartBatchPath(request.RequestId))){var existing=await ReadPartBatch(request.RequestId);PartRequire(existing.RfqId==id&&existing.RequestHash==commandHash&&existing.SubmittedBy.Id==persona.Id,"PART_REQUEST_REPLAY","This request ID was already used for different content. Reopen the request list.");return await PartView(existing,"materials",persona);}
            var source=await PartSource(id,persona);PartRequire(request.ExpectedToken==source.Token,"PART_REQUEST_STALE","Saved Materials or its requests changed. Reopen the part request list.");
            PartRequire(request.Indexes is {Length:>0 and <=1000}&&request.Indexes.Distinct().Count()==request.Indexes.Length&&request.Indexes.All(i=>source.Items.Any(r=>r.Index==i)),"PART_REQUEST_ROWS","Choose unique currently flagged Materials rows. DNP and NOB rows cannot be included.");
            SimMaterialPartRecipient recipient;
            if(request.Route=="TECHNICAL_REVIEW"){
                var recipientId=request.RecipientId??MaterialPartTeam;recipient=(await PartRecipients()).SingleOrDefault(p=>p.Id==recipientId)??throw SimRfqIntakeProblem.BadRequest("PART_REQUEST_RECIPIENT","Choose the Technical Review team or an active reviewer.");
                PartRequire(string.IsNullOrWhiteSpace(request.RecipientName)&&string.IsNullOrWhiteSpace(request.RecipientAddress),"PART_REQUEST_RECIPIENT","Technical Review recipients come from the existing user list.");
            }else{
                var name=PartText(request.RecipientName,200,"Recipient name");var address=PartText(request.RecipientAddress,500,"Recipient address");
                PartRequire(name.Length>0&&address.Length>0&&string.IsNullOrWhiteSpace(request.RecipientId),"PART_REQUEST_RECIPIENT","Enter the customer recipient name and address for the prepared copy.");recipient=new(null,name,address);
            }
            var record=await RequireRfqRecord(id);var material=MaterialView(RfqView(record,await ReadRfqLanes()));
            var selected=PartItems(material,source.Baseline).Where(i=>request.Indexes.Contains(i.Index)).OrderBy(i=>i.Index).ToArray();
            foreach(var item in selected)foreach(var attachment in item.Evidence.Attachments){var trusted=await VerifiedMaterialAttachment(record,attachment.DocumentId);PartRequire(trusted==attachment,"PART_REQUEST_EVIDENCE","Saved evidence changed. Reopen Materials before preparing this request.");}
            var batch=new SimMaterialPartBatch(request.RequestId,1,commandHash,id,source.DisplayId,record.RequestCorrelationId,source.Customer,source.AssemblyNumber,source.Revision,
                source.Baseline,source.PlanRevision,request.Route,recipient,PartText(request.Note,4000,"Request note"),selected,new(persona.Id,persona.DisplayName),DateTimeOffset.UtcNow,"");
            batch=batch with{ContentHash=PartBatchHash(batch)};await WritePartRecord(PartBatchPath(batch.Id),batch,false);return await PartView(batch,"materials",persona);
        }finally{gate.Release();}
    }
    internal async Task<SimMaterialPartQueue> ReadMaterialPartQueue(string scope,SimPersona persona)
    {
        if(scope is not("technical-review" or "library"))throw SimRfqIntakeProblem.BadRequest("PART_REQUEST_SCOPE","Choose the review or Library queue.");
        PartPermission(persona,scope);await gate.WaitAsync();try{
            var result=new List<SimMaterialPartBatchView>();foreach(var b in await PartBatches()){var actions=await ReadPartActions(b);if(PartVisible(b,actions,scope))result.Add(await PartView(b,scope,persona));}
            return new(1,result.ToArray(),scope=="technical-review"&&persona.Can("technical_review.disposition"));
        }finally{gate.Release();}
    }
    internal async Task<SimMaterialPartBatchView> ReadMaterialPartBatch(string id,string scope,SimPersona persona,string? rfqId=null)
    {
        PartPermission(persona,scope);await gate.WaitAsync();try{var batch=await ReadPartBatch(id);PartRequire(scope!="materials"||rfqId==batch.RfqId,"PART_REQUEST_SCOPE","This part request belongs to a different RFQ line.");return await PartView(batch,scope,persona);}finally{gate.Release();}
    }
    internal async Task<SimMaterialPartBatchView> ActMaterialPartRequest(string id,SimMaterialPartActionRequest request,SimPersona persona)
    {
        PartPermission(persona,"technical-review",true);await gate.WaitAsync();try{
            var batch=await ReadPartBatch(id);var history=await ReadPartActions(batch);var view=await PartView(batch,"technical-review",persona);var note=PartText(request.Note,4000,"Review note");
            PartRequire(request.Action is "RETURN_TO_MATERIALS" or "SEND_TO_LIBRARY" or "ALLOW_ESTIMATE","PART_REQUEST_ACTION","Choose Return to Materials or Send to Library.");
            if(history.History.LastOrDefault() is {} last&&last.ExpectedToken==request.ExpectedToken&&last.Action==request.Action&&last.Note==note&&last.Actor.Id==persona.Id)return view;
            PartRequire(request.ExpectedToken==view.Token,"PART_REQUEST_STALE","This request changed. Reopen it before routing.");
            PartRequire(view.Current&&(request.Action=="ALLOW_ESTIMATE"?view.CanAllowEstimate:view.Status=="AWAITING_REVIEW"),"PART_REQUEST_NOT_CURRENT","The request has changed or was already routed. Review the saved Materials request before continuing.");
            PartRequire(request.Action!="RETURN_TO_MATERIALS"||note.Length>0,"PART_REQUEST_NOTE","Add a note explaining what Materials needs to change.");
            if(request.Action=="ALLOW_ESTIMATE")PartRequire(note.Length>0&&batch.Items.All(i=>i.Intent=="PROPOSED_PART"&&!string.IsNullOrWhiteSpace(i.QuotedPartNumber)),"PART_ESTIMATE_BASIS","Record the supported estimating basis and a concrete proposed P/N.");
            var record=await RequireRfqRecord(batch.RfqId);
            foreach(var attachment in PartAttachments(PartCurrentContent(batch,history))){
                if(batch.ContractVersion>=2){_=await ArchivedPartBytes(attachment);continue;}
                var trusted=await VerifiedMaterialAttachment(record,attachment.DocumentId);
                PartRequire(trusted==attachment,"PART_REQUEST_EVIDENCE","The request evidence changed. Reopen Materials before routing this request.");
            }
            var next=history with{History=[..history.History,new(history.History.Length+1,request.Action,note,new(persona.Id,persona.DisplayName),DateTimeOffset.UtcNow,request.ExpectedToken)]};next=next with{ContentHash=PartActionHash(next)};
            await WritePartRecord(PartActionPath(id),next,true);return await PartView(batch,"technical-review",persona);
        }finally{gate.Release();}
    }
    internal async Task<SimMaterialPartDownload> OpenMaterialPartEvidence(string id,string documentId,string scope,SimPersona persona,string? rfqId=null)
    {
        PartPermission(persona,scope);await gate.WaitAsync();try{
            var batch=await ReadPartBatch(id);var actions=await ReadPartActions(batch);PartRequire(PartVisible(batch,actions,scope)&&(scope!="materials"||rfqId==batch.RfqId),"PART_REQUEST_SCOPE","This evidence does not belong to this workspace request.");
            var evidence=PartAttachments(batch).Concat(actions.History.Where(h=>h.Update is not null).SelectMany(h=>h.Update!.Evidence.Attachments)).GroupBy(a=>a.DocumentId).Select(g=>g.First()).SingleOrDefault(a=>a.DocumentId==documentId)??throw SimRfqIntakeProblem.NotFound("PART_REQUEST_EVIDENCE","This file is not included in the part request.");
            if(batch.ContractVersion>=2)return new(evidence.Name,evidence.Type,await ArchivedPartBytes(evidence));
            var metadata=await documents.ReadMaterialAttachment(batch.RequestCorrelationId,documentId);var bytes=await documents.Bytes(batch.RequestCorrelationId,documentId);
            PartRequire(metadata==evidence&&metadata.IntakeId==batch.RfqId&&bytes.Length==evidence.Size&&SimLibraryBomStore.Hash(bytes)==evidence.Sha256,"PART_REQUEST_EVIDENCE","The frozen request evidence could not be verified.");
            return new(evidence.Name,evidence.Type,bytes);
        }finally{gate.Release();}
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    internal static void MapMaterialPartRequests(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        async Task<IResult> Run(HttpContext context,string scope,bool write,Func<SimPersona,Task<object>> action)
        {
            var permission=scope=="library"?(write?"assembly_library.edit":"assembly_library.view"):scope=="materials"?(write?"rfq.part_requests.create":"rfq.view"):(write?"technical_review.disposition":"technical_review.view");
            var denied=DeniedTechnicalReview(context,state,personas,permission);if(denied is not null)return denied;
            try{var value=await action(personas.Resolve(context));if(value is SimMaterialPartDownload download){context.Response.Headers.CacheControl="private, no-store";context.Response.Headers["X-Content-Type-Options"]="nosniff";context.Response.Headers["Content-Security-Policy"]="default-src 'none'; sandbox";return Results.File(download.Bytes,download.Type,fileDownloadName:download.Name);}return Results.Json(value);}
            catch(LibraryBomPermissionException){return Results.Json(new{code="PART_REQUEST_DENIED",message="This part request is not available with your current permissions."},statusCode:403);}
            catch(SimRfqIntakeProblem p){return Results.Json(new{code=p.Code,message=p.Message},statusCode:p.StatusCode);}
            catch(Exception e)when(e is IOException or UnauthorizedAccessException or JsonException){return Results.Json(new{code="PART_REQUEST_STORAGE",message="Part request storage is unavailable. Your existing work was retained."},statusCode:503);}
        }
        MapMaterialPartRouting(app,state,store,personas);
        const string rfq="/api/sim/rfqs/{id}/materials/part-requests";
        app.MapGet(rfq,(string id,HttpContext c)=>Run(c,"materials",false,async p=>await store.ReadMaterialPartRequests(id,p)));
        app.MapPost(rfq,(string id,SimMaterialPartCreate r,HttpContext c)=>Run(c,"materials",true,async p=>await store.CreateMaterialPartRequest(id,r,p)));
        app.MapGet(rfq+"/{batchId}",(string id,string batchId,HttpContext c)=>Run(c,"materials",false,async p=>await store.ReadMaterialPartBatch(batchId,"materials",p,id)));
        app.MapGet(rfq+"/{batchId}/evidence/{documentId}",(string id,string batchId,string documentId,HttpContext c)=>Run(c,"materials",false,async p=>await store.OpenMaterialPartEvidence(batchId,documentId,"materials",p,id)));
        foreach(var scope in new[]{"technical-review","library"}){
            var route=scope=="library"?"/api/sim/assembly-library/part-requests":"/api/sim/technical-review/part-requests";
            app.MapGet(route,async Task<IResult>(HttpContext c)=>await Run(c,scope,false,async p=>await store.ReadMaterialPartQueue(scope,p)));
            app.MapGet(route+"/{batchId}",(string batchId,HttpContext c)=>Run(c,scope,false,async p=>await store.ReadMaterialPartBatch(batchId,scope,p)));
            app.MapGet(route+"/{batchId}/evidence/{documentId}",(string batchId,string documentId,HttpContext c)=>Run(c,scope,false,async p=>await store.OpenMaterialPartEvidence(batchId,documentId,scope,p)));
        }
        app.MapPost("/api/sim/technical-review/part-requests/{batchId}/actions",(string batchId,SimMaterialPartActionRequest r,HttpContext c)=>Run(c,"technical-review",true,async p=>await store.ActMaterialPartRequest(batchId,r,p)));
    }
}
