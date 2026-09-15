using System.IO.Compression;
using System.Security;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class EnrichmentChecks
{
    private static byte[] Workbook()
    {
        using var bytes = new MemoryStream();
        using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, true)) {
            void Add(string name, string text) { using var w = new StreamWriter(zip.CreateEntry(name).Open()); w.Write(text); }
            Add("[Content_Types].xml", "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>");
            Add("_rels/.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"r1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
            Add("xl/workbook.xml", "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Synthetic\" sheetId=\"1\" r:id=\"r1\"/></sheets></workbook>");
            Add("xl/_rels/workbook.xml.rels", "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"r1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>");
            string[][] rows = [ ["Bom No","Customer P/N","Line","Quantity","Description","Manufacturer","Manufacturer Part Number","Alt1 Manufacturer Part Number"],
                ["DEMO-ASSEMBLY","DEMO-PART-1","1","1","Synthetic resistor 1","TestCo","MFG-001","OTHER-001"],
                ["FOREIGN-ASSEMBLY","DEMO-PART-2","2","2","Synthetic resistor 2","TestCo","WRONG-ASSEMBLY", ""],
                ["DEMO-ASSEMBLY","DEMO-PART-3","3","3","Synthetic resistor 3","TestCo","MFG-003", ""],
                ["DEMO-ASSEMBLY","DEMO-PART-3","100","9","Different placement","TestCo","WRONG-LINE", ""],
                ["DEMO-ASSEMBLY","DEMO-PART-4","4","4","Synthetic resistor 4","TestCo","", ""],
                ["DEMO-ASSEMBLY","DEMO-PART-5","5","9","Conflict retained","TestCo","MFG-005", ""],
                ["DEMO-ASSEMBLY","DEMO-PART-6","6","6","Synthetic resistor 6","TestCo","MFG-006", ""] ];
            Add("xl/worksheets/sheet1.xml", "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><dimension ref=\"A1:H8\"/><sheetData>" + string.Concat(rows.Select((r,i) => "<row r=\""+(i+1)+"\">"+string.Concat(r.Select((v,c)=>"<c r=\""+(char)('A'+c)+(i+1)+"\" t=\"inlineStr\"><is><t>"+SecurityElement.Escape(v)+"</t></is></c>"))+"</row>"))+"</sheetData></worksheet>");
        }
        return bytes.ToArray();
    }
    internal static async Task Run(string root, string dataPath, SimPersona persona)
    {
        var original = await File.ReadAllTextAsync(dataPath);
        var json = DleAnalysisContract.Json;
        var record = JsonNode.Parse(original)!["records"]![0]!.Deserialize<SimRfqIntakeRecord>(json)!;
        var store = new SimRfqIntakeStore(root);
        void Check(bool value, string name) { if (!value) throw new Exception(name); Console.WriteLine("PASS: enrichment — " + name); }
        SimCandidateBom Current() => JsonNode.Parse(File.ReadAllText(dataPath))!["records"]![0]!["technicalReview"]!["candidateBom"]!.Deserialize<SimCandidateBom>(json)!;
        try {
            var xlsx = await new SimIntakeDocuments(root).Stage(record.RequestCorrelationId,"synthetic-enrichment.xlsx",0,new MemoryStream(Workbook()),persona.DisplayName);
            var pack = record.TechnicalReview!.TechnicalPackage!;
            pack = pack with { Documents = [pack.Documents[0], new(xlsx.DocumentId!,xlsx.Name,"BOM","REFERENCED","PARENT_ASSEMBLY",null,
                IdentityReview:new("BOM_ONLY",Decision:"CONFIRMED"),PartNumberReview:new("CUSTOMER_INTERNAL",true))] };
            record = record with { TechnicalFiles = [record.TechnicalFiles[0], xlsx], TechnicalReview = record.TechnicalReview with { TechnicalPackage = pack } };
            await File.WriteAllTextAsync(dataPath, JsonSerializer.Serialize(new {schema="DLE_RFQ_INTAKE_DATASET_V1",records=new[]{record}},json));
            var job = await store.SubmitAnalysis(record.IntakeId,persona);
            Check(job.Input.ResultVersion == DleAnalysisContract.EnrichedResultVersion && job.Input.PilotRowLimit==1000 && job.Input.ProviderRoute==DleAnalysisPolicy.Local,"versioned enrichment stays local and removes ten-row ceiling");
            var claimed=(await store.ClaimAnalysisJob())!.Value;
            var result=await new LocalDocumentAnalysisProvider().ExecuteAnalysisJob(job.Input,claimed.Documents,DleAnalysisContract.InstructionsFor(job.Input.InstructionVersion),default);
            Check(result.Result.Rows.Length==6 && result.Result.Rows.Sum(r=>r.ManufacturerProposals!.Length)==5,"governing rows preserved, five proposals from four rows");
            Check(result.Result.Rows[0].ManufacturerProposals!.Length==2 && result.Result.Rows[1].ManufacturerProposals!.Length==0 && result.Result.Rows[2].ManufacturerProposals!.Single().PartNumber=="MFG-003","multiple, unmatched, foreign assembly and duplicate-customer line disambiguation");
            Check(result.Result.Rows[4].ManufacturerProposals![0].Conflicts.Length>0 && result.Result.Rows[4].Fields["quantity"].Value=="5","quantity conflict never overwrites governing value");
            Check(result.Result.Rows[0].ManufacturerProposals![0].Evidence is {Sheet:"Synthetic",Location:"G2"},"cell evidence retained");
            var bad = result.Result with { Rows = result.Result.Rows.Select((r,i)=>i==0?r with {ManufacturerProposals=[r.ManufacturerProposals![0] with {Evidence=new("FOREIGN",null,"Synthetic","G2") }]}:r).ToArray() };
            try { DleAnalysisContract.Validate(job.Input,bad);throw new Exception("Foreign evidence allowed"); } catch(InvalidDataException){Check(true,"foreign source evidence rejected");}
            await store.SetAnalysisState(job.Input.JobId,"VALIDATING"); await store.PublishAnalysis(job.Input.JobId,result);
            var before=JsonSerializer.Serialize(Current().Rows.Select(r=>r.Values),json);
            var bom=Current();var first=bom.Rows[0].ManufacturerIdentity!;
            var beforeWhole=await File.ReadAllTextAsync(dataPath);
            var firstRow=bom.Rows[0];
            Check(firstRow.ReviewState.CanApprove && !firstRow.ReviewState.Reviewed,"normal governing text and pending identities are eligible for whole-row review");
            await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,WholeRowApproval:new(firstRow.ReviewState.Token)));
            var whole=Current().Rows[0];
            Check(whole.Confirmed && whole.ReviewState.Reviewed && !whole.ReviewState.CanApprove && whole.ManufacturerIdentity!.State=="CONFIRMED" && whole.WholeRowHistory!.Length==1 && whole.Reviewer==persona.DisplayName,
                "whole-row approval satisfies governing and all identity review atomically");
            Check(JsonSerializer.Serialize(whole.Values,json)==JsonSerializer.Serialize(firstRow.Values,json) && JsonSerializer.Serialize(whole.Extracted,json)==JsonSerializer.Serialize(firstRow.Extracted,json) && whole.Alternates==firstRow.Alternates,"whole-row review never changes values or creates approved substitutions");
            var wholeReload=JsonSerializer.SerializeToNode(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(record.IntakeId),json)!;
            Check(wholeReload["record"]!["technicalReview"]!["candidateBom"]!["rows"]![0]!["reviewState"]!["reviewed"]!.GetValue<bool>(),"whole-row audit and reviewed state survive persistence/reopen");
            try { await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,WholeRowApproval:new(firstRow.ReviewState.Token)));throw new Exception("Stale whole-row allowed"); } catch(SimRfqIntakeProblem e) when(e.Code=="SIM_ROW_APPROVAL_STALE"){Check(true,"whole-row token blocks replay and concurrent changes");}
            try { await store.CompleteBomReview(record.IntakeId,new(Current()),persona);throw new Exception("Unresolved rows accepted"); } catch(SimRfqIntakeProblem e) when(e.Code=="SIM_BOM_UNRESOLVED"){Check(!e.Message.Contains("Row 1:"),"completion guard excludes properly whole-row-approved line");}
            void Blocked(SimCandidateRow testRow,string label) {
                var testBom=bom with {Rows=[testRow]};
                Check(!testRow.ReviewState.CanApprove,label+" hides quick approval");
                try {SimCandidateBomProvider.Review(testBom,new(bom.Id,0,null,WholeRowApproval:new(testRow.ReviewState.Token)),persona);throw new Exception("Unsafe approval allowed");}
                catch(SimRfqIntakeProblem e) when(e.Code=="SIM_ROW_APPROVAL_BLOCKED"){Check(true,label+" blocked by backend");}
            }
            Blocked(firstRow with {Values=new(firstRow.Values){["quantity"]=""}},"missing required quantity");
            Blocked(firstRow with {Comparison=new(firstRow.Comparison){["quantity"]="CONFLICT"}},"governing conflict");
            Blocked(firstRow with {AnalysisFields=new(firstRow.AnalysisFields!){["quantity"]=firstRow.AnalysisFields!["quantity"] with {Uncertainty="Unreadable quantity; correct source value"}}},"specific uncertainty");
            Blocked(firstRow with {ManufacturerIdentity=first with {Stale=true}},"stale identity");
            Blocked(firstRow with {ManufacturerIdentity=first with {Proposals=[]}},"unresolved identity");
            var exceptionAlternate=new SimCandidateAlternate("exception",null,"ALT","MANUAL","NEEDS_REVIEW","Needs explicit decision",null,null,null,null,[]);
            Blocked(firstRow with {Alternates=[exceptionAlternate]},"individual alternate exception");
            var withApprovedAlternate=firstRow with {Alternates=[exceptionAlternate with {ReviewStatus="CONFIRMED"}]};
            var dleIdentity=exceptionAlternate with {PartNumber="DLE-SUB Rev -",ReviewStatus="CONFIRMED",History=[new("EDITED","DLE-SUB Rev -","DLE-SUB Rev -","CONFIRMED",persona.DisplayName,DateTimeOffset.UtcNow)]};
            var subassembly=firstRow with {Confirmed=true,ComponentType="SUBASSEMBLY",Alternates=[dleIdentity],ManufacturerIdentity=first with {Stale=true,Proposals=[]}};
            Check(subassembly.ReviewState.Reviewed && !subassembly.ReviewState.CanApprove,"confirmed subassembly identity satisfies reviewed row despite stale empty manufacturer identity");
            Check((subassembly with {ManufacturerIdentity=null}).ReviewState.Reviewed,"confirmed subassembly identity works without manufacturer proposals");
            var reopenedSub=JsonSerializer.Deserialize<SimCandidateRow>(JsonSerializer.Serialize(subassembly,json),json)!;
            Check(reopenedSub.ReviewState.Reviewed && reopenedSub.Values["partNumber"]==firstRow.Values["partNumber"] && reopenedSub.Alternates![0].PartNumber=="DLE-SUB Rev -" && reopenedSub.ManufacturerIdentity!.Stale,"subassembly reopen preserves separate identities and stale evidence");
            foreach(var rejectedSub in new[]{subassembly with {ComponentType="STANDARD_COTS"},subassembly with {Alternates=[]},subassembly with {Alternates=[dleIdentity with {History=[]}]},subassembly with {Alternates=[dleIdentity with {Origin="EXTRACTED"}]},subassembly with {Alternates=[dleIdentity with {ReviewStatus="NEEDS_REVIEW"}]},subassembly with {Alternates=[dleIdentity with {RemovedAtUtc=DateTimeOffset.UtcNow}]},subassembly with {Values=new(subassembly.Values){["quantity"]="0"}},subassembly with {Confirmed=false,Comparison=new(subassembly.Comparison){["quantity"]="CONFLICT"}},subassembly with {Alternates=[dleIdentity,exceptionAlternate]}})
                Check(!rejectedSub.ReviewState.Reviewed,"subassembly exception retains type, confirmation, governing and alternate guards");
            var approvedAlternateBom=SimCandidateBomProvider.Review(bom with {Rows=[withApprovedAlternate]},new(bom.Id,0,null,WholeRowApproval:new(withApprovedAlternate.ReviewState.Token)),persona);
            Check(approvedAlternateBom.Rows[0].Alternates![0]==withApprovedAlternate.Alternates![0],"whole-row review preserves previously reviewed alternate unchanged");
            var subDataset=JsonNode.Parse(beforeWhole)!;
            var subRecord=subDataset["records"]!.AsArray().Single(n=>n!["intakeId"]!.GetValue<string>()==record.IntakeId)!;
            var subBom=bom with {Rows=[subassembly]};
            subRecord["technicalReview"]!["candidateBom"]=JsonSerializer.SerializeToNode(subBom,json);
            await File.WriteAllTextAsync(dataPath,subDataset.ToJsonString(json));
            await store.CompleteBomReview(record.IntakeId,new(subBom),persona);
            var subAccepted=JsonSerializer.SerializeToNode(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(record.IntakeId),json)!;
            Check(subAccepted["record"]!["technicalReview"]!["materialsReviewStatus"]!.GetValue<string>()=="QUALIFIED","confirmed DLE subassembly passes Complete BOM Review and store reopen");
            await File.WriteAllTextAsync(dataPath,beforeWhole);
            var beforeBulk=await File.ReadAllTextAsync(dataPath);
            await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,ManufacturerChange:new("","CONFIRMED",0,true)));
            var bulkReopened=JsonSerializer.SerializeToNode(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(record.IntakeId),json)!;
            var bulkIdentity=bulkReopened["record"]!["technicalReview"]!["candidateBom"]!.Deserialize<SimCandidateBom>(json)!.Rows[0].ManufacturerIdentity!;
            Check(bulkIdentity.History.Length==2 && bulkIdentity.History.All(h=>h.Decision=="CONFIRMED" && h.Reviewer==persona.DisplayName) && bulkIdentity.Revision==1 &&
                JsonSerializer.Serialize(bulkIdentity.Proposals,json)==JsonSerializer.Serialize(first.Proposals,json),"multi-identity row approval persists every decision and all evidence across store restart");
            var afterBulk=await File.ReadAllTextAsync(dataPath);
            try { await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,ManufacturerChange:new("","CONFIRMED",0,true)));throw new Exception("Stale row approval allowed"); } catch(SimRfqIntakeProblem e) when(e.Code=="SIM_MFG_REVIEW_STALE"){Check(await File.ReadAllTextAsync(dataPath)==afterBulk,"stale atomic approval changes nothing");}
            await File.WriteAllTextAsync(dataPath,beforeBulk); // Isolated fixture only: exercise individual review independently.
            await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,ManufacturerChange:new(first.Proposals[0].Id,"CONFIRMED",0)));
            var approved=Current().Rows[0].ManufacturerIdentity!;
            Check(approved.State=="PROPOSED" && approved.Decision(first.Proposals[1].Id)=="PROPOSED" &&
                JsonSerializer.Serialize(approved.Proposals,json)==JsonSerializer.Serialize(first.Proposals,json),"partial confirmation remains pending while all proposals and evidence remain intact");
            var reopened=JsonSerializer.SerializeToNode(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(record.IntakeId),json)!;
            var persisted=reopened["record"]!["technicalReview"]!["candidateBom"]!.Deserialize<SimCandidateBom>(json)!.Rows[0].ManufacturerIdentity!;
            Check(persisted.State=="PROPOSED" && persisted.History.Single().Reviewer==persona.DisplayName && persisted.History.Single().AtUtc!=default && persisted.Revision==1,"partial confirmation survives store restart with reviewer timestamp and revision");
            var atomic=SimCandidateBomProvider.Review(bom,new(bom.Id,0,null,ManufacturerChange:new("","CONFIRMED",0,true)),persona).Rows[0].ManufacturerIdentity!;
            Check(atomic.State=="CONFIRMED" && atomic.Revision==1 && atomic.History.Length==2 && atomic.History.Select(h=>h.AtUtc).Distinct().Count()==1 && atomic.Proposals.All(p=>atomic.Decision(p.Id)=="CONFIRMED"),"row approval confirms all pending proposals atomically at one revision and timestamp");
            var partial=Current();
            var rest=SimCandidateBomProvider.Review(partial,new(partial.Id,0,null,ManufacturerChange:new("","CONFIRMED",1,true)),persona).Rows[0].ManufacturerIdentity!;
            Check(rest.State=="CONFIRMED" && rest.History.Length==2 && rest.History[0]==persisted.History[0],"row approval preserves prior confirmation and only confirms pending remainder");
            try { await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,ManufacturerChange:new(first.Proposals[1].Id,"REJECTED",0)));throw new Exception("Stale review allowed"); } catch(SimRfqIntakeProblem e) when(e.Code=="SIM_MFG_REVIEW_STALE"){Check(true,"concurrent review blocked");}
            await store.CandidateBomAsync(record.IntakeId,persona,new(bom.Id,0,null,ManufacturerChange:new(first.Proposals[1].Id,"REJECTED",1)));
            Check(Current().Rows[0].ManufacturerIdentity is {State:"CONFIRMED",Revision:2} && JsonSerializer.Serialize(Current().Rows.Select(r=>r.Values),json)==before,"confirm/reject audit preserves customer identities");
            try { SimCandidateBomProvider.Review(Current(),new(bom.Id,0,null,ManufacturerChange:new("","CONFIRMED",2,true)),persona);throw new Exception("Rejected proposal reapproved"); } catch(SimRfqIntakeProblem e) when(e.Code=="SIM_MFG_REVIEW_INVALID"){Check(true,"quick approval does not resurrect rejected or duplicate confirmed proposals");}
            var copy=JsonSerializer.Deserialize<SimCandidateBom>(JsonSerializer.Serialize(Current(),json),json)!;
            var edit=new Dictionary<string,string>(copy.Rows[0].Values){["partNumber"]="CORRECTED"};
            Check(SimCandidateBomProvider.Review(copy,new(copy.Id,0,edit),persona).Rows[0].ManufacturerIdentity!.Stale,"governing correction invalidates mapping confirmation");
            try { await store.CompleteBomReview(record.IntakeId,new(Current()),persona);throw new Exception("Unreviewed accepted"); } catch(SimRfqIntakeProblem e) when(e.Code=="SIM_BOM_UNRESOLVED"){Check(true,"acceptance blocks unreviewed proposals");}
            foreach(var row in Current().Rows) {
                if(row.ReviewState.CanApprove) {
                    var liveWhole=Current();await store.CandidateBomAsync(record.IntakeId,persona,new(liveWhole.Id,row.Index,null,WholeRowApproval:new(liveWhole.Rows[row.Index].ReviewState.Token)));continue;
                }
                if(row.ManufacturerIdentity!.Proposals.Any(p=>row.ManufacturerIdentity.Decision(p.Id)=="PROPOSED")) {
                    var live=Current();await store.CandidateBomAsync(record.IntakeId,persona,new(live.Id,row.Index,null,ManufacturerChange:new("","CONFIRMED",live.Rows[row.Index].ManufacturerIdentity!.Revision,true)));
                }
                var liveRow=Current();await store.CandidateBomAsync(record.IntakeId,persona,new(liveRow.Id,row.Index,liveRow.Rows[row.Index].Values));
            }
            await store.CompleteBomReview(record.IntakeId,new(Current()),persona);
            var saved = JsonSerializer.SerializeToNode(await new SimRfqIntakeStore(root).ReadTechnicalReviewAsync(record.IntakeId),json)!;
            var accepted=saved["record"]!["technicalReview"]!["bomAcceptances"]![0]!["candidate"]!.Deserialize<SimCandidateBom>(json)!;
            Check(accepted.Rows[0].ManufacturerIdentity!.History.Length==2 && accepted.Rows[0].Alternates is null && JsonSerializer.Serialize(accepted.Rows.Select(r=>r.Values),json)==before,"accepted snapshot retains identities/evidence/review on restart without creating alternates");
            Check(accepted.Rows[0].WholeRowHistory!.Length==1 && accepted.Rows.All(r=>r.ReviewState.Reviewed),"immutable accepted snapshot retains whole-row audit after real exceptions are resolved");
        } finally { await File.WriteAllTextAsync(dataPath, original); }
    }
}
