using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

internal sealed partial class SimProductionService
{
    // v1 is a read-only adapter of the existing frozen binding, never a migrated payload.
    private static SimWoTravelerRevision AsQuoted(SimWoTraveler b,SimProductionSource source,SimTravelerApprovalStamp? approval)=>new(b.Id,b.Id,b.WorkOrderNumber,b.Generation,b.Version,
        null,b.DefinitionId,b.DefinitionVersion,b.SourceToken,"APPROVED","AS_QUOTED","",b.Operations,
        source.Operations.ToDictionary(o=>o.Id,o=>o.Sequence),
        b.FrozenPackage.GetProperty("source").GetProperty("sourceOperations").EnumerateArray().ToDictionary(x=>Text(x,"id"),x=>Field(x,"parentId").ValueKind==JsonValueKind.String?Text(x,"parentId"):null),
        b.FrozenPackage,b.CreatedBy,b.CreatedAt,b.CreatedBy,b.CreatedAt,approval,null,[],[]);
    private static (SimWoTravelerRevision? Effective,SimWoTravelerRevision[] All) RevisionView(SimWoTraveler? bound,SimWoRevisionState state,SimProductionSource source){
        if(bound is null){Require(state.Head is null,"wo_revision_integrity","A WO revision has no original frozen Traveler.");return(null,[]);}
        Require(state.SourceApproval is not null,"wo_revision_integrity","The original source approval is unavailable.");
        var all=new[]{AsQuoted(bound,source,state.SourceApproval)}.Concat(state.Approved).OrderBy(r=>r.Version).ToArray();
        var effective=all.SingleOrDefault(r=>r.Id==(state.Head?.EffectiveRevisionId??bound.Id));
        Require(effective is not null&&effective.TravelerId==bound.Id&&effective.SourceToken==bound.SourceToken&&
            (state.Head is null||state.Head.TravelerId==bound.Id&&state.Head.EffectiveVersion==effective.Version),"wo_revision_integrity","The effective WO revision does not match its frozen binding.");
        foreach(var revision in all)ValidateSnapshot(revision,all[0]);
        return(effective,all);
    }
    private static JsonNode? ProjectRevision(SimWoTravelerRevision? r){
        if(r is null)return null;var node=JsonSerializer.SerializeToNode(r,Json)!.AsObject();node["operations"]=ProjectOperations(r.Operations,r);return node;
    }
    private static JsonNode ProjectOperations(SimTravelerOperation[] operations,SimWoTravelerRevision? revision){
        var rows=new JsonArray();foreach(var op in operations.OrderBy(o=>o.Sequence)){
            var row=JsonSerializer.SerializeToNode(op,Json)!.AsObject();row["sourceSequence"]=revision?.SourceSequences.GetValueOrDefault(op.Id)??op.Sequence;
            var content=revision?.OperationContent?.SingleOrDefault(n=>n.OperationId==op.Id);
            row["travelerInstructions"]=content?.Instructions??SourceInstruction(op);
            row["travelerWorkCenter"]=content?.WorkCenter??op.WorkCenter;
            row["travelerDepartment"]=content?.Department??op.Department;
            row["sourceInstruction"]=SourceInstruction(op);
            row["instructionModified"]=content is not null&&content.Instructions!=SourceInstruction(op);
            row["sourceParentId"]=revision?.SourceParents.GetValueOrDefault(op.SourceOperationId);
            row["substeps"]=JsonSerializer.SerializeToNode((revision?.Substeps??[]).Where(n=>n.OperationId==op.Id&&!n.Removed).OrderBy(n=>n.Order),Json);
            row["travelerVisuals"]=JsonSerializer.SerializeToNode((revision?.Visuals??[]).Where(n=>n.OperationId==op.Id&&!n.Removed).Select(n=>new{n.Id,n.Caption,n.Name,n.Source,n.TeamSource,n.SupersedesId,n.CreatedBy,n.CreatedAt,url=$"/api/production/v1/work-orders/{revision!.WorkOrderNumber}/production-visuals/{n.AssetId}"}),Json);
            row["clarifications"]=JsonSerializer.SerializeToNode((revision?.Clarifications??[]).Where(n=>n.OperationId==op.Id&&!n.Removed),Json);rows.Add(row);
        }return rows;
    }
    internal Task<JsonElement> ReadRevision(string wo,Guid id,SimPersona actor)=>WithSource(wo,actor,false,async(source,runtime)=>{
        var retained=await store.Read(SimKittingCases.Normalize(wo),runtime.Generation);var versions=RevisionView(retained.Bound,retained.Revisions,source);
        var selected=versions.All.SingleOrDefault(r=>r.Id==id);
        Require(selected is not null,"wo_revision_missing","This immutable revision does not belong to this Work Order.");
        return JsonSerializer.SerializeToElement(ProjectRevision(selected),Json);
    });
    private Task<JsonElement> RevisionChange(string wo,SimPersona actor,long expected,
        Func<SqliteConnection,SqliteTransaction,SimWoRevisionHead,SimWoRevisionState,SimWoTravelerRevision,SimWoTravelerRevision,DateTimeOffset,Task> action)=>
        WithSource(wo,actor,true,async(source,runtime)=>{
            await store.Change(SimKittingCases.Normalize(wo),runtime.Generation,async(c,t,d,b)=>{
                await ValidateCase(c,t,source,runtime);
                Require(b is not null,"wo_revision_binding_required","A frozen WO Traveler is required before editing a WO revision.");
                Require(b!.SourceToken==source.Token,"traveler_source_changed","The frozen source changed; resolve lineage before editing.");
                var s=await SimProductionStore.ReadRevisions(c,t,b.WorkOrderNumber,b.Generation);var versions=RevisionView(b,s,source);
                var effective=versions.Effective!;
                Require(effective.Operations.All(o=>o.ExecutionState=="NOT_STARTED")&&(s.Draft?.Operations.All(o=>o.ExecutionState=="NOT_STARTED")??true),
                    "traveler_execution_exists","Execution evidence prevents pre-start Traveler revision.");
                var errors=Validation(effective.Operations,source,effective.SourceToken);Require(errors.Count==0,"traveler_validation",string.Join(" ",errors));
                var head=s.Head??new(b.WorkOrderNumber,b.Generation,b.Id,0,b.Id,b.Version);
                Require(head.WorkingVersion==expected,"wo_revision_version_changed","Another reviewer changed this WO Traveler. Refresh before continuing.");
                await SimProductionStore.RevisionSchema(c,t);
                await action(c,t,head,s,effective,versions.All[0],UtcNow());
            });return await View(source,runtime,actor);
        });
    internal Task<JsonElement> BeginWoRevision(string wo,SimWoRevisionBeginRequest request,SimPersona actor)=>RevisionChange(wo,actor,request.ExpectedWorkingVersion,async(c,t,h,s,effective,quoted,now)=>{
        Require(request.EffectiveRevisionId==effective.Id,"wo_revision_effective_changed","Refresh the effective Traveler before editing.");
        Require(s.Draft?.Lease is null||s.Draft.Lease.ExpiresAt<=now||s.Draft.Lease.ActorId==actor.Id,"wo_revision_in_use","Another reviewer holds this WO Traveler editing lease.");
        var draft=s.Draft??effective with{Id=Guid.NewGuid(),Version=effective.Version+1,PreviousRevisionId=effective.Id,Status="DRAFT",ChangeBasis="WO_SPECIFIC",
            Reason="",CreatedBy=actor.DisplayName,CreatedAt=now,RevisedBy=actor.DisplayName,RevisedAt=now,Approval=null,Differences=[],Warnings=[]};
        draft=draft with{OperationContent=(draft.OperationContent??[]).Select(n=>n with{RevisionId=draft.Id}).ToArray(),Clarifications=(draft.Clarifications??[]).Select(n=>n with{RevisionId=draft.Id}).ToArray(),Substeps=(draft.Substeps??[]).Select(n=>n with{RevisionId=draft.Id}).ToArray(),Visuals=(draft.Visuals??[]).Select(n=>n with{RevisionId=draft.Id}).ToArray()};
        Require(draft.PreviousRevisionId==effective.Id,"wo_revision_effective_changed","The draft baseline is no longer effective.");ValidateSnapshot(draft,quoted);
        draft=draft with{OperationContent=(draft.OperationContent??[]).Select(n=>n with{RevisionId=draft.Id}).ToArray(),Clarifications=(draft.Clarifications??[]).Select(n=>n with{RevisionId=draft.Id}).ToArray(),Lease=new(Guid.NewGuid(),actor.Id,actor.DisplayName,now.AddMinutes(15))};
        var next=h with{WorkingVersion=h.WorkingVersion+1};await SimProductionStore.SaveWoDraft(c,t,draft);await SimProductionStore.SaveHead(c,t,next);
        await WoEvent(c,t,next,draft,s.Draft is null?"WO_DRAFT_CREATED":"WO_EDIT_LEASE_ACQUIRED",actor,now,new{basedOn=effective.Id,effective.Version,sourceDefinitionUnchanged=quoted.DefinitionId});
    });
    private static SimWoTravelerRevision EditableWo(SimWoRevisionState s,Guid id,Guid lease,SimPersona actor,DateTimeOffset now){
        var d=s.Draft;Require(d is not null&&d.Id==id,"wo_revision_missing","Refresh the current WO draft.");
        Require(d!.Lease is not null&&d.Lease.Id==lease&&d.Lease.ActorId==actor.Id&&d.Lease.ExpiresAt>now,"wo_revision_lease_required","Acquire or renew the WO Traveler editing lease before continuing.");return d;
    }
    internal Task<JsonElement> SaveWoRevision(string wo,SimWoRevisionSaveRequest request,SimPersona actor)=>RevisionChange(wo,actor,request.ExpectedWorkingVersion,async(c,t,h,s,effective,quoted,now)=>{
        var draft=EditableWo(s,request.RevisionId,request.LeaseId,actor,now);
        Require(!string.IsNullOrWhiteSpace(request.Reason)&&request.Reason.Length<=2000,"wo_revision_reason_required","A change reason is required when saving a WO revision.");
        var route=Reorder(draft,request.OrderedOperationIds??[]);
        var inputs=await SimProductionStore.TeamInputs(c,t,wo,h.Generation);
        var clarifications=ReviewClarifications(draft,request.Clarifications,actor,now,inputs);
        var substeps=ReviewSubsteps(draft,request.Substeps,actor,now);
        var visuals=await ReviewVisuals(draft,request.Visuals,actor,now,inputs);
        var operationContent=ReviewOperationContent(draft,request.OperationContent,actor,now);
        var next=draft with{OperationContent=operationContent,Substeps=substeps,Visuals=visuals,Clarifications=clarifications,Operations=route,Reason=request.Reason.Trim(),RevisedBy=actor.DisplayName,RevisedAt=now,
            Lease=draft.Lease! with{ExpiresAt=now.AddMinutes(15)},Differences=[Diff(effective,route,draft.SourceSequences,clarifications,substeps,visuals,operationContent),Diff(quoted,route,draft.SourceSequences,clarifications,substeps,visuals,operationContent)],Warnings=Warnings(route,effective.Operations)};
        ValidateSnapshot(next,quoted);var head=h with{WorkingVersion=h.WorkingVersion+1};await SimProductionStore.SaveWoDraft(c,t,next);await SimProductionStore.SaveHead(c,t,head);
        foreach(var change in Diff(draft,route,draft.SourceSequences,clarifications).Clarifications??[])
            await WoEvent(c,t,head,next,"WO_CLARIFICATION_"+change.Action,actor,now,change);
        foreach(var change in ContentDiff(draft,route,substeps,visuals,operationContent))await WoEvent(c,t,head,next,"WO_"+change.Kind+"_"+change.Action,actor,now,change);
        foreach(var note in clarifications.Where(n=>n.TeamSource is not null&&!(draft.Clarifications??[]).Any(old=>old.Id==n.Id)))await WoEvent(c,t,head,next,"TEAM_NOTE_PROMOTED",actor,now,new{note.Id,note.OperationId,note.TeamSource});
        foreach(var visual in visuals.Where(n=>n.TeamSource is not null&&!(draft.Visuals??[]).Any(old=>old.Id==n.Id)))await WoEvent(c,t,head,next,"TEAM_VISUAL_PROMOTED",actor,now,new{visual.Id,visual.OperationId,visual.TeamSource});
        await WoEvent(c,t,head,next,"WO_DRAFT_SAVED",actor,now,new{next.Reason,next.Differences,next.Warnings,contentHash=Hash(next),effectiveRevisionUnchanged=effective.Id});
    });
    internal Task<JsonElement> ApproveWoRevision(string wo,SimWoRevisionApproveRequest request,SimPersona actor)=>RevisionChange(wo,actor,request.ExpectedWorkingVersion,async(c,t,h,s,effective,quoted,now)=>{
        var draft=EditableWo(s,request.RevisionId,request.LeaseId,actor,now);
        Require(!string.IsNullOrWhiteSpace(draft.Reason)&&draft.Differences.Length==2,"wo_revision_save_required","Save the draft with its change reason before approval.");
        Require(draft.PreviousRevisionId==effective.Id,"wo_revision_effective_changed","Review changes against the current effective Traveler.");
        ValidateSnapshot(draft,quoted);await VerifyVisuals(draft.Visuals??[],draft.TravelerId);var warnings=Warnings(draft.Operations,effective.Operations);
        Require(warnings.Length==0||request.WarningsReviewed,"wo_revision_warnings_required","Review the sequence-sensitive warnings before making this revision effective.");
        Require(!((draft.Clarifications??[]).Any(n=>!n.Removed)||draft.Differences.Any(d=>(d.Clarifications??[]).Length>0||(d.Content??[]).Length>0)||(draft.Substeps??[]).Any(n=>!n.Removed)||(draft.Visuals??[]).Any(n=>!n.Removed))||request.TechnicalConsistencyReviewed,"wo_clarification_review_required","Review WO clarifications for consistency with controlled technical requirements.");
        var frozen=draft with{Status="APPROVED",Lease=null,Approval=new(actor.Id,actor.DisplayName,now,draft.Version),
            Differences=[Diff(effective,draft.Operations,draft.SourceSequences,draft.Clarifications??[],draft.Substeps??[],draft.Visuals??[],draft.OperationContent??[]),Diff(quoted,draft.Operations,draft.SourceSequences,draft.Clarifications??[],draft.Substeps??[],draft.Visuals??[],draft.OperationContent??[])],Warnings=warnings};
        var head=h with{WorkingVersion=h.WorkingVersion+1,EffectiveRevisionId=frozen.Id,EffectiveVersion=frozen.Version};
        await SimProductionStore.FreezeRevision(c,t,frozen);await SimProductionStore.SaveHead(c,t,head);
        await WoEvent(c,t,head,frozen,"WO_REVISION_APPROVED_EFFECTIVE",actor,now,new{previousEffectiveRevisionId=effective.Id,reason=frozen.Reason,contentHash=Hash(frozen),request.WarningsReviewed,request.TechnicalConsistencyReviewed});
    });
    private static bool Active(SimTravelerOperation op)=>op.Enabled&&op.Classification=="PRODUCTION";
    internal static SimTravelerOperation[] Reorder(SimWoTravelerRevision draft,string[] ids){
        var active=draft.Operations.Where(Active).OrderBy(o=>o.Sequence).ToArray();
        Require(ids.Length==active.Length&&ids.Distinct(StringComparer.Ordinal).Count()==ids.Length&&ids.All(id=>active.Any(o=>o.Id==id)),
            "wo_revision_operation_identity","Provide every active stable operation ID exactly once; Materials prerequisites cannot be reordered.");
        var byId=active.ToDictionary(o=>o.Id);var proposed=ids.Select(id=>byId[id]).ToArray();
        var roots=active.Where(o=>draft.SourceParents.GetValueOrDefault(o.SourceOperationId) is null).ToArray();
        var groups=roots.ToDictionary(o=>o.Id,o=>new[]{o}.Concat(active.Where(child=>draft.SourceParents.GetValueOrDefault(child.SourceOperationId)==o.SourceOperationId).OrderBy(child=>draft.SourceSequences[child.Id])).ToArray());
        var rootOrder=proposed.Where(o=>groups.ContainsKey(o.Id)).ToArray();
        Require(rootOrder.SelectMany(o=>groups[o.Id]).Select(o=>o.Id).SequenceEqual(ids),"wo_revision_group_order","Move parent operations and all their child operations as one group, preserving child order.");
        var sequences=new Dictionary<string,decimal>();var slots=roots.Select(o=>decimal.Truncate(o.Sequence)).Order().ToArray();
        for(var i=0;i<rootOrder.Length;i++){var group=groups[rootOrder[i].Id];for(var j=0;j<group.Length;j++)sequences[group[j].Id]=slots[i]+j/100m;}
        var route=draft.Operations.Select(o=>sequences.TryGetValue(o.Id,out var seq)?o with{Sequence=seq}:o).OrderBy(o=>o.Sequence).ToArray();
        Require(route.Select(o=>o.Sequence).Distinct().Count()==route.Length,"wo_revision_group_order","This sequence layout requires review before grouped reordering.");return route;
    }
    private static void ValidateSnapshot(SimWoTravelerRevision revision,SimWoTravelerRevision quoted){
        Require(revision.WorkOrderNumber==quoted.WorkOrderNumber&&revision.Generation==quoted.Generation&&revision.TravelerId==quoted.TravelerId&&revision.DefinitionId==quoted.DefinitionId&&revision.DefinitionVersion==quoted.DefinitionVersion&&revision.SourceToken==quoted.SourceToken&&
            Hash(revision.FrozenPackage)==Hash(quoted.FrozenPackage)&&Hash(revision.SourceSequences)==Hash(quoted.SourceSequences)&&Hash(revision.SourceParents)==Hash(quoted.SourceParents),
            "wo_revision_integrity","WO revision source lineage must remain identical to the original frozen binding.");
        Require(revision.Operations.Length==quoted.Operations.Length&&revision.Operations.Select(o=>o.Id).Distinct().Count()==quoted.Operations.Length,"wo_revision_integrity","The complete operation snapshot must be retained.");
        foreach(var op in revision.Operations){var original=quoted.Operations.SingleOrDefault(o=>o.Id==op.Id);
            Require(original is not null&&Hash(op with{Sequence=original.Sequence})==Hash(original)&&(!Active(op)?op.Sequence==original.Sequence:true),
                "wo_revision_integrity","Only active WO sequence may change; all attached operation content must remain intact.");
        }
        Require(revision.Operations.All(o=>o.Sequence>0)&&revision.Operations.Select(o=>o.Sequence).Distinct().Count()==revision.Operations.Length,"wo_revision_integrity","WO sequence must be positive and unique.");
        var notes=revision.Clarifications??[];
        Require(notes.Length<=200&&notes.Select(n=>n.Id).Distinct().Count()==notes.Length&&notes.All(n=>n.Id!=Guid.Empty&&n.RevisionId==revision.Id&&
            n.Type=="PRODUCTION_CLARIFICATION"&&!string.IsNullOrWhiteSpace(n.Text)&&n.Text.Length<=4000&&
            revision.Operations.Any(o=>Active(o)&&o.Id==n.OperationId&&o.SourceOperationId==n.SourceOperationId)),
            "wo_clarification_invalid","Clarifications must retain valid identities, content and operation linkage.");
        ValidateAuthoredContent(revision);
        // Revalidate grouping even for a persisted draft, not just incoming reorder commands.
        Reorder(revision,revision.Operations.Where(Active).OrderBy(o=>o.Sequence).Select(o=>o.Id).ToArray());
    }
    private static SimWoRevisionDiff Diff(SimWoTravelerRevision baseline,SimTravelerOperation[] route,Dictionary<string,decimal> sourceSequences,SimWoClarification[] clarifications,SimWoSubstep[]? substeps=null,SimWoVisual[]? visuals=null,SimWoOperationContent[]? operationContent=null){
        var previous=baseline.Operations.Where(Active).OrderBy(o=>o.Sequence).ToArray();var proposed=route.Where(Active).OrderBy(o=>o.Sequence).ToArray();
        var rows=proposed.Select((o,i)=>{var old=Array.FindIndex(previous,p=>p.Id==o.Id);return new SimWoSequenceChange(o.Id,o.SourceOperationId,o.Name,sourceSequences[o.Id],old+1,i+1,previous[old].Sequence,o.Sequence,old!=i||previous[old].Sequence!=o.Sequence);}).ToArray();
        var before=(baseline.Clarifications??[]).Where(n=>!n.Removed).ToDictionary(n=>n.Id);
        var after=clarifications.Where(n=>!n.Removed).ToDictionary(n=>n.Id);
        var changes=before.Keys.Union(after.Keys).Select(id=>{
            before.TryGetValue(id,out var old);after.TryGetValue(id,out var next);var item=next??old!;
            return new SimWoClarificationChange(id,item.OperationId,route.Single(o=>o.Id==item.OperationId).Name,
                old is null?(next!.TeamSource is null?"ADDED":"PROMOTED"):next is null?"REMOVED":"CHANGED",old?.Text,next?.Text);
        }).Where(n=>n.Before!=n.After).ToArray();
        var contentChanges=ContentDiff(baseline,route,substeps??[],visuals??[],operationContent??[]);
        return new(baseline.Id,baseline.Version,(rows.Any(r=>r.Changed)?"Order changed.":"Order unchanged.")+" "+
            (changes.Length>0?$"{changes.Length} clarification change(s). Source content unchanged.":"Source operation content unchanged.")+ $" {contentChanges.Length} controlled operation change(s).",rows,changes,contentChanges);
    }
    private static SimWoClarification[] ReviewClarifications(SimWoTravelerRevision draft,SimWoClarificationInput[]? inputs,SimPersona actor,DateTimeOffset now,SimProductionTeamInput[] inputsSource){
        var retained=draft.Clarifications??[];
        if(inputs is null)return retained; // Older reorder clients preserve governed content.
        Require(inputs.Length<=200&&inputs.All(n=>n is not null&&n.Id!=Guid.Empty)&&inputs.Select(n=>n.Id).Distinct().Count()==inputs.Length,
            "wo_clarification_invalid","Provide unique clarification identities (maximum 200).");
        var result=new List<SimWoClarification>();
        foreach(var input in inputs){
            var op=draft.Operations.SingleOrDefault(o=>o.Id==input.OperationId&&Active(o));
            var old=retained.SingleOrDefault(n=>n.Id==input.Id);
            Require(op is not null&&!string.IsNullOrWhiteSpace(input.Text)&&input.Text.Length<=4000&&
                (old is null||!old.Removed&&old.OperationId==input.OperationId),"wo_clarification_invalid",
                "Use nonempty text (maximum 4000 characters) on an existing Production operation. Removed identities cannot be reused or moved.");
            var text=input.Text.Trim();
            if(old is null&&input.TeamSource is not null){var team=TeamSource(inputsSource,input.TeamSource,draft,input.OperationId,"NOTE");Require(text==team.Text,"team_promotion_changed","Promote the reviewed Team Note unchanged; edit the clarification in a subsequent draft save.");}
            Require(old is null||input.TeamSource is null||input.TeamSource==old.TeamSource,"team_promotion_changed","Retain original promotion provenance.");
            result.Add(old is null?new(input.Id,draft.Id,op!.Id,op.SourceOperationId,text,actor.DisplayName,now,draft.Version,actor.DisplayName,now,TeamSource:input.TeamSource):
                old.Text==text?old:old with{Text=text,UpdatedBy=actor.DisplayName,UpdatedAt=now});
        }
        result.AddRange(retained.Where(n=>!inputs.Any(i=>i.Id==n.Id)).Select(n=>n.Removed?n:n with{Removed=true,UpdatedBy=actor.DisplayName,UpdatedAt=now}));
        Require(result.Count<=200,"wo_clarification_invalid","This revision has reached its retained clarification limit.");
        return result.ToArray();
    }
    private static SimWoRevisionWarning[] Warnings(SimTravelerOperation[] route,SimTravelerOperation[] previous){
        if(route.OrderBy(o=>o.Sequence).Select(o=>o.Id).SequenceEqual(previous.OrderBy(o=>o.Sequence).Select(o=>o.Id)))return [];
        var warning=new Regex(@"first[ -]?piece|\bhold\b|inspect|\btest\b|packag|\bbefore\b|\bafter\b|\b(?:op(?:eration)?|step|seq(?:uence)?)\s*[#:]?\s*\d+",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
        return route.Where(Active).SelectMany(o=>new[]{o.Instructions,o.ShopInstructions,o.InspectionRequirements}.Concat(o.ProductionNotes.Select(n=>n.Text))
            .Where(text=>!string.IsNullOrWhiteSpace(text)&&warning.IsMatch(text)).Distinct().Select(text=>new SimWoRevisionWarning(o.Id,o.Name,"Review sequence-sensitive instruction / gate",text))).ToArray();
    }
    private static Task WoEvent(SqliteConnection c,SqliteTransaction t,SimWoRevisionHead head,SimWoTravelerRevision draft,string action,SimPersona actor,DateTimeOffset now,object detail)=>
        SimProductionStore.RevisionEvent(c,t,new(Guid.NewGuid(),head.TravelerId,draft.Id,head.WorkOrderNumber,head.Generation,action,head.WorkingVersion,actor.Id,actor.DisplayName,now,JsonSerializer.SerializeToElement(detail,Json)));
}
