using System.Text.Json;
internal static class FinalReviewChecks
{
    internal static async Task Run(string sourceRoot,SimRfqIntakeRecord record,SimPersona persona)
    {
        var root=Path.Combine(Path.GetTempPath(),"final-review-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(Path.Combine(root,"data"));
        foreach(var file in new[]{"rfq-intakes.json","rfq-lanes.json"})File.Copy(Path.Combine(sourceRoot,"data",file),Path.Combine(root,"data",file));
        var store=new SimRfqIntakeStore(root);var id=record.IntakeId;
        void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS: Final Review "+label);}
        async Task Block(Func<Task> action,string label){try{await action();}catch(SimRfqIntakeProblem){Check(true,label);return;}throw new Exception(label);}
        var source=await File.ReadAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"));
        var v=await store.ReadFinalReview(id);
        SimFinalAnswers answers=new("4 weeks after order",false,false,true,"LOW","","CLASS_2",false,"");
        SimFinalApproveRequest Request()=>new(v.SourceToken,v.Approvals.Length,answers);
        Check(v.Blockers.Length>0,"incomplete lane has clear blockers");
        await Block(()=>store.ApproveFinalReview(id,Request(),persona),"incomplete lane blocks approval");
        var m=await store.ReadMaterials(id);
        var mr=m.Plan.Rows.Select(r=>r with{Vendor="Synthetic vendor",VendorSource="MANUAL_QUOTE_ONLY",UnitPrice=2,OrderQuantityMode="AUTO",LeadTimeMode="WEEKS",LeadTimeValue=3,LeadDays=null,CustomerSupplied=false}).ToArray();
        m=await store.SaveMaterials(id,new(m.Plan.Revision,mr,true,25),persona);
        await MaterialsCompletionChecks.Run(store,id,persona);
        m=await store.ReadMaterials(id);
        var l=await store.ReadLabor(id);
        var charges=new[]{new SimLaborCharge(Guid.NewGuid().ToString(),"RECURRING","Packing",0.5m),new SimLaborCharge(Guid.NewGuid().ToString(),"NRE","Programming",250m),new SimLaborCharge(Guid.NewGuid().ToString(),"NRE","Tooling",400m)};
        l=await store.SaveLabor(id,new(l.Plan.Revision,l.Plan.DefinitionId,l.Plan.Quantity,l.Plan.Operations,75,25,true,l.Plan.CalculationVersion,1,1,charges,1),persona);
        v=await store.ReadFinalReview(id);Check(v.Blockers.Length==0,"completed current sources are eligible");
        Check(v.Summary.CombinedUnitPrice==m.Plan.Versions.Last().MaterialUnitSalePrice+l.Totals.UnitSalePrice&&v.Summary.Total==v.Summary.CombinedUnitPrice*v.Summary.Quantity,"decimal combined unit and extended price use completed outputs");
        Check(v.Summary.NreTotal==650&&v.Summary.NreLines.Length==2&&v.Summary.MaterialLongestLeadDays==21,"NRE separate and lead derived");
        foreach(var bad in new[]{answers with{Delivery=""},answers with{DeliveryValue=-1,DeliveryUnit="DAYS"},answers with{DeliveryValue=4,DeliveryUnit="MONTHS"},answers with{RiskNotes=new string('x',2001)}})
            await Block(()=>store.ApproveFinalReview(id,Request() with{Answers=bad},persona),"delivery/length protection");
        Check(v.Summary.QuoteTotal==v.Summary.Total+650,"overall total adds separate NRE without altering production subtotal");
        try{await store.GenerateQuotationPdf(id,999);throw new Exception("unapproved PDF allowed");}catch(SimRfqIntakeProblem){Check(true,"unapproved PDF generation rejected");}
        var lanesBefore=(await store.ReadRfqs()).Single(r=>r.IntakeId==id).Lanes;
        var stale=Request();var approved=await store.ApproveFinalReview(id,Request() with {Answers=answers with {DeliveryValue=6,DeliveryUnit="WEEKS",Outsourced=null,HighUnitCost=null,CanMeetDelivery=null,RiskSeverity="",Class="",Itar=null}},persona);
        Check(approved.Approvals[0].Answers.DeliveryValue==6&&approved.Approvals[0].Answers.DeliveryUnit=="WEEKS"&&approved.Approvals[0].Answers.Delivery=="6 Weeks","structured reviewer override persisted");
        Check(approved.ApprovalCurrent&&approved.Approvals.Length==1&&approved.Approvals[0].ApprovedById==persona.Id&&approved.Approvals[0].ApprovedAt!=default,"server identity/time and immutable snapshot created");
        await Block(()=>store.ApproveFinalReview(id,stale,persona),"double submit blocked");
        v=approved;await Block(()=>store.ApproveFinalReview(id,Request(),persona),"same source cannot be reapproved");
        var customer=JsonSerializer.Serialize(SimQuotationPdf.CustomerProjection(approved.Approvals[0]));
        Check(!customer.Contains("riskNotes")&&!customer.Contains("materialUnitSale")&&!customer.Contains("approvedBy")&&!customer.Contains("markup"),"customer projection excludes internal data");
        var pdf=await store.GenerateQuotationPdf(id,1);var samePdf=await store.GenerateQuotationPdf(id,1);
        Check(pdf.Sha256==samePdf.Sha256,"same approved PDF is reused exactly");
        var pdfBytes=await new SimRfqIntakeStore(root).ReadQuotationPdf(id,1);
        Check(pdfBytes.Bytes.Length>500&&pdfBytes.Name==pdf.QuoteNumber+".pdf","PDF retrieval survives store restart");
        Console.WriteLine("QUOTE_PDF_TEST="+Path.Combine(root,"data","quotation-pdfs",approved.Approvals[0].Id,"layout-v2","quotation.pdf"));
        var snap=JsonSerializer.Serialize(approved.Approvals);
        var reopened=await new SimRfqIntakeStore(root).ReadFinalReview(id);Check(JsonSerializer.Serialize(reopened.Approvals)==snap&&reopened.ApprovalCurrent,"approval survives restart exactly");
        var lanesAfter=(await store.ReadRfqs()).Single(r=>r.IntakeId==id).Lanes;
        Check(JsonSerializer.Serialize(lanesBefore.MaterialsQuote)==JsonSerializer.Serialize(lanesAfter.MaterialsQuote)&&JsonSerializer.Serialize(lanesBefore.LaborQuote)==JsonSerializer.Serialize(lanesAfter.LaborQuote),"approval never rewrites Materials or Labor");
        l=await store.SaveLabor(id,new(l.Plan.Revision,l.Plan.DefinitionId,l.Plan.Quantity,l.Plan.Operations,100,25,false,l.Plan.CalculationVersion,1,1,charges,1),persona);
        Check(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData((await store.ReadQuotationPdf(id,1)).Bytes))==pdf.Sha256,"later live edits cannot change issued PDF");
        v=await store.ReadFinalReview(id);Check(!v.ApprovalCurrent&&v.Blockers.Length>0&&JsonSerializer.Serialize(v.Approvals)==snap,"later draft invalidates current approval without rewriting history");
        await Block(()=>store.ApproveFinalReview(id,stale,persona),"stale source request blocked");
        l=await store.SaveLabor(id,new(l.Plan.Revision,l.Plan.DefinitionId,l.Plan.Quantity,l.Plan.Operations,100,25,true,l.Plan.CalculationVersion,1,1,charges,1,new(2,"WEEKS"),1),persona);
        v=await store.ReadFinalReview(id);await Block(()=>store.ApproveFinalReview(id,new(stale.SourceToken,1,answers),persona),"recompleted source still rejects old token");
        approved=await store.ApproveFinalReview(id,Request(),persona);Check(approved.Approvals.Last().Summary.ManufacturingLeadDays==14&&approved.Approvals.Last().Summary.SuggestedLeadDays==35,"approval freezes exact completed lead context");Check(approved.Approvals.Length==2&&JsonSerializer.Serialize(approved.Approvals.Take(1))==snap,"new source approval appends history");
        Check(await File.ReadAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"))==source,"Intake and Technical Review untouched");
        await CustomerSuppliedChecks.Run(root,id,persona);
        await LaborLeadChecks.Run(root,id,persona);
        var dataset=System.Text.Json.Nodes.JsonNode.Parse(source)!;
        var intake=dataset["records"]!.AsArray().Single(n=>n!["intakeId"]!.GetValue<string>()==id)!;
        intake["status"]="NO_LONGER_REQUIRED";
        await File.WriteAllTextAsync(Path.Combine(root,"data","rfq-intakes.json"),dataset.ToJsonString());
        var withdrawn=await store.ReadFinalReview(id);
        Check(!withdrawn.Summary.TechnicalComplete&&!withdrawn.ApprovalCurrent&&withdrawn.Approvals.Length==2,"withdrawn Technical Review blocks while approval history stays readable");
        await Block(()=>store.ApproveFinalReview(id,new(withdrawn.SourceToken,2,answers),persona),"Technical Review gate enforced on server");
    }
}
