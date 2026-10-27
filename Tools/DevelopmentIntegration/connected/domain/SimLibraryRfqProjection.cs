using System.Globalization;
using System.Text.Json;

// Read projection of an approved immutable Library version. Never writes an Intake
// record, changes a source identity, or manufactures a production release.
internal sealed partial class SimRfqIntakeStore
{
    internal static bool LibraryOptionalZero(SimCandidateRow row) =>
        row.SourcePositionKind=="LIBRARY_APPROVED" && row.Extracted.GetValueOrDefault("libraryOptionalNob")=="true" &&
        row.RowId?.StartsWith("vpro-",StringComparison.Ordinal)==true && row.Values.GetValueOrDefault("lineNumber")=="NOB" &&
        decimal.TryParse(row.Values.GetValueOrDefault("quantity"),NumberStyles.AllowDecimalPoint,CultureInfo.InvariantCulture,out var q) && q==0;

    private static void RequireCustomerQuoteDeliveryAvailable(SimRfqIntakeRecord record)
    {
        if(record.LibraryRfq is not null)throw SimRfqIntakeProblem.Conflict("RFQ_PROJECT_QUOTE_PENDING",
            "Customer quote composition is the next step. Materials and Labor can be completed independently; this project cannot issue a customer quote or become an order yet.");
    }
    private static void RequireRequestedRfqDepartment(SimRfqIntakeRecord record,string department)
    {
        if(record.LibraryRfq is not null && (department=="materials"&&record.DeLeonScope=="LABOR_ONLY" || department=="labor"&&record.DeLeonScope=="MATERIAL_ONLY"))
            throw SimRfqIntakeProblem.Conflict("RFQ_SCOPE",(department=="materials"?"Materials":"Labor")+" estimating was not requested for this project.");
    }

    private static string LibraryRfqMime(string name)=>Path.GetExtension(name).ToLowerInvariant() switch {
        ".pdf"=>"application/pdf",".xls"=>"application/vnd.ms-excel",".xlsx"=>"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".txt"=>"text/plain",".png"=>"image/png",".jpg" or ".jpeg"=>"image/jpeg",_=>"application/octet-stream"};

    private async Task<(SimRfqIntakeDocument Document,byte[] Bytes)> OpenRfqLaborDocument(SimRfqIntakeRecord record,string documentId)
    {
        if(record.LibraryRfq is null)return await OpenDocument(record.IntakeId,documentId);
        var file=await ReadRfqProjectFile(record.IntakeId,documentId,"labor");
        var document=record.TechnicalFiles.Single(d=>d.DocumentId==documentId);
        return(document with{Name=file.Name,Type=file.Type,Size=file.Bytes.Length},file.Bytes);
    }

    internal static SimRfqIntakeRecord BuildLibraryRfqRecord(SimLibraryRfqReceipt receipt,LibraryPackageVersion package,string environment="SIM")
    {
        var binding=receipt.Binding;
        if(package.Id!=binding.PackageId || package.Version!=binding.PackageVersion || package.ContentHash!=binding.PackageHash ||
            package.Status!="APPROVED" || package.ReviewedBy is null || package.Bom.Id!=binding.BomId || package.Bom.InternalVersion!=binding.BomVersion)
            throw SimRfqIntakeProblem.Conflict("RFQ_PROJECT_SOURCE","The approved package no longer matches this RFQ receipt.");
        var reviewer=package.ReviewedBy;
        var governing=package.Documents.SingleOrDefault(d=>d.Identification.Id==binding.GoverningDocumentId);
        if(receipt.Scope!="MATERIAL_ONLY" && (governing is null || governing.Identification.Use is not ("PRODUCTION" or "BOTH") || !governing.Identification.Purposes.Contains("DRAWING")))
            throw SimRfqIntakeProblem.Conflict("RFQ_PROJECT_DRAWING","Choose the production drawing from this approved package before opening Labor.");
        var docs=package.Documents.Select(d=>new SimPackageDocument(d.Identification.Id,Path.GetFileName(d.Identification.Source.RelativePath),
            d.Identification.Purposes.Contains("DRAWING")?"ASSEMBLY_DRAWING":d.Identification.Purposes.Contains("BOM_SOURCE")?"CUSTOMER_BOM":"TECHNICAL_DOCUMENT",
            d.Identification.Id==binding.GoverningDocumentId?"GOVERNING":"SUPPORTING","ASSEMBLY",null,
            ProductionUse:d.Identification.Use is "PRODUCTION" or "BOTH"?"INCLUDED":null,
            BomUse:d.Identification.Use is "MATERIALS" or "BOTH"?"SUPPORTING":null)).ToArray();
        var technicalPackage=new SimTechnicalPackage(docs,null,"APPROVED_LIBRARY_PACKAGE",false,reviewer.Name,reviewer.AtUtc,"LIBRARY_BOM");
        var rows=package.Bom.Rows.Select((row,index)=>LibraryRfqRow(row,index,package)).ToArray();
        var candidate=new SimCandidateBom(package.Id+"/bom/"+package.Bom.Id,"DLE-OS BOM",binding.GoverningDocumentId,package.ContentHash,
            1,"APPROVED_LIBRARY_PACKAGE",false,reviewer.AtUtc,reviewer.Name,docs.Select(d=>d.DocumentId).ToArray(),
            "Exact approved Library BOM; supporting files are separately identified.",rows);
        var materials=new SimBomAcceptance(binding.BomVersion,candidate,technicalPackage,reviewer.Name,reviewer.AtUtc);
        var production=package.Documents.Where(d=>d.Identification.Use is "PRODUCTION" or "BOTH").Select(d=>d.Identification.Id).ToArray();
        var definition=new SimManufacturingDefinition(package.Id+"/"+package.ContentHash,binding.GoverningDocumentId,
            production.Where(id=>id!=binding.GoverningDocumentId).ToArray(),[],docs.Select(d=>d.DocumentId).ToArray(),technicalPackage,
            false,reviewer.Name,reviewer.AtUtc,"RFQ_PREPARATION","APPROVED_LIBRARY_PACKAGE",binding.GoverningDocumentId);
        var inputs=new SimQuotationInputs("READY","QUOTATION_MATERIALS",materials,"QUOTATION_LABOR",definition,reviewer.Name,reviewer.AtUtc);
        var workflow=new SimReviewWorkflow(PackageConfirmed:true,Sufficient:true,Manufacturing:definition,Outputs:inputs,ManufacturingDrawingId:binding.GoverningDocumentId);
        var review=new SimTechnicalReviewResult("LIBRARY_PACKAGE_FINAL","",docs.SingleOrDefault(d=>d.DocumentId==binding.GoverningDocumentId)?.Name??"",
            "DLE-OS BOM",false,[],[],"PER_BOM",[],true,"APPROVED","APPROVED","RFQS","RECEIVED",reviewer.Name,reviewer.AtUtc,"",
            TechnicalPackage:technicalPackage,CandidateBom:candidate,CandidateBomVersions:[candidate],BomAcceptances:[materials],
            MaterialsReviewStatus:"APPROVED",ManufacturingReviewStatus:"APPROVED_FOR_QUOTE",Workflow:workflow);
        var files=package.Documents.Select(d=>new SimRfqIntakeDocument(Path.GetFileName(d.Identification.Source.RelativePath),d.Identification.Source.Size,
            LibraryRfqMime(d.Identification.Source.RelativePath),d.Identification.Source.LastWriteUtc.ToUnixTimeMilliseconds(),d.Identification.Id,
            "FROZEN_LIBRARY_PACKAGE",$"library-package:{package.Id}/{d.Identification.Id}",package.SubmittedBy.AtUtc)).ToArray();
        return new(binding.DisplayId,receipt.RequestCorrelationId,"LIBRARY_RFQ_PROJECT_V1","RFQS","READY_FOR_RFQ_WORKING_QUEUE","NEW_QUOTE_REQUEST",
            receipt.Customer,1,[receipt.Assembly],receipt.Scope,files.Length>0,files,"FROZEN_LIBRARY_PACKAGE",receipt.CustomerRequirements,
            receipt.CreatedBy,receipt.CreatedAtUtc,receipt.ScenarioId,receipt.Generation,environment,TechnicalReview:review,LibraryRfq:binding);
    }

    private static SimCandidateRow LibraryRfqRow(LibraryBomRow row,int index,LibraryPackageVersion package)
    {
        var actor=package.ReviewedBy!;var numbers=SimLibraryBomStore.PartNumbers(row);
        var extracted=row.Source is null?new Dictionary<string,string>():new Dictionary<string,string>(row.Source.Extracted);
        extracted["libraryRowId"]=row.Id;extracted["librarySourcePartNumber"]=row.SourcePartNumber;
        extracted["libraryCustomerPartNumbers"]=JsonSerializer.Serialize(numbers.CustomerPartNumbers);
        extracted["libraryAlternates"]=JsonSerializer.Serialize(row.Alternates);
        extracted["libraryPackageId"]=package.Id;extracted["libraryPackageHash"]=package.ContentHash;
        extracted["libraryOptionalNob"]=SimLibraryBomStore.OptionalNob(row)?"true":"false";
        // Keep literal source fields and factor provenance unchanged; reviewed values live separately.
        if(!extracted.ContainsKey("lineNumber"))extracted["lineNumber"]=row.Find;
        var values=new Dictionary<string,string>{{"lineNumber",row.Find},{"partNumber",row.SourcePartNumber},{"description",row.Description},
            {"quantity",row.Quantity},{"unit",row.Unit},{"designators",row.ReferenceDesignators},{"notes",row.Notes},
            {"customerPartNumber",string.Join("; ",numbers.CustomerPartNumbers)}};
        foreach(var field in SimCandidateBomProvider.Fields)values.TryAdd(field,"");
        var approved=row.Alternates.Where(a=>SimLibraryBomStore.ManufacturerEligible(row,a)).Select(a=>(Number:a.PartNumber,Name:a.Manufacturer)).ToList();
        if(row.IdentityConfirmed&&row.IdentityBasis=="MFG"&&!string.IsNullOrWhiteSpace(row.ManufacturerPartNumber))approved.Add((row.ManufacturerPartNumber,row.ManufacturerName));
        // Only a deliberately selected manufacturer becomes the quote default. Other
        // approved manufacturers remain choices, never customer references.
        var selected=numbers.ManufacturerPartNumber;
        var ordered=approved.Where(a=>!string.IsNullOrWhiteSpace(a.Number)).DistinctBy(a=>a.Number).OrderBy(a=>a.Number==selected?0:1).ToArray();
        var evidence=new DleAnalysisEvidence(package.Id,null,null,"Approved Library BOM row "+row.Id);
        var proposals=ordered.Select((a,i)=>new DleManufacturerProposal("library-mfg-"+i,a.Name,a.Number,evidence,evidence,evidence,
            "Approved Library package",["Explicit manufacturer classification"],[],new Dictionary<string,string>{{"libraryRowId",row.Id}},"HIGH","None")).ToArray();
        var manufacturer=new SimManufacturerIdentity(proposals,"None",proposals.Select(p=>new SimManufacturerDecision(p.Id,"CONFIRMED",actor.Name,actor.AtUtc)).ToArray());
        // A customer-number-only board remains a customer identity. This says nothing
        // about customer-supplied material responsibility.
        var customerBasis=string.IsNullOrEmpty(selected)&&row.IdentityConfirmed&&row.IdentityBasis=="CUSTOMER";
        var assemblyBasis=row.IdentityConfirmed&&row.IdentityBasis=="ASSEMBLY";
        var primary=new SimCandidatePrimaryIdentity(assemblyBasis?"ASSEMBLY_PN":customerBasis?"CUSTOMER_PN":"MANUFACTURER_PN",customerBasis?row.SourcePartNumber:null,
            customerBasis?row.SourcePartNumber:null,actor.Name,actor.AtUtc);
        extracted["librarySelectedManufacturer"]=selected??"";
        return new(index,extracted,values,[],values.Keys.ToDictionary(k=>k,_=>"MATCH"),true,actor.Name,actor.AtUtc,[],
            RowId:row.Source?.RowId??row.Id,AnalysisFields:row.Source?.Fields,Alternates:[],ComponentType:row.Dnp?"DNP":assemblyBasis?"SUBASSEMBLY":"STANDARD_COTS",
            ManufacturerIdentity:manufacturer,PrimaryIdentity:primary,SourcePositionKind:"LIBRARY_APPROVED",
            AssemblyIdentity:assemblyBasis?new SimAssemblyPartIdentity(row.SourcePartNumber,actor.Name,actor.AtUtc):null,
            CustomerIdentity:numbers.CustomerPartNumbers.Length==1?new SimCustomerIdentity(numbers.CustomerPartNumbers[0],
                [new(package.Id,package.ContentHash,"Approved Library row "+row.Id,numbers.CustomerPartNumbers[0])],actor.Name,actor.AtUtc):null);
    }
}
