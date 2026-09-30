internal sealed partial class SimProductionService
{
    private static SimProductionTeamInput TeamSource(SimProductionTeamInput[] inputs,SimTeamSource link,SimWoTravelerRevision draft,string operation,string kind){
        var n=inputs.Where(n=>n.Id==link.Id).MaxBy(n=>n.Version);
        Require(n is not null&&n.Version==link.Version&&n.Active&&n.Scope=="TEAM_INPUT"&&n.Kind==kind&&n.TravelerId==draft.TravelerId&&n.OperationId==operation,
            "team_promotion_changed","Team Input changed or does not belong to this operation. Refresh before promoting.");return n!;
    }
    private static void ValidateAuthoredContent(SimWoTravelerRevision r){
        bool Op(string id)=>r.Operations.Any(o=>o.Id==id&&Active(o));
        ValidateOperationContent(r);
        var steps=r.Substeps??[];var visuals=r.Visuals??[];
        Require(steps.Length<=500&&steps.Select(n=>n.Id).Distinct().Count()==steps.Length&&steps.All(n=>n.Id!=Guid.Empty&&n.RevisionId==r.Id&&Op(n.OperationId)&&n.Order>0&&!string.IsNullOrWhiteSpace(n.Text)&&n.Text.Length<=4000),"wo_substep_invalid","Use unique substep IDs, valid parent operations, positive order and nonempty instructions up to 4000 characters.");
        Require(steps.Where(n=>!n.Removed).GroupBy(n=>n.OperationId).All(g=>g.Select(n=>n.Order).Distinct().Count()==g.Count()),"wo_substep_order","Substep order must be unique within each parent operation.");
        Require(visuals.Length<=200&&visuals.Select(n=>n.Id).Distinct().Count()==visuals.Length&&visuals.All(n=>n.Id!=Guid.Empty&&n.RevisionId==r.Id&&Op(n.OperationId)&&n.Caption.Length<=500&&n.Source is "WO_AUTHORED" or "PROMOTED_TEAM_INPUT"),"wo_visual_invalid","Use unique WO visuals linked to existing operations with captions up to 500 characters.");
    }
    private static SimWoSubstep[] ReviewSubsteps(SimWoTravelerRevision draft,SimWoSubstepInput[]? inputs,SimPersona actor,DateTimeOffset now){
        var retained=draft.Substeps??[];if(inputs is null)return retained;
        Require(inputs.Length<=500&&inputs.All(n=>n is not null&&n.Id!=Guid.Empty)&&inputs.Select(n=>n.Id).Distinct().Count()==inputs.Length,"wo_substep_invalid","Provide unique substep IDs.");
        var result=new List<SimWoSubstep>();
        foreach(var input in inputs){var old=retained.SingleOrDefault(n=>n.Id==input.Id);
            Require(!string.IsNullOrWhiteSpace(input.Text)&&input.Text.Length<=4000&&input.Order>0&&draft.Operations.Any(o=>o.Id==input.OperationId&&Active(o))&&
                (old is null||!old.Removed&&old.OperationId==input.OperationId),"wo_substep_invalid","Substeps require instructions and cannot move between parents or reuse removed identities.");
            result.Add(old is null?new(input.Id,draft.Id,input.OperationId,input.Order,input.Text.Trim(),actor.DisplayName,now,actor.DisplayName,now):
                old.Text==input.Text.Trim()&&old.Order==input.Order?old:old with{Text=input.Text.Trim(),Order=input.Order,UpdatedBy=actor.DisplayName,UpdatedAt=now});
        }
        result.AddRange(retained.Where(n=>!inputs.Any(i=>i.Id==n.Id)).Select(n=>n.Removed?n:n with{Removed=true,UpdatedBy=actor.DisplayName,UpdatedAt=now}));return result.ToArray();
    }
    private async Task<SimWoVisual[]> ReviewVisuals(SimWoTravelerRevision draft,SimWoVisualInput[]? inputs,SimPersona actor,DateTimeOffset now,SimProductionTeamInput[] assets){
        var retained=draft.Visuals??[];if(inputs is null)return retained;
        Require(inputs.Length<=200&&inputs.All(n=>n is not null&&n.Id!=Guid.Empty)&&inputs.Select(n=>n.Id).Distinct().Count()==inputs.Length,"wo_visual_invalid","Provide unique visual identities.");
        var result=new List<SimWoVisual>();
        foreach(var input in inputs){var old=retained.SingleOrDefault(n=>n.Id==input.Id);var asset=assets.Where(n=>n.Id==input.AssetId).MaxBy(n=>n.Version);
            Require(input.Caption is not null&&input.Caption.Length<=500&&draft.Operations.Any(o=>o.Id==input.OperationId&&Active(o))&&asset is not null&&asset.TravelerId==draft.TravelerId&&asset.OperationId==input.OperationId&&asset.Kind=="VISUAL"&&
                (old is null||!old.Removed&&old.OperationId==input.OperationId&&old.AssetId==input.AssetId&&old.TeamSource==input.TeamSource&&old.SupersedesId==input.SupersedesId),"wo_visual_invalid","Retain visual identity, source and operation linkage; use a new reference to supersede a visual.");
            if(old is null){
                if(input.TeamSource is not null){var source=TeamSource(assets,input.TeamSource,draft,input.OperationId,"VISUAL");Require(source.Id==input.AssetId,"wo_visual_invalid","Promotion must reference the selected Team Visual.");}
                else Require(asset!.Scope=="DRAFT_VISUAL"&&asset.DraftRevisionId==draft.Id,"wo_visual_invalid","Use an image staged for this WO draft.");
                if(input.SupersedesId is Guid superseded)Require(retained.Any(v=>v.Id==superseded&&v.OperationId==input.OperationId)&&!inputs.Any(v=>v.Id==superseded),"wo_visual_invalid","Only a removed WO visual on the same operation can be superseded.");
            }
            result.Add(old is null?new(input.Id,draft.Id,input.OperationId,asset!.Id,asset.DocumentId!,asset.Sha256!,asset.Name!,asset.MimeType!,input.Caption!.Trim(),input.TeamSource is null?"WO_AUTHORED":"PROMOTED_TEAM_INPUT",actor.DisplayName,now,actor.DisplayName,now,TeamSource:input.TeamSource,SupersedesId:input.SupersedesId):old.Caption==input.Caption!.Trim()?old:old with{Caption=input.Caption!.Trim(),UpdatedBy=actor.DisplayName,UpdatedAt=now});
        }
        result.AddRange(retained.Where(n=>!inputs.Any(i=>i.Id==n.Id)).Select(n=>n.Removed?n:n with{Removed=true,UpdatedBy=actor.DisplayName,UpdatedAt=now}));await VerifyVisuals(result.ToArray(),draft.TravelerId);return result.ToArray();
    }
    private async Task VerifyVisuals(SimWoVisual[] visuals,Guid traveler){
        foreach(var v in visuals){var bytes=await documents.Bytes(traveler.ToString(),v.DocumentId);Require(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes))==v.Sha256,"wo_visual_integrity","A controlled visual failed verification.");}
    }
    private static SimWoContentChange[] ContentDiff(SimWoTravelerRevision baseline,SimTravelerOperation[] route,SimWoSubstep[] steps,SimWoVisual[] visuals,SimWoOperationContent[]? operationContent=null){
        var result=new List<SimWoContentChange>();
        string Name(string id)=>route.Single(o=>o.Id==id).Name;
        var oldSteps=(baseline.Substeps??[]).Where(n=>!n.Removed).ToDictionary(n=>n.Id);var newSteps=steps.Where(n=>!n.Removed).ToDictionary(n=>n.Id);
        foreach(var id in oldSteps.Keys.Union(newSteps.Keys)){oldSteps.TryGetValue(id,out var old);newSteps.TryGetValue(id,out var n);var item=n??old!;
            if(old is null||n is null||old.Text!=n.Text)result.Add(new(id,item.OperationId,Name(item.OperationId),"SUBSTEP",old is null?"ADDED":n is null?"REMOVED":"CHANGED",old?.Text,n?.Text));
            if(old is not null&&n is not null&&old.Order!=n.Order)result.Add(new(id,item.OperationId,Name(item.OperationId),"SUBSTEP","REORDERED",old.Order.ToString(),n.Order.ToString()));
        }
        var oldVisuals=(baseline.Visuals??[]).Where(n=>!n.Removed).ToDictionary(n=>n.Id);var newVisuals=visuals.Where(n=>!n.Removed).ToDictionary(n=>n.Id);
        foreach(var id in oldVisuals.Keys.Union(newVisuals.Keys)){oldVisuals.TryGetValue(id,out var old);newVisuals.TryGetValue(id,out var n);var item=n??old!;
            if(old is null||n is null||old.Caption!=n.Caption)result.Add(new(id,item.OperationId,Name(item.OperationId),"VISUAL",old is null?(n!.TeamSource is null?"ADDED":"PROMOTED"):n is null?(newVisuals.Values.Any(v=>v.SupersedesId==id)?"SUPERSEDED":"REMOVED"):"CHANGED",old is null?null:old.Name+" · "+old.Caption,n is null?null:n.Name+" · "+n.Caption));
        }
        result.AddRange(OperationContentDiff(baseline,route,operationContent??[]));
        return result.ToArray();
    }
}
