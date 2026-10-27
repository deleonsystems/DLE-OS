using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

// Every byte created by this harness stays below its test output directory.
// Host source files are compiled read-only; no HTTP server or live state is used.
internal sealed class Fixture
{
    internal static readonly JsonSerializerOptions Json = SimLibraryBomStore.Json;
    internal readonly string Root = Path.Combine(AppContext.BaseDirectory, "isolated-" + Guid.NewGuid().ToString("N"));
    internal readonly LibraryActor Actor = new("qa", "QA", DateTimeOffset.Parse("2026-10-24T00:00:00Z"));
    internal readonly SimPersona Editor = new("qa", "qa", "QA", "ACTIVE", [], ["technical_review.view", "technical_review.disposition"], false, "test");
    internal SimPersona Viewer => Editor with {Permissions = ["technical_review.view"]};
    internal SimPersona LibraryOnly => Editor with {Permissions = ["assembly_library.view", "assembly_library.edit"]};
    internal SimPersona Inactive => Editor with {AccountStatus = "INACTIVE"};
    internal readonly string[] ProjectIds = [Guid.NewGuid().ToString(), Guid.NewGuid().ToString(), Guid.NewGuid().ToString()];
    internal const string ParentId = "RFQI-SIM-9901";
    internal string Id => ParentId + ".1";
    internal string SiblingId => ParentId + ".2";
    internal string DataPath => Path.Combine(Root, "data", "rfq-intakes.json");
    internal string PackagePath => Path.Combine(Root, "assembly-library-v1", "packages", Hash(Encoding.UTF8.GetBytes("key")) + ".json");
    internal SimLibraryBomStore Library = null!;
    internal SimRfqIntakeStore Store = null!;
    internal SimRfqIntakeRecord Parent = null!;
    internal readonly List<LibraryPackageVersion> Packages = [];
    internal readonly List<SimLibraryRfqReceipt> Receipts = [];
    internal Dictionary<string, string> Protected = [];

    internal static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    internal static string FileHash(string path) => Hash(File.ReadAllBytes(path));
    internal string FullStateHash() => Hash(Encoding.UTF8.GetBytes(string.Join("\n", Directory.GetFiles(Root, "*", SearchOption.AllDirectories).OrderBy(p => p).Select(p => p + ":" + FileHash(p)))));
    internal bool SourcesUnchanged() => Protected.All(p => FileHash(p.Key) == p.Value);
    internal SimRfqIntakeStore NewStore() => new(Root) {LibraryRfqPackageRead = Library.ReadRfqPackage, LibraryRfqFileRead = Library.ReadRfqFile};

    internal static async Task<Fixture> Create()
    {
        var f = new Fixture();
        Directory.CreateDirectory(Path.Combine(f.Root, "data"));
        Directory.CreateDirectory(Path.GetDirectoryName(f.PackagePath)!);
        Directory.CreateDirectory(Path.Combine(f.Root, "rfq-projects-v1"));
        var actor = f.Actor;
        var rows = new LibraryBomRow[] {
            new("row-3","3","CPN-3","Synthetic part","1","EA","","MFG","APPROVED-3","Fixture",true,false,"",false,[]),
            new("row-7","7","CPN-7","Synthetic part","1","EA","","MFG","APPROVED-7","Fixture",true,false,"",false,[]),
            new("row-10","10","CPN-10","Synthetic part","1","EA","","MFG","APPROVED-10","Fixture",true,false,"",false,[]),
            new("row-18","18","CPN-18","Synthetic part","1","EA","","MFG","APPROVED-18","Fixture",true,false,"",false,[])
        };
        var bom = new LibraryBomDraft("bom", "QA-ASSEMBLY", "U*", "U*", "", "PER_ASSEMBLY", true, rows, actor, actor, InternalVersion:1);
        var customer = new SimRfqIntakeCustomer("customer", "0001", "Synthetic", "TEST");
        var assemblies = f.ProjectIds.Select((id, i) => new SimRfqIntakeAssembly(i + 1, "QA-ASSEMBLY", "U ECR 1", 50, id, "MATERIAL_AND_LABOR")).ToArray();
        f.Parent = new(ParentId, Guid.NewGuid().ToString(), "DLE_RFQ_INTAKE_V1", "TECHNICAL_REVIEW", "READY_FOR_TECHNICAL_REVIEW", "NEW_QUOTE_REQUEST",
            customer, 2, assemblies, "MATERIAL_AND_LABOR", false, [], "VERIFIED", [], "QA", actor.AtUtc, "qa", 1, "SIM", QuoteComposition:"COMBINED_DEFAULT_EXPLICIT_PARTIAL");
        await File.WriteAllTextAsync(f.DataPath, JsonSerializer.Serialize(new {schema = "DLE_RFQ_INTAKE_DATASET_V1", records = new[]{f.Parent}}, Json));
        var link = new LibraryFolderLink("link", "key", "QA-ASSEMBLY", "U*", "U*", "drawing-prints", "assembly", "assembly", actor);
        for (var i = 0; i < 3; i++)
        {
            var prep = new LibraryPackagePreparation("prep-" + i, f.ProjectIds[i], ParentId, i + 1, ParentId + "." + (i + 1), "U ECR 1", "source", 50, "MATERIAL_AND_LABOR");
            var pdfHash = Hash([1, 2, 3]);
            var doc = new LibraryPackageDocument(new("drawing", 1, link,
                new("drawing-prints", "assembly/drawing.pdf", "link", 1, "customer", "QA-ASSEMBLY", "U*", "LIBRARY_DOCUMENT", 3, actor.AtUtc, actor.AtUtc, pdfHash, "token", "drawing"),
                ["DRAWING"], "PRODUCTION", "", "", "UNKNOWN", pdfHash, actor), pdfHash);
            var package = new LibraryPackageVersion("package-" + i, 1, "APPROVED", bom, [doc], "", actor, prep, actor);
            package = package with {ContentHash = Hash(JsonSerializer.SerializeToUtf8Bytes(new {package.Bom, package.Documents, package.Preparation}, Json))};
            f.Packages.Add(package);
            var binding = new SimLibraryRfqBinding(f.ProjectIds[i], ParentId, i + 1, prep.DisplayId, "key", package.Id, 1, package.ContentHash, prep.Id, bom.Id, 1, "drawing");
            var receipt = new SimLibraryRfqReceipt("LIBRARY_RFQ_PROJECT_V1", binding, customer, assemblies[i], f.Parent.RequestCorrelationId, [], "QA", actor.AtUtc, "qa", 1, "MATERIAL_AND_LABOR", "QA", actor.AtUtc, "");
            receipt = receipt with {ContentHash = Hash(JsonSerializer.SerializeToUtf8Bytes(receipt, Json))};
            f.Receipts.Add(receipt);
            await File.WriteAllTextAsync(Path.Combine(f.Root, "rfq-projects-v1", f.ProjectIds[i] + ".json"), JsonSerializer.Serialize(receipt, Json));
        }
        await File.WriteAllTextAsync(f.PackagePath, JsonSerializer.Serialize(new LibraryPackagesRecord("key", 1, f.Packages.ToArray()), Json));
        f.Library = new(f.Root, () => [new("key", "hash", "contract", "QA-ASSEMBLY", "QA-ASSEMBLY", "U*", "", "U*", false)]);
        f.Store = f.NewStore();
        f.Protected = Directory.GetFiles(f.Root, "*", SearchOption.AllDirectories).ToDictionary(p => p, FileHash);
        return f;
    }

    internal async Task<SimMaterialAttachment> Stage(SimMaterialView view, int index = 0, string text = "Synthetic vendor evidence", string? id = null)
    {
        await using var stream = new MemoryStream(Encoding.UTF8.GetBytes(text));
        return await Store.StageMaterialAttachment(id ?? Id,
            new(view.Plan.Revision, view.Plan.CandidateId, view.Plan.BomVersion, index, null, "FILE", "DATASHEET", view.Rfq.Inputs.Materials.Version), "evidence.txt", stream, Editor);
    }

    internal async Task<(string Id, SimRfqLanes Lanes)> SeedCompletedLegacy()
    {
        const string id="RFQI-SIM-9902";
        var record=SimRfqIntakeStore.BuildLibraryRfqRecord(Receipts[0],Packages[0]);
        var review=record.TechnicalReview!;var outputs=review.Workflow!.Outputs!;
        var manufacturing=outputs.Manufacturing with{NothingMissing=true};
        record=record with{IntakeId=id,LibraryRfq=null,RequestCorrelationId=Guid.NewGuid().ToString(),
            TechnicalReview=review with{Workflow=review.Workflow with{Manufacturing=manufacturing,Outputs=outputs with{Manufacturing=manufacturing}}}};
        await File.WriteAllTextAsync(DataPath,JsonSerializer.Serialize(new{schema="DLE_RFQ_INTAKE_DATASET_V1",records=new[]{Parent,record}},Json));
        Protected[DataPath]=FileHash(DataPath);
        var accepted=outputs.Materials;var quantity=record.Assemblies[0].Quantity;
        var rows=accepted.Candidate.Rows.Select(s=>SimRfqIntakeStore.DefaultMaterialQuantity(
            SimRfqIntakeStore.MaterialIdentityDefaults(new(s.Index,Vendor:"Mouser",UnitPrice:1,LeadDays:7),s),s,quantity)).ToArray();
        var calculated=rows.Select(r=>SimRfqIntakeStore.CalculateMaterial(r,accepted.Candidate.Rows.Single(s=>s.Index==r.Index),quantity)).ToArray();
        var total=calculated.Sum(r=>r.ExtendedCost??0);
        var snapshot=new SimMaterialSnapshot(1,accepted.Version,accepted.Candidate.Id,quantity,calculated,total,"USD",Actor.Name,Actor.AtUtc,0,total/quantity);
        var materials=new SimMaterialPlan(1,accepted.Version,accepted.Candidate.Id,rows,Actor.Name,Actor.AtUtc,[snapshot],0);
        var laborTotals=new SimLaborTotals(0,50,50,50m/60,50,150,3);
        var laborSnapshot=new SimLaborSnapshot(1,manufacturing.Id,quantity,[],60,0,laborTotals,Actor.Name,Actor.AtUtc,ManufacturingLead:new(2,"DAYS"));
        var labor=new SimLaborPlan(1,manufacturing.Id,quantity,"QA",[],60,0,Actor.Name,Actor.AtUtc,[laborSnapshot],ManufacturingLead:new(2,"DAYS"));
        var lanes=new SimRfqLanes(new("COMPLETE",Actor.Name,Actor.AtUtc),new("COMPLETE",Actor.Name,Actor.AtUtc),materials,labor);
        await File.WriteAllTextAsync(Path.Combine(Root,"data","rfq-lanes.json"),JsonSerializer.Serialize(new Dictionary<string,SimRfqLanes>{{id,lanes}},Json));
        return(id,lanes);
    }
}
