using System.Text.Json;
internal static class PackageIdentityChecks
{
    internal static void Run()
    {
        var json=DleAnalysisContract.Json;
        var record=JsonSerializer.Deserialize<SimRfqIntakeRecord>("""{"intakeId":"TEST","technicalFiles":[{"documentId":"pdf","name":"drawing.pdf","initialIdentification":{"type":"DRAWING_AND_BOM"}}]}""",json)!;
        var persona=new SimPersona("fixture","fixture","Fixture Reviewer","ACTIVE",[],[],true,"test");
        var doc=new SimPackageDocument("pdf","drawing.pdf","ASSEMBLY_DRAWING","UNRESOLVED","PARENT_ASSEMBLY",null,true,new("DRAWING_AND_BOM",null,"forged","forged"));
        doc=doc with {PartNumberReview=new("MANUFACTURER",false)};
        var original=JsonSerializer.Serialize(record.TechnicalFiles,json);
        var pack=SimTechnicalPackageProvider.Validate(record,new([doc],null),persona);
        if(pack.Documents[0].IdentityReview is not {Decision:"CONFIRMED",ReviewedBy:"Fixture Reviewer",ReviewedAtUtc:not null})throw new Exception("Identity confirmation audit failed");
        var corrected=SimTechnicalPackageProvider.Validate(record,new([doc with {DocumentType="SUPPORTING_DOCUMENT",EmbeddedBom=false,PartNumberReview=new(null,true),IdentityReview=new("OTHER","Supporting note")}],null),persona);
        if(corrected.Documents[0].IdentityReview is not {Decision:"CORRECTED",OtherDescription:"Supporting note"})throw new Exception("Correction traceability failed");
        var restored=JsonSerializer.Deserialize<SimTechnicalPackage>(JsonSerializer.Serialize(corrected,json),json)!;
        if(restored.Documents[0].IdentityReview!=corrected.Documents[0].IdentityReview||JsonSerializer.Serialize(record.TechnicalFiles,json)!=original)throw new Exception("Persistence/source preservation failed");
        try{SimTechnicalPackageProvider.Validate(record,new([doc with {IdentityReview=new("BOM_ONLY")}],null),persona);throw new Exception("Invalid identity accepted");}catch(SimRfqIntakeProblem){}
        var legacy=SimTechnicalPackageProvider.Validate(record,new([doc with {IdentityReview=null,PartNumberReview=null}],null),persona);
        if(JsonSerializer.Serialize(legacy,json).Contains("identityReview"))throw new Exception("Legacy serialization changed");
        foreach(var basis in new string?[]{null,"CUSTOMER_INTERNAL","MIXED","UNKNOWN"}) {
            try {SimTechnicalPackageProvider.Validate(record,new([doc with {PartNumberReview=new(basis,false)}],null),persona);throw new Exception("Missing/unknown/source gate bypassed");}catch(SimRfqIntakeProblem){}
        }
        var mixed=SimTechnicalPackageProvider.Validate(record,new([doc with {PartNumberReview=new("MIXED",true)}],null),persona);
        if(mixed.Documents[0].PartNumberReview is not {ReviewedBy:"Fixture Reviewer",ProvidesManufacturerPartNumbers:true})throw new Exception("Source audit missing");
        var source=new SimPackageDocument("support","support.txt","SUPPORTING_DOCUMENT","SUPPORTING","SUPPORTING_REFERENCE",null,false,new("OTHER"),new(null,true));
        SimTechnicalPackageProvider.RequirePartNumberReview([doc with {PartNumberReview=new("CUSTOMER_INTERNAL",false)},source]);
        Console.WriteLine("PASS: package identity confirmation/correction, trusted audit, serialization, legacy compatibility and Intake preservation");
    }
}
