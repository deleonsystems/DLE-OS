using System.Security.Cryptography;

internal sealed record SimCustomerRequestDocument(SimRfqIntakeDocument Document, string Sha256,
    string AddedBy, string AddedById, DateTimeOffset AddedAtUtc,
    string Owner = "Intake", string Type = "CUSTOMER_RFQ_REQUEST");

internal sealed partial class SimRfqIntakeStore
{
    internal async Task<object> AddCustomerRequestDocument(string intakeId, string name, long modified, Stream input, SimPersona persona)
    {
        await gate.WaitAsync();
        try {
            var dataset = await ReadDatasetAsync();
            var index = dataset.Records.FindIndex(r => r.IntakeId == intakeId && r.Environment == "SIM" && r.IntakeType == "NEW_QUOTE_REQUEST");
            if (index < 0) throw SimRfqIntakeProblem.NotFound("SIM_INTAKE_NOT_FOUND", "Select an existing New Quote Request intake.");
            var record = dataset.Records[index];
            using var memory = new MemoryStream();
            var buffer = new byte[81920];
            int count;
            while ((count = await input.ReadAsync(buffer)) > 0) {
                if (memory.Length + count > 20 * 1024 * 1024)
                    throw SimRfqIntakeProblem.BadRequest("SIM_DOCUMENT_TOO_LARGE", "SIM supports files up to 20 MB each.");
                memory.Write(buffer, 0, count);
            }
            var bytes = memory.ToArray();
            var hash = Convert.ToHexString(SHA256.HashData(bytes));
            var existing = (record.CustomerRequestDocuments ?? []).FirstOrDefault(d => d.Sha256 == hash);
            if (existing is not null) {
                await documents.Bytes(record.RequestCorrelationId, existing.Document.DocumentId!);
                return new { duplicate = true, attachment = existing, record };
            }
            var staged = await documents.Stage(record.RequestCorrelationId, name, modified, new MemoryStream(bytes), persona.DisplayName);
            try {
                var attachment = new SimCustomerRequestDocument(staged, hash, persona.DisplayName, persona.Id, DateTimeOffset.UtcNow);
                record = record with { CustomerRequestDocuments = [..record.CustomerRequestDocuments ?? [], attachment] };
                dataset.Records[index] = record;
                dataset.UpdatedAtUtc = attachment.AddedAtUtc;
                await WriteVerifiedAsync(dataset);
                return new { duplicate = false, attachment, record };
            } catch {
                // Preserve binaries if an uncertain write actually committed.
                var committed = (await ReadDatasetAsync()).Records.Any(r => (r.CustomerRequestDocuments ?? []).Any(d => d.Document.DocumentId == staged.DocumentId));
                if (!committed) await documents.Remove(record.RequestCorrelationId, staged.DocumentId!, persona.DisplayName);
                throw;
            }
        } finally { gate.Release(); }
    }

    internal async Task<(SimRfqIntakeDocument Document, byte[] Bytes)> OpenCustomerRequestDocument(string intakeId, string id)
    {
        var record = (await ReadDatasetAsync()).Records.SingleOrDefault(r => r.IntakeId == intakeId && r.Environment == "SIM");
        var attachment = (record?.CustomerRequestDocuments ?? []).SingleOrDefault(d => d.Document.DocumentId == id && d.Document.BinaryStatus == "VERIFIED");
        if (attachment is null) throw SimRfqIntakeProblem.NotFound("SIM_DOCUMENT_NOT_FOUND", "No customer request document with this ID belongs to this intake.");
        return (attachment.Document, await documents.Bytes(record!.RequestCorrelationId, id));
    }
}
