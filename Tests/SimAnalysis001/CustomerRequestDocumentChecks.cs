using System.Text.Json;
using System.Text.Json.Nodes;

internal static class CustomerRequestDocumentChecks
{
    internal static async Task Run(string root, string dataPath, SimPersona persona, byte[] bytes)
    {
        var json=DleAnalysisContract.Json;
        var original=await File.ReadAllTextAsync(dataPath);
        var before=JsonNode.Parse(original)!["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
        var store=new SimRfqIntakeStore(root);
        void Check(bool value,string message) { if(!value)throw new Exception(message); Console.WriteLine("PASS: customer request - "+message); }
        JsonNode Node(object value)=>JsonSerializer.SerializeToNode(value,json)!;
        async Task Block(Func<Task> action) { try { await action(); throw new Exception("Request should fail"); } catch(SimRfqIntakeProblem) { Check(true,"invalid request rejected"); } }
        try {
            Check((before.CustomerRequestDocuments??[]).Length==0,"historical record defaults to empty collection");
            var token=SimRfqIntakeStore.PackageReviewToken(before);
            var sources=SimAnalysisSourceSelection.Select(before.TechnicalReview!.TechnicalPackage!,DleAnalysisContract.SourceSelectionVersion);
            var result=Node(await store.AddCustomerRequestDocument(before.IntakeId,"request.pdf",0,new MemoryStream(bytes),persona));
            var attachment=result["attachment"]!.Deserialize<SimCustomerRequestDocument>(json)!;
            var after=result["record"]!.Deserialize<SimRfqIntakeRecord>(json)!;
            Check(!result["duplicate"]!.GetValue<bool>() && attachment.Owner=="Intake" && attachment.Type=="CUSTOMER_RFQ_REQUEST" && attachment.AddedById==persona.Id,"server-owned identity and audit");
            Check(attachment.Sha256.Equals(DleAnalysisContract.Hash(bytes),StringComparison.OrdinalIgnoreCase),"preserved content hash");
            Check(JsonSerializer.Serialize(before,json)==JsonSerializer.Serialize(after with {CustomerRequestDocuments=before.CustomerRequestDocuments},json),"all original intake and Technical Review fields unchanged");
            Check(SimRfqIntakeStore.PackageReviewToken(after)==token,"Technical Review concurrency token unchanged");
            Check(JsonSerializer.Serialize(sources,json)==JsonSerializer.Serialize(SimAnalysisSourceSelection.Select(after.TechnicalReview!.TechnicalPackage!,DleAnalysisContract.SourceSelectionVersion),json),"analysis sources unchanged");
            Check(!SimTechnicalPackageProvider.Inventory(after).Documents.Any(d=>d.DocumentId==attachment.Document.DocumentId),"request excluded from technical inventory");
            var opened=await new SimRfqIntakeStore(root).OpenCustomerRequestDocument(before.IntakeId,attachment.Document.DocumentId!);
            Check(opened.Bytes.SequenceEqual(bytes),"verified retrieval survives store reopen");
            await Block(()=>store.OpenDocument(before.IntakeId,attachment.Document.DocumentId!));
            await Block(()=>store.OpenCustomerRequestDocument("RFQI-SIM-9999",attachment.Document.DocumentId!));
            var committed=await File.ReadAllTextAsync(dataPath);
            var duplicate=Node(await store.AddCustomerRequestDocument(before.IntakeId,"renamed.pdf",0,new MemoryStream(bytes),persona));
            Check(duplicate["duplicate"]!.GetValue<bool>() && duplicate["attachment"]!["document"]!["documentId"]!.GetValue<string>()==attachment.Document.DocumentId,"retry returns same attachment by hash");
            Check(committed==await File.ReadAllTextAsync(dataPath),"duplicate does not write state");
            await Block(()=>store.AddCustomerRequestDocument("RFQI-SIM-9999","request.pdf",0,new MemoryStream(bytes),persona));
            await Block(()=>store.AddCustomerRequestDocument(before.IntakeId,"empty.pdf",0,new MemoryStream(),persona));
            await Block(()=>store.AddCustomerRequestDocument(before.IntakeId,"large.pdf",0,new MemoryStream(new byte[20*1024*1024+1]),persona));
            Check(committed==await File.ReadAllTextAsync(dataPath),"invalid attachments leave state unchanged");
            var second=Node(await store.AddCustomerRequestDocument(before.IntakeId,"request.pdf",0,new MemoryStream(bytes.Concat(new byte[]{10}).ToArray()),persona));
            var attachments=second["record"]!["customerRequestDocuments"]!.AsArray();
            Check(attachments.Count==2 && attachments[0]!["document"]!["documentId"]!.GetValue<string>()==attachment.Document.DocumentId,"changed content appends without replacing prior file");
        } finally { await File.WriteAllTextAsync(dataPath,original); }
    }
}
