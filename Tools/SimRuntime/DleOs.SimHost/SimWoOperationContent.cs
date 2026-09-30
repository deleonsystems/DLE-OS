internal sealed partial class SimProductionService
{
    private static string SourceInstruction(SimTravelerOperation op)=>string.IsNullOrWhiteSpace(op.ShopInstructions)?op.Instructions:op.ShopInstructions;
    private static void ValidateOperationContent(SimWoTravelerRevision revision){
        var items=revision.OperationContent??[];
        Require(items.Length<=revision.Operations.Length&&items.Select(n=>n.OperationId).Distinct().Count()==items.Length&&items.Select(n=>n.Id).Distinct().Count()==items.Length&&
            items.All(n=>n.Id!=Guid.Empty&&n.RevisionId==revision.Id&&revision.Operations.Any(o=>o.Id==n.OperationId&&Active(o))&&ValidOperationText(n.Instructions,n.WorkCenter,n.Department)),
            "wo_operation_content_invalid","WO instructions and work centers must belong to unique active operations in this revision.");
    }
    private static bool ValidOperationText(string? instruction,string? center,string? department)=>instruction is not null&&instruction.Length<=8000&&center is not null&&center.Length<=120&&department is not null&&department.Length<=120&&!center.Any(char.IsControl)&&!department.Any(char.IsControl);
    private static SimWoOperationContent[] ReviewOperationContent(SimWoTravelerRevision draft,SimWoOperationContentInput[]? inputs,SimPersona actor,DateTimeOffset now){
        var retained=draft.OperationContent??[];if(inputs is null)return retained;
        Require(inputs.Length<=draft.Operations.Length&&inputs.All(n=>n is not null)&&inputs.Select(n=>n.OperationId).Distinct().Count()==inputs.Length,"wo_operation_content_invalid","Use each operation once.");
        var result=retained.ToDictionary(n=>n.OperationId);
        foreach(var input in inputs){
            var op=draft.Operations.SingleOrDefault(o=>o.Id==input.OperationId&&Active(o));
            Require(op is not null&&ValidOperationText(input.Instructions,input.WorkCenter,input.Department),"wo_operation_content_invalid","Use instructions up to 8000 characters and work center / department up to 120 characters on an existing operation.");
            var text=input.Instructions.Trim();var center=input.WorkCenter.Trim();var department=input.Department.Trim();result.TryGetValue(input.OperationId,out var old);
            if(old is null&&text==SourceInstruction(op!)&&center==op!.WorkCenter&&department==op.Department)continue;
            result[input.OperationId]=old is null?new(Guid.NewGuid(),draft.Id,input.OperationId,text,center,department,actor.DisplayName,now,actor.DisplayName,now):
                old.Instructions==text&&old.WorkCenter==center&&old.Department==department?old:old with{Instructions=text,WorkCenter=center,Department=department,UpdatedBy=actor.DisplayName,UpdatedAt=now};
        }
        return result.Values.ToArray();
    }
    private static SimWoContentChange[] OperationContentDiff(SimWoTravelerRevision baseline,SimTravelerOperation[] route,SimWoOperationContent[] proposed){
        var changes=new List<SimWoContentChange>();
        foreach(var op in route.Where(Active)){
            var old=baseline.OperationContent?.SingleOrDefault(n=>n.OperationId==op.Id);var next=proposed.SingleOrDefault(n=>n.OperationId==op.Id);
            var before=old?.Instructions??SourceInstruction(op);var after=next?.Instructions??SourceInstruction(op);
            var id=next?.Id??old?.Id??Guid.Empty;
            if(before!=after)changes.Add(new(id,op.Id,op.Name,"TRAVELER_INSTRUCTION",before.Length==0?"ADDED":after.Length==0?"REMOVED":"CHANGED",before,after));
            var beforeCenter=old?.WorkCenter??op.WorkCenter;var afterCenter=next?.WorkCenter??op.WorkCenter;
            var beforeDepartment=old?.Department??op.Department;var afterDepartment=next?.Department??op.Department;
            if(beforeCenter!=afterCenter||beforeDepartment!=afterDepartment)changes.Add(new(id,op.Id,op.Name,"WORK_CENTER","CHANGED",$"{beforeCenter} / {beforeDepartment}".Trim(' ','/'),$"{afterCenter} / {afterDepartment}".Trim(' ','/')));
        }
        return changes.ToArray();
    }
}
