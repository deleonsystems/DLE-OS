using System.Text.Json;
using System.Text.Json.Nodes;

// A job execution decision. The released customerSupply/BOM/PO remain immutable.
internal static class SimKittingSupplyDisposition
{
    internal static void StampAllocations(JsonObject group,JsonObject prior,SimPersona actor,DateTimeOffset now)
    {
        if(group["entry"]?["allocations"] is not JsonArray rows)return;
        var old=prior["entry"]?["allocations"] as JsonArray;
        foreach(var a in rows.OfType<JsonObject>()) {
            if(a["sourceType"] is null || a["acceptedMaterial"] is JsonObject)continue;
            var previous=old?.OfType<JsonObject>().FirstOrDefault(x=>x["allocationId"]?.ToString()==a["allocationId"]?.ToString());
            string Signature(JsonObject? row)=>string.Join("|",new[]{"sourceType","purchaseOrder","quantity","customerInstalledQuantity"}.Select(k=>row?[k]?.ToString()));
            var history=previous?["sourceHistory"]?.DeepClone() as JsonArray??new JsonArray();
            if(Signature(a)!=Signature(previous)) history.Add(new JsonObject{
                ["sourceType"]=a["sourceType"]?.DeepClone(),["quantity"]=a["quantity"]?.DeepClone(),["purchaseOrder"]=a["purchaseOrder"]?.DeepClone(),["customerInstalledQuantity"]=a["customerInstalledQuantity"]?.DeepClone(),
                ["previousSourceType"]=previous?["sourceType"]?.DeepClone(),["previousPurchaseOrder"]=previous?["purchaseOrder"]?.DeepClone(),["previousQuantity"]=previous?["quantity"]?.DeepClone(),["previousCustomerInstalledQuantity"]=previous?["customerInstalledQuantity"]?.DeepClone(),
                ["actorId"]=actor.Id,["actor"]=actor.DisplayName,["atUtc"]=now});
            a["sourceHistory"]=history;
        }
    }
    internal static void Stamp(JsonObject group, JsonObject prior, SimPersona actor, DateTimeOffset now)
    {
        var original = group["customerSupply"] is JsonObject ? "CUSTOMER_SUPPLIED" : "PURCHASED";
        var previous = prior["supplyDisposition"] as JsonObject;
        var requested = group["supplyDisposition"];
        if (requested is null) { if (previous is not null) group["supplyDisposition"] = previous.DeepClone(); return; }
        if (requested is not JsonObject || requested["responsibility"]?.ToString() is not ("CUSTOMER_SUPPLIED" or "PURCHASED"))
            throw KittingCaseProblem.BadRequest("supply_disposition_invalid", "Choose P.O. / DLE-STK or C/S.");
        var responsibility = requested["responsibility"]!.ToString();
        if (responsibility == previous?["responsibility"]?.ToString()) { group["supplyDisposition"] = previous.DeepClone(); return; }
        if (group["actionable"]?.GetValue<bool>() != true)
            throw KittingCaseProblem.BadRequest("supply_disposition_nonactionable", "Only a material requirement has a supply disposition.");
        var history = previous?["history"]?.DeepClone() as JsonArray ?? new JsonArray();
        history.Add(new JsonObject { ["responsibility"] = responsibility, ["actorId"] = actor.Id, ["actor"] = actor.DisplayName, ["atUtc"] = now });
        group["supplyDisposition"] = new JsonObject {
            ["responsibility"] = responsibility, ["originalResponsibility"] = original,
            ["actorId"] = actor.Id, ["actor"] = actor.DisplayName, ["atUtc"] = now, ["history"] = history
        };
    }
    internal static JsonElement? Disposition(JsonElement group) =>
        group.TryGetProperty("supplyDisposition", out var value) && value.ValueKind == JsonValueKind.Object ? value.Clone() : null;
    internal static SimCustomerSupplyLine? Effective(JsonElement group)
    {
        var disposition = Disposition(group);
        var responsibility = disposition is {} d ? Text(d,"responsibility") : "";
        if (responsibility == "PURCHASED") return null;
        if (group.TryGetProperty("customerSupply", out var original) && original.ValueKind == JsonValueKind.Object)
            return original.Deserialize<SimCustomerSupplyLine>(SimPurchasingService.Json);
        if (responsibility != "CUSTOMER_SUPPLIED") return null;
        return new(Text(group,"sourceRowId"), (int)Number(group,"sourceRowIndex"), Text(group,"findNumber"),
            Text(group,"customerPartNumber"), Text(group,"partNumber"), Text(group,"description"),
            Number(group,"requiredEach"), Number(group,"requiredQuantity"), Text(group,"unitOfMeasure"), false, "", "", []);
    }
    private static string Text(JsonElement value,string key)=>value.TryGetProperty(key,out var item)?item.ToString():"";
    private static decimal Number(JsonElement value,string key)=>value.TryGetProperty(key,out var item)&&item.TryGetDecimal(out var number)?number:0;
}
