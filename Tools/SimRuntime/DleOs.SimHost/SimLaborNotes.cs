internal sealed record SimLaborNote(string Id, string RowId, string Purpose, string Text,
    string Sequence = "", string Operation = "", string Author = "", DateTimeOffset CreatedAt = default,
    string? UpdatedBy = null, DateTimeOffset? UpdatedAt = null, bool Removed = false,
    string? RemovedBy = null, DateTimeOffset? RemovedAt = null);

internal sealed partial class SimRfqIntakeStore
{
    private static (SimLaborOperation[] Operations, SimLaborNote[]? Removed) ValidateLaborNotes(
        SimLaborPlan plan, SimLaborOperation[] operations, int contract, SimPersona persona)
    {
        var prior = plan.Operations.SelectMany(o => o.Notes ?? []).ToArray();
        var supplied = operations.SelectMany(o => o.Notes ?? []).ToArray();
        if ((prior.Length > 0 || supplied.Length > 0 || plan.RemovedNotes?.Length > 0) && contract != 1)
            throw SimRfqIntakeProblem.Conflict("LABOR_NOTE_CONTRACT", "Reload Labor before saving its step notes.");
        if (supplied.Length > 1000 || operations.Any(o => (o.Notes?.Length ?? 0) > 50) ||
            supplied.Any(n => n is null || !Guid.TryParseExact(n.Id, "D", out _) || n.Purpose is not ("PRODUCTION" or "INTERNAL_RFQ") || string.IsNullOrWhiteSpace(n.Text) || n.Text.Length > 2000) ||
            supplied.Select(n => n.Id).Distinct().Count() != supplied.Length)
            throw SimRfqIntakeProblem.BadRequest("LABOR_NOTE_VALUES", "Use Production or Internal RFQ notes, with text from 1 to 2000 characters and up to 50 notes per row.");
        var now = DateTimeOffset.UtcNow;
        SimLaborNote Remove(SimLaborNote n) => n.Removed ? n : n with { Removed = true, RemovedBy = persona.DisplayName, RemovedAt = now };
        var removed = (plan.RemovedNotes ?? []).ToList();
        var result = new List<SimLaborOperation>();
        var parents = operations.Where(o => o.ParentId is null).ToArray();
        foreach (var operation in operations)
        {
            var parentIndex = Array.FindIndex(parents, p => p.Id == (operation.ParentId ?? operation.Id));
            var sequence = ((parentIndex + 1) * 10).ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (operation.ParentId is not null)
                sequence += "." + (Array.FindIndex(operations.Where(o => o.ParentId == operation.ParentId).ToArray(), o => o.Id == operation.Id) + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var notes = new List<SimLaborNote>();
            foreach (var note in operation.Notes ?? [])
            {
                var old = prior.SingleOrDefault(n => n.Id == note.Id);
                if (note.RowId != operation.Id || old is not null && old.RowId != operation.Id || removed.Any(n => n.Id == note.Id))
                    throw SimRfqIntakeProblem.Conflict("LABOR_NOTE_SCOPE", "Notes must stay with their original Labor row.");
                // Author/time and original sequence are server-owned. Current display sequence is derived from row order.
                var value = old ?? new(note.Id, operation.Id, note.Purpose, note.Text.Trim(), sequence, operation.Name, persona.DisplayName, now);
                if (old is not null && !old.Removed && (old.Text != note.Text.Trim() || old.Purpose != note.Purpose))
                    value = old with { Text = note.Text.Trim(), Purpose = note.Purpose, UpdatedBy = persona.DisplayName, UpdatedAt = now };
                notes.Add(note.Removed ? Remove(value) : value);
            }
            notes.AddRange(prior.Where(n => n.RowId == operation.Id && !notes.Any(v => v.Id == n.Id)).Select(Remove));
            result.Add(operation with { Notes = notes.Count == 0 ? null : notes.ToArray() });
        }
        removed.AddRange(prior.Where(n => !operations.Any(o => o.Id == n.RowId)).Select(Remove));
        return (result.ToArray(), removed.Count == 0 ? null : removed.ToArray());
    }
}
