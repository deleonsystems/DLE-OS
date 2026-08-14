using System.Text.Json;

static JsonElement Draft(string method, decimal quantity, string po, bool submitted=true)
{
    var required = 20m;
    var shortage = method == "COUNT" ? Math.Max(required - quantity, 0m) : 0m;
    object entry = method == "COUNT"
        ? new { method, selectedPartNumber=(string?)null, purchaseOrder="", allocations=new[] {
            new { allocationId="A1",partNumber="PART-A",quantity,purchaseOrder=po } },
            pickedQuantity=quantity,shortageQuantity=shortage,extraQuantity=Math.Max(quantity-required,0m) }
        : new { method, selectedPartNumber="PART-A", purchaseOrder=po, allocations=Array.Empty<object>(),
            pickedQuantity=(decimal?)null,shortageQuantity=shortage,extraQuantity=(decimal?)null };
    var value = new { workOrder="0115621",groups=new[] { new { sequence="010",actionable=true,
        rowState=submitted?"SUBMITTED":"EDITING",eligibleParts=new[]{"PART-A"},requiredQuantity=required,entry } } };
    return JsonSerializer.SerializeToElement(value);
}

static void Pass(JsonElement draft, bool required, string label)
{
    KittingDraftValidator.Validate(draft,"0115621",true,required);
    Console.WriteLine("PASS " + label);
}

static void Block(JsonElement draft, string label)
{
    try { KittingDraftValidator.Validate(draft,"0115621",true,true); }
    catch (KittingCaseProblem problem) when (problem.Code=="po_traceability_required")
    { Console.WriteLine("PASS " + label); return; }
    throw new Exception("Expected P.O. traceability blocker: " + label);
}

Block(Draft("COMPLETE",0,""),"Required Complete blank P.O. blocked");
Block(Draft("COMPLETE_MIN_EXTRA",0,""),"Required Min Extra blank P.O. blocked");
Block(Draft("COUNT",5,""),"Required positive Count blank P.O. blocked");
Pass(Draft("COMPLETE",0,"PO-100"),true,"Complete P.O. satisfies gate");
Pass(Draft("COUNT",0,""),true,"Zero allocation full shortage needs no P.O.");
Pass(Draft("COUNT",5,""),false,"Optional positive Count permits blank P.O.");

var multi=JsonSerializer.SerializeToElement(new { workOrder="0115621",groups=new[] { new { sequence="010",
    actionable=true,rowState="SUBMITTED",eligibleParts=new[]{"PART-A"},requiredQuantity=20,
    entry=new { method="COUNT",selectedPartNumber=(string?)null,purchaseOrder="",allocations=new[] {
        new { allocationId="A1",partNumber="PART-A",quantity=5,purchaseOrder="PO-A" },
        new { allocationId="A2",partNumber="PART-A",quantity=5,purchaseOrder="" } },
        pickedQuantity=10,shortageQuantity=10,extraQuantity=0 } } } });
Block(multi,"Every allocation independently requires P.O.");
Pass(multi,false,"Optional mode preserves and permits mixed P.O. evidence");
Console.WriteLine("Kitting P.O. traceability validator qualification: PASS");
