// Inspection symbols describe authoring relationships only, never inspection results.
internal sealed record SimInspectionAnchor(string DefinitionId,string OperationId,string CardId,string StageId,
    string Kind,int Page,SimDrawingSource? Source=null,string? ImageDocumentId=null,string? ImageSha256=null);
internal sealed record SimInspectionLink(string GroupId,string Role,SimInspectionAnchor Anchor,int? Expected=null);

internal sealed partial class SimRfqIntakeStore
{
    internal static bool IsLinkedInspectionSymbol(string kind) =>
        kind is not null && (kind.EndsWith("-parent",StringComparison.Ordinal) && IsInspectionSymbol(kind[..^7]) ||
        kind.EndsWith("-child",StringComparison.Ordinal) && IsInspectionSymbol(kind[..^6]));

    internal static void ValidateInspectionLinks(SimLaborOperation[] operations,string definitionId)
    {
        void Invalid(string message)=>throw SimRfqIntakeProblem.BadRequest("INSPECTION_LINK_VALUES",message);
        var entries=operations.SelectMany(op=>(op.Slides??[]).SelectMany(card=>card.Stages.SelectMany(stage=>stage.Marks
            .Where(mark=>mark.Inspection is not null).Select(mark=>new{Mark=mark,
                Anchor=new SimInspectionAnchor(definitionId,op.Id,card.Id,stage.Id,card.Kind,card.Page,card.Source,card.ImageDocumentId,card.ImageSha256),
                Excluded=(op.ExcludedSlideIds??[]).Contains(card.Id)})))).ToArray();
        if(entries.Select(e=>e.Mark.Id).Distinct().Count()!=entries.Length)Invalid("Linked symbols must have unique identities. Do not duplicate linked slides.");
        var parents=entries.Where(e=>e.Mark.Inspection!.Role=="parent").ToDictionary(e=>e.Mark.Id);
        foreach(var e in entries)
        {
            var link=e.Mark.Inspection!;
            if(e.Excluded||link.Anchor!=e.Anchor)Invalid("A linked symbol source or slide changed. Restore the original source or remove the links deliberately.");
            if(link.Role=="parent")
            {
                if(link.GroupId!=e.Mark.Id||link.Expected is null or <1 or >1000)Invalid("Parent requires its own identity and an expected count from 1 to 1000.");
                if(entries.Count(c=>c.Mark.Inspection!.Role=="child"&&c.Mark.Inspection.GroupId==e.Mark.Id)>link.Expected)Invalid("Expected count cannot be below placed children.");
            }
            else if(link.Role!="child"||link.Expected is not null||!parents.ContainsKey(link.GroupId))Invalid("Each child requires its original parent in this instruction set. Remove children before their parent.");
        }
    }
}
