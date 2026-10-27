internal static class SubmissionFixtureChecks
{
    // Existing nonmanual regression fixtures now make the same explicit deck decision as the UI.
    internal static async Task<string> AcceptSlides(SimRfqIntakeStore store,string intakeId,string documentId,SimPersona actor)
    {
        async Task<SimRfqIntakeRecord> Read()=>(SimRfqIntakeRecord)(await store.ReadAsync(intakeId))!;
        var record=await Read();var revision=record.TechnicalReview!.PresentationDraft?.Revision??0;
        var view=System.Text.Json.JsonSerializer.SerializeToNode(await store.ReadPresentation(intakeId),DleAnalysisContract.Json)!;
        await store.SaveReviewReference(intakeId,new(revision,view["bomToken"]!.GetValue<string>(),documentId),actor);
        record=await Read();var slides=await store.ProductionSlidesState(record);
        await store.AcceptProductionSlides(intakeId,new(slides.Revision,slides.Fingerprint),actor);
        var ready=(SimReviewCompletionState)await store.ReleaseReadinessAsync(intakeId);
        if(!ready.Ready)throw new Exception("Existing nonmanual fixture still blocked: "+ready.Message);
        return ready.SubmissionToken;
    }
}
