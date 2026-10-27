// Queue status is derived from the exact frozen package. Preparation stays the
// source for authoring and incoming evidence; review never rewrites that record.
internal sealed record LibraryFinalReview(
    string Key,string PackageId,int Version,string Status,string StatusLabel,string ContentHash,
    string PreparationId,string? ProjectId,string IntakeId,int LineNumber,string DisplayId,
    string? Comments,LibraryActor SubmittedBy,LibraryActor? ReviewedBy,string BomId,int BomVersion,
    string IncomingRevision,string DrawingRevision,string BomRevision,int? RequestedQuantity,string? RequestedScope);

internal sealed partial class SimLibraryBomStore
{
    private static bool PackageBelongsTo(LibraryPackageVersion version,LibraryPreparation request)
    {
        var binding=version.Preparation;
        return binding is not null && binding.Id==request.Id &&
            binding.ProjectId==request.ProjectId && binding.IntakeId==request.IntakeId &&
            binding.LineNumber==request.LineNumber && binding.SourceFingerprint==request.SourceFingerprint &&
            binding.IncomingRevision==request.IncomingRevision &&
            binding.RequestedQuantity==request.RequestedQuantity && binding.RequestedScope==request.RequestedScope &&
            version.Bom.DrawingRevision==request.DrawingRevision && version.Bom.BomRevision==request.BomRevision;
    }

    // Called only by the existing protected request queues. The Library lock is
    // acquired after the preparation lock, matching copy and submission ordering.
    internal async Task<LibraryFinalReview?> FinalReviewFor(LibraryPreparation request)
    {
        if(string.IsNullOrEmpty(request.LibraryKey))return null;
        await gate.WaitAsync();
        try
        {
            var record=ReadPackages(request.LibraryKey);
            var version=record.Versions.LastOrDefault(v=>PackageBelongsTo(v,request));
            if(version is null)return null;
            var binding=version.Preparation!;
            var label=version.Status switch
            {
                "SUBMITTED"=>"Awaiting review",
                "APPROVED"=>"Approved",
                "CHANGES_REQUESTED"=>"Returned to Library",
                "WITHDRAWN"=>"Withdrawn",
                _=>version.Status
            };
            return new(request.LibraryKey,version.Id,version.Version,version.Status,label,version.ContentHash,
                binding.Id,binding.ProjectId,binding.IntakeId,binding.LineNumber,binding.DisplayId,
                version.Comments,version.SubmittedBy,version.ReviewedBy,version.Bom.Id,version.Bom.InternalVersion,
                binding.IncomingRevision,version.Bom.DrawingRevision,version.Bom.BomRevision,binding.RequestedQuantity,binding.RequestedScope);
        }
        finally{gate.Release();}
    }

    internal async Task<object> PackageReview(string key,string reviewId,SimPersona persona)
    {
        Permission(persona,review:true);
        await gate.WaitAsync();
        try
        {
            var record=ReadPackages(key);
            var version=record.Versions.SingleOrDefault(v=>v.Id==reviewId);
            Require(version is not null,"This saved review is unavailable. Reopen the request list.");
            VerifyPackage(version!);
            return new{key,packageToken=PackageToken(record),version,
                canReview=version!.Status=="SUBMITTED"&&persona.Can("technical_review.disposition"),finalReviewRoundtrip=true};
        }
        finally{gate.Release();}
    }
}
