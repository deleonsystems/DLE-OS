using System.Globalization;

internal sealed record SimOrderDateDecision(string Disposition, string? Note);
internal sealed record SimOrderDateEvent(string Kind, int? LineIndex, string? Date, string Disposition,
    string? Note, string ReviewerId, string Reviewer, DateTimeOffset At);
internal sealed record SimOrderContractDates(SimOrderDateEvent? PoDateVerification,
    SimOrderDateEvent? DueDateReview, SimOrderDateEvent[] History);

internal sealed partial class SimRfqIntakeStore
{
    private static bool ValidContractDate(string? value) => DateOnly.TryParseExact(value, "yyyy-MM-dd",
        CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    internal static SimOrderContractDates ReviewContractDates(SimOrderSaveRequest request,
        SimNewOrderPackage? prior, SimPersona persona)
    {
        var history = (prior?.ContractDates?.History ?? []).ToList();
        var po = prior?.ContractDates?.PoDateVerification;
        var due = prior?.ContractDates?.DueDateReview;
        var date = request.Facts.Lines.FirstOrDefault()?.CustomerDueDate;
        SimOrderDateEvent Event(string kind, int? line, string? value, string disposition, string? note) =>
            new(kind,line,value,disposition,note,persona.Id,persona.DisplayName,DateTimeOffset.UtcNow);
        if (po is not null && po.Date != request.Facts.PoDate) {
            history.Add(Event("PO_DATE",null,request.Facts.PoDate,"INVALIDATED",null)); po=null;
        }
        if (due is not null && due.Date != date) {
            history.Add(Event("CUSTOMER_DUE_DATE",0,date,"INVALIDATED",null)); due=null;
        }
        if (request.PoDateVerified && po is null) {
            if (!ValidContractDate(request.Facts.PoDate)) throw SimRfqIntakeProblem.BadRequest("ORDER_PO_DATE", "Enter a valid PO date before verifying it.");
            po=Event("PO_DATE",null,request.Facts.PoDate,"VERIFIED",null); history.Add(po);
        }
        if (request.DueDateDecision is {} decision) {
            if (decision.Disposition is not ("ACCEPT" or "CLARIFICATION" or "CANNOT_MEET"))
                throw SimRfqIntakeProblem.BadRequest("ORDER_DUE_REVIEW", "Choose a due-date disposition.");
            if (decision.Disposition != "CLARIFICATION" && !ValidContractDate(date))
                throw SimRfqIntakeProblem.BadRequest("ORDER_DUE_DATE", "Enter a valid customer due date.");
            if (decision.Disposition != "ACCEPT" && string.IsNullOrWhiteSpace(decision.Note))
                throw SimRfqIntakeProblem.BadRequest("ORDER_DUE_NOTE", "Record the customer clarification or follow-up action.");
            if (due is null || due.Disposition != decision.Disposition || due.Note != decision.Note) {
                due=Event("CUSTOMER_DUE_DATE",0,date,decision.Disposition,decision.Note); history.Add(due);
            }
        }
        if (request.Submit && po is null) throw SimRfqIntakeProblem.BadRequest("ORDER_PO_DATE_VERIFY", "Explicitly verify the PO date in Order Facts.");
        if (request.Submit && due is null) throw SimRfqIntakeProblem.BadRequest("ORDER_DUE_REVIEW", "Review the customer due date before submission.");
        return new(po,due,history.ToArray());
    }
}
