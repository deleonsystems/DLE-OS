using System.Text.Json;
internal static class LaborLeadChecks
{
    internal static async Task Run(string root,string id,SimPersona persona)
    {
        var store=new SimRfqIntakeStore(root);var v=await store.ReadLabor(id);
        void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS: Labor lead "+message);}
        async Task Block(SimManufacturingLead lead){try{await store.SaveLabor(id,Request(lead),persona);}catch(SimRfqIntakeProblem){Check(true,"invalid lead rejected");return;}throw new Exception("invalid lead accepted");}
        SimLaborRequest Request(SimManufacturingLead? lead,bool complete=false)=>new(v.Plan.Revision,v.Plan.DefinitionId,v.Plan.Quantity,v.Plan.Operations,v.Plan.Rate,v.Plan.Markup,complete,v.Plan.CalculationVersion,1,1,v.Plan.Charges,1,lead,1);
        var pricing=JsonSerializer.Serialize(v.Totals);var materials=JsonSerializer.Serialize(v.Rfq.Lanes.MaterialsQuote);var history=JsonSerializer.Serialize(v.Plan.Versions);
        foreach(var lead in new[]{new SimManufacturingLead(0),new(-1),new(36501),new(3,"MONTHS")})await Block(lead);
        v=await store.SaveLabor(id,Request(new(3,"WEEKS")),persona);
        v=await new SimRfqIntakeStore(root).ReadLabor(id);Check(v.Plan.ManufacturingLead==new SimManufacturingLead(3,"WEEKS"),"3 Weeks saved and reopened across store restart");
        try{await store.SaveLabor(id,Request(null) with{LeadContractVersion=0},persona);throw new Exception("old client erased lead");}catch(SimRfqIntakeProblem){Check(true,"older client cannot erase lead");}
        v=await store.SaveLabor(id,Request(new(10,"DAYS"),true),persona);
        Check(v.Plan.Versions.Last().ManufacturingLead==new SimManufacturingLead(10,"DAYS"),"completed version preserves 10 Days");
        var final=await store.ReadFinalReview(id);Check(final.Summary.ManufacturingLead=="2 Weeks","Final Review reads completed lead");
        Check(final.Summary.ManufacturingLeadDays==10&&final.Summary.SuggestedLeadDays==final.Summary.MaterialLongestLeadDays+10,"suggestion uses exact days from completed versions");
        Check(SimRfqIntakeStore.LeadDisplay(14)=="2 Weeks"&&SimRfqIntakeStore.LeadDisplay(28)=="4 Weeks"&&SimRfqIntakeStore.LeadDisplay(12)=="2 Weeks"&&SimRfqIntakeStore.LeadDisplay(3)=="3 Days"&&SimRfqIntakeStore.LeadDisplay(0)=="Stock","normalization and conservative rounding");
        v=await store.SaveLabor(id,Request(new(4,"WEEKS")),persona);
        Check((await store.ReadFinalReview(id)).Summary.ManufacturingLead is null,"draft lead never becomes completed delivery reference");
        Check(JsonSerializer.Serialize(v.Totals)==pricing&&JsonSerializer.Serialize(v.Rfq.Lanes.MaterialsQuote)==materials,"pricing and Materials unchanged");
        Check(JsonSerializer.Serialize(v.Plan.Versions.Take(v.Plan.Versions.Length-1))==history,"prior completed history unchanged");
        v=await store.SaveLabor(id,Request(new(null,"WEEKS")),persona);Check(v.Plan.ManufacturingLead!.Value is null,"optional blank lead remains safe");
    }
}
