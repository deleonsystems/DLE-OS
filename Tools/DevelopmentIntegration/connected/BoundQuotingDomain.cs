using System.Text.Json;

// Composition helper, not a service entrypoint or provisioning script. The caller
// supplies an already approved private storage boundary and a pinned read-only source.
internal sealed record BoundQuotingDomain(SimRfqIntakeStore Intake,SimLibraryPreparation Preparation,
 SimLibraryBomStore Library,ManagedLibraryEvidence Evidence) {
 internal static BoundQuotingDomain Create(string applicationRoot,string evidenceRootId,IQuotingLibraryReference source){
  if(!Path.IsPathFullyQualified(applicationRoot))throw new ArgumentException("Absolute application root required");
  var full=Path.GetFullPath(applicationRoot);
  // Freeze one verified package per composition: UI and processing see identical rows.
  var snapshot=source.Read();
  var evidence=new ManagedLibraryEvidence(full,evidenceRootId);
  var intake=new SimRfqIntakeStore(Path.Combine(full,"state"),"DEVELOPMENT");
  var preparation=new SimLibraryPreparation(Path.Combine(full,"state"),()=>snapshot.Items.ToArray(),intake.PreparationSource,intake.OpenDocument);
  var library=new SimLibraryBomStore(Path.Combine(full,"state"),preparation.Headers);
  var roots=JsonSerializer.Serialize(new[]{new SimDrawingRoot(evidenceRootId,"Quoting managed evidence",Path.Combine(full,"source"))});
  library.BoundDrawingSources=()=>new SimDrawingFolders(roots);
  intake.PreparationLookup=preparation.Find;preparation.FinalReviewLookup=library.FinalReviewFor;
  intake.PreparationFinalReviewLookup=library.FinalReviewFor;intake.LibraryRfqSource=library.WithRfqSource;
  intake.LibraryRfqPackageRead=library.ReadRfqPackage;intake.LibraryRfqFileRead=library.ReadRfqFile;
  intake.PreviousQuotesAccess=library.WithPreviousQuoteFolder;intake.LibraryBomUpdateSource=library.WithBomUpdatePackages;
  return new(intake,preparation,library,evidence);
 }
}
