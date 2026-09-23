using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

internal static class KittingDraftValidator
{
    internal static KittingDraftValidation Validate(JsonElement draft,string workOrder,bool requireComplete,
        bool poTraceabilityRequired)
    {
        if (draft.ValueKind!=JsonValueKind.Object) throw Bad("draft_required","A Kitting draft is required.");
        if (Text(draft,"workOrder")?.PadLeft(7,'0')!=workOrder) throw Bad("draft_work_order_mismatch","The draft Work Order does not match the case.");
        if (!draft.TryGetProperty("groups",out var groups)||groups.ValueKind!=JsonValueKind.Array)
            throw Bad("requirements_required","The Kitting draft has no requirement collection.");
        var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var actionable=0;var completed=0;var shortCount=0;decimal shortage=0;
        foreach(var group in groups.EnumerateArray())
        {
            var sequence=Text(group,"sequence")??"";if(sequence.Length==0||!seen.Add(sequence))throw Bad("requirement_identity_invalid","Requirement identities must be unique.");
            if(!Bool(group,"actionable"))continue;actionable++;
            if(!group.TryGetProperty("entry",out var entry)||entry.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)continue;
            var eligible=group.GetProperty("eligibleParts").EnumerateArray().Select(x=>x.GetString()?.Trim()??"").Where(x=>x.Length>0).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if(eligible.Count==0)throw Bad("eligible_parts_required","An actionable requirement has no governed eligible parts.");
            var method=Text(entry,"method")??"";decimal calculatedShort;
            var submitted=string.Equals(Text(group,"rowState"),"SUBMITTED",StringComparison.OrdinalIgnoreCase);
            if(!submitted)
            {
                if(method is not ("COMPLETE" or "COMPLETE_MIN_EXTRA" or "COUNT"))
                    throw Bad("kitting_method_invalid","Kitting method is invalid.");
                var draftPart=Text(entry,"selectedPartNumber");
                if(!string.IsNullOrWhiteSpace(draftPart)&&!eligible.Contains(draftPart))
                    throw Bad("eligible_part_required","The draft selected part is outside the governed main/Related set.");
                ValidatePo(Text(entry,"purchaseOrder"));
                if(entry.TryGetProperty("allocations",out var draftAllocations)&&draftAllocations.ValueKind==JsonValueKind.Array)
                    foreach(var allocation in draftAllocations.EnumerateArray())
                    {
                        var part=Text(allocation,"partNumber");
                        if(!string.IsNullOrWhiteSpace(part)&&!eligible.Contains(part))
                            throw Bad("allocation_part_not_eligible","Allocation part is outside the governed main/Related set.");
                        if(allocation.TryGetProperty("quantity",out var quantityValue)&&quantityValue.ValueKind!=JsonValueKind.Null&&
                            (!decimal.TryParse(quantityValue.ToString(),NumberStyles.Number,CultureInfo.InvariantCulture,out var quantity)||quantity<0))
                            throw Bad("allocation_quantity_invalid","Allocation quantity must be zero or greater.");
                        ValidatePo(Text(allocation,"purchaseOrder"));
                        ValidateAcceptedMaterial(allocation,part,Text(allocation,"purchaseOrder"));
                    }
                if(poTraceabilityRequired&&IsCompleteDraftEntry(entry)&&!HasPoEvidence(entry)&&
                    (method is "COMPLETE" or "COMPLETE_MIN_EXTRA"))
                    throw Bad("po_traceability_required",
                        "P.O. is required before a Complete Kitting result can be saved or closed.");
                if(poTraceabilityRequired&&IsCompleteDraftEntry(entry)&&method=="COUNT"&&
                    entry.TryGetProperty("allocations",out var completeDraftAllocations)&&
                    completeDraftAllocations.ValueKind==JsonValueKind.Array)
                    foreach(var allocation in completeDraftAllocations.EnumerateArray())
                    {
                        if(Decimal(allocation,"quantity",out var quantity)&&quantity>0&&!HasPoEvidence(allocation))
                            throw Bad("po_traceability_required",
                                "Every positive material allocation requires its own P.O. traceability evidence.");
                    }
                continue;
            }
            if(method is "COMPLETE" or "COMPLETE_MIN_EXTRA")
            {
                if(!eligible.Contains(Text(entry,"selectedPartNumber")??""))throw Bad("eligible_part_required","Complete results require a governed selected part.");
                calculatedShort=0;ValidatePo(Text(entry,"purchaseOrder"));
                ValidateAcceptedMaterial(entry,Text(entry,"selectedPartNumber"),Text(entry,"purchaseOrder"));
                if(poTraceabilityRequired&&!HasPoEvidence(entry))
                    throw Bad("po_traceability_required","P.O. traceability is required for each material source actually used.");
            }
            else if(method=="COUNT")
            {
                if(!entry.TryGetProperty("allocations",out var allocations)||allocations.ValueKind!=JsonValueKind.Array||allocations.GetArrayLength()==0)
                    throw Bad("count_allocations_required","Count requires at least one allocation.");
                decimal total=0;foreach(var allocation in allocations.EnumerateArray())
                { if(!eligible.Contains(Text(allocation,"partNumber")??""))throw Bad("allocation_part_not_eligible","Allocation part is outside the governed main/Related set.");
                  if(!Decimal(allocation,"quantity",out var quantity)||quantity<0)throw Bad("allocation_quantity_invalid","Allocation quantity must be zero or greater.");
                  ValidatePo(Text(allocation,"purchaseOrder"));
                  ValidateAcceptedMaterial(allocation,Text(allocation,"partNumber"),Text(allocation,"purchaseOrder"));
                  if(poTraceabilityRequired&&quantity>0&&!HasPoEvidence(allocation))
                      throw Bad("po_traceability_required","Every positive material allocation requires its own P.O. traceability evidence.");
                  total+=quantity; }
                if(!Decimal(group,"requiredQuantity",out var required)||required<0)throw Bad("required_quantity_invalid","Requirement quantity is invalid.");
                calculatedShort=Math.Max(required-total,0);
            }
            else throw Bad("kitting_method_invalid","Kitting method is invalid.");
            if(!Decimal(entry,"shortageQuantity",out var claimed)||Math.Abs(claimed-calculatedShort)>0.0001m)
                throw Bad("kitting_calculation_mismatch","Submitted shortage does not match the authoritative allocation calculation.");
            completed++;
            if(calculatedShort>0){shortCount++;shortage+=calculatedShort;}
        }
        if(actionable==0)throw Bad("actionable_requirements_required","The Kitting Case has no actionable requirements.");
        if(requireComplete&&completed!=actionable)throw Bad("all_requirements_required","Every actionable requirement must be dispositioned before Submit Kitting.");
        return new(JsonSerializer.Serialize(draft),actionable,completed,shortCount,shortage);
    }
    // This evidence boundary intentionally centralizes allocation traceability so future governed
    // Customer Supplied Material and Approved Exception evidence can be added without changing case policy.
    private static bool HasPoEvidence(JsonElement value)=>!string.IsNullOrWhiteSpace(Text(value,"purchaseOrder"));
    private static bool IsCompleteDraftEntry(JsonElement entry)=>
        Text(entry,"method") is "COMPLETE" or "COMPLETE_MIN_EXTRA" ||
        Decimal(entry,"shortageQuantity",out var shortage)&&Math.Abs(shortage)<=0.0001m;
    private static void ValidatePo(string? value){if((value??"").Length>80)throw Bad("purchase_order_too_long","P.O. evidence is limited to 80 characters.");}
    private static void ValidateAcceptedMaterial(JsonElement source,string? part,string? purchaseOrder)
    {
        if(!source.TryGetProperty("acceptedMaterial",out var identity)||identity.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)return;
        if(identity.ValueKind!=JsonValueKind.Object||Text(identity,"identityType")!="CANONICAL_PURCHASE_RECEIPT_LINE"||
            !Regex.IsMatch(Text(identity,"purchaseReceiptLineId")??"","^[0-9a-fA-F]{50}$"))
            throw Bad("accepted_material_identity_invalid","Accepted material must reference a governed canonical receipt line.");
        if(!string.Equals(Text(identity,"partNumber"),part,StringComparison.OrdinalIgnoreCase)||
            !SamePo(Text(identity,"purchaseOrderNumber"),purchaseOrder)||
            !Decimal(identity,"quantityAccepted",out var accepted)||accepted<=0)
            throw Bad("accepted_material_source_mismatch","Accepted material identity does not match the allocation part and P.O.");
    }
    private static bool SamePo(string? left,string? right)
    {
        static string Normalize(string? value){var text=(value??"").Trim();return Regex.IsMatch(text,"^[0-9]+$")?
            text.TrimStart('0') is var digits&&digits.Length>0?digits:"0":text.ToUpperInvariant();}
        return Normalize(left)==Normalize(right);
    }
    private static string? Text(JsonElement value,string name)=>value.TryGetProperty(name,out var item)&&item.ValueKind!=JsonValueKind.Null?item.ToString().Trim():null;
    private static bool Bool(JsonElement value,string name)=>value.TryGetProperty(name,out var item)&&item.ValueKind==JsonValueKind.True;
    private static bool Decimal(JsonElement value,string name,out decimal result)
    {
        result=0;
        return value.TryGetProperty(name,out var item)&&
            decimal.TryParse(item.ToString(),NumberStyles.Number,CultureInfo.InvariantCulture,out result);
    }
    private static KittingCaseProblem Bad(string code,string message)=>KittingCaseProblem.BadRequest(code,message);
}


internal sealed record KittingDraftValidation(string Json,int ActionableCount,int CompletedCount,int ShortCount,decimal TotalShortage);
