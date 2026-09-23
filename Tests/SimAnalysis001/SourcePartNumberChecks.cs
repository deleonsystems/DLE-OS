using System.Text.Json;

internal static class SourcePartNumberChecks
{
    internal static void Run()
    {
        var persona = new SimPersona("fixture", "fixture", "Source P/N Reviewer", "ACTIVE", [], [], true, "test");
        void Check(bool yes, string text) { if (!yes) throw new Exception(text); Console.WriteLine("PASS: source P/N - " + text); }
        void Reject(Action action, string text) { try { action(); } catch (SimRfqIntakeProblem) { Check(true, text); return; } throw new Exception(text); }
        var fields = new Dictionary<string,string> { ["lineNumber"]="1", ["partNumber"]="SIM-R-1K", ["description"]="Resistor", ["quantity"]="2", ["designators"]="R1 R2" };
        var row = new SimCandidateRow(0, new(fields), new(fields), [], fields.ToDictionary(p=>p.Key,_=>"UNCERTAIN"), false, null, null, [],
            ManufacturerIdentity:new([],"Unresolved",[]));
        var pcb = row with {Index=1,Values=new(fields){["partNumber"]="SIM-PCB-001"},ComponentType="SUBASSEMBLY",Confirmed=true,
            AssemblyIdentity=new("SIM-PCB-001 REV A","Prior reviewer",DateTimeOffset.UtcNow)};
        var bom = new SimCandidateBom("test", "Test", "governing", "hash", 1, "test", true, DateTimeOffset.UtcNow, "fixture", [], "", [row,pcb]);
        string Serialize(object value) => JsonSerializer.Serialize(value,DleAnalysisContract.Json);
        SimCandidateBom Confirm(SimCandidateBom value, string basis, string document="MANUFACTURER") => SimCandidateBomProvider.Review(value,
            new(value.Id,0,null,SourcePartNumberChange:new(basis,value.Rows[0].ReviewState.Token)),persona,document);
        SimCandidateBom Accept(SimCandidateBom value, string? manual=null) => SimCandidateBomProvider.Review(value,
            new(value.Id,0,new(value.Rows[0].Values),WorksheetAcceptance:new(value.Rows[0].ReviewState.Token,value.Rows[0].ComponentType,ManualPartNumber:manual)),persona);
        Check(SimCandidateBomProvider.SourceBasisDefault("MANUFACTURER")=="MFG"&&SimCandidateBomProvider.SourceBasisDefault("CUSTOMER_INTERNAL")=="CUSTOMER"&&
            SimCandidateBomProvider.SourceBasisDefault("MIXED")=="UNRESOLVED"&&SimCandidateBomProvider.SourceBasisDefault("UNKNOWN")=="UNRESOLVED", "document basis defaults");
        var before=Serialize(bom);
        var confirmed=Confirm(bom,"MFG");var r=confirmed.Rows[0];var decision=r.SourcePartNumberReview!.Current;
        Check(Serialize(bom)==before,"input and legacy PCB untouched");
        Check(Serialize(confirmed.Rows[1])==Serialize(pcb),"accepted PCB bytes and identity retained");
        Check(!r.Confirmed&&!r.ReviewState.Reviewed&&r.Values["partNumber"]=="SIM-R-1K"&&r.ComponentType=="STANDARD_COTS","identity confirmation does not accept or edit source/type");
        Check(r.ManufacturerIdentity!.Proposals.Single().PartNumber=="SIM-R-1K"&&r.ManufacturerIdentity.Proposals.Single().ManufacturerName is null&&
            r.ManufacturerIdentity.State=="CONFIRMED","existing manufacturer identity resolved without inferred maker");
        Check(decision is {Basis:"MFG",GoverningDocumentId:"governing",GoverningSha256:"hash",Origin:"DOCUMENT_DEFAULT_CONFIRMED",Reviewer:"Source P/N Reviewer",Status:"CONFIRMED"}&&decision.AtUtc!=default&&
            decision.IdentityReference=="manufacturer:"+r.ManufacturerIdentity.Proposals.Single().Id&&r.SourcePartNumberReview.History.Length==1,"complete source audit and identity link");
        Check(r.ReviewState.Token!=row.ReviewState.Token,"source decision participates in concurrency token");
        Reject(()=>SimCandidateBomProvider.Review(confirmed,new(bom.Id,0,null,SourcePartNumberChange:new("CUSTOMER",row.ReviewState.Token)),persona),"stale confirmation rejected");
        Check(Accept(confirmed).Rows[0].ReviewState.Reviewed,"separate explicit Accept succeeds");
        Check(Confirm(confirmed,"MFG").Rows[0].ManufacturerIdentity!.Proposals.Length==1,"same-basis reconfirmation does not duplicate source identity");
        var matched=confirmed with {Rows=[r with {Comparison=fields.ToDictionary(p=>p.Key,_=>"MATCH")},pcb]};
        Check(!matched.Rows[0].ReviewState.Reviewed,"matched extraction still needs whole-row acceptance after identity confirmation");
        var overridden=Confirm(confirmed,"CUSTOMER");
        Check(overridden.Rows[0].IdentityBasis=="CUSTOMER_PN"&&overridden.Rows[0].PrimaryIdentity!.PartNumber=="SIM-R-1K"&&!overridden.Rows[0].Confirmed&&
            overridden.Rows[0].SourcePartNumberReview!.History.Length==3&&overridden.Rows[0].SourcePartNumberReview!.Current.Origin=="ROW_OVERRIDE","basis change invalidates prior approval and appends history");
        Check(Accept(overridden).Rows[0].ReviewState.Reviewed,"customer route explicit Accept");
        foreach(var type in new[]{"STANDARD_COTS","SUBASSEMBLY"}) foreach(var basis in new[]{"MFG","CUSTOMER","ASSEMBLY"}) {
            var fixture=bom with {Rows=[row with {ComponentType=type},pcb]};
            var reviewed=Confirm(fixture,basis);Check(reviewed.Rows[0].ComponentType==type&&!reviewed.Rows[0].Confirmed&&SimCandidateBomProvider.SourceIdentityMatches(reviewed.Rows[0]),type+" + "+basis+" independent identity");
            Check(Accept(reviewed).Rows[0].ReviewState.Reviewed,type+" + "+basis+" separate acceptance");
        }
        var unresolved=Confirm(confirmed,"UNRESOLVED");
        Check(!unresolved.Rows[0].Confirmed&&unresolved.Rows[0].ManufacturerIdentity!.State=="UNRESOLVED","unresolved revokes source approval");
        Reject(()=>Accept(unresolved),"unresolved cannot Accept");
        var edits=new Dictionary<string,string>(r.Values){["partNumber"]="CHANGED"};
        var changed=SimCandidateBomProvider.Review(confirmed,new(bom.Id,0,null,ProgressRows:[new(0,r.ReviewState.Token,edits,r.ComponentType)]),persona);
        Check(changed.Rows[0].SourcePartNumberReview!.Current.Status=="INVALIDATED"&&!changed.Rows[0].Confirmed&&!changed.Rows[0].ReviewState.Reviewed,"saved source edit invalidates identity and row");
        Reject(()=>Accept(changed),"changed source cannot reuse previous approval");
        Check(Confirm(changed,"MFG").Rows[0].ManufacturerIdentity!.Proposals.Last().PartNumber=="CHANGED","edited source can be explicitly reconfirmed");
        var other=r.ManufacturerIdentity.Proposals.Single() with {Id="enrichment",PartNumber="DIFFERENT",SourceLabel="Enrichment source"};
        var conflicted=bom with {Rows=[row with {ManufacturerIdentity=new([other],"",[])},pcb]};
        Reject(()=>Confirm(conflicted,"MFG"),"competing enrichment blocks source confirmation");
        Check(conflicted.Rows[0].ManufacturerIdentity!.Decision(other.Id)=="PROPOSED","conflict remains proposed, provenance retained");
        var rejected=SimCandidateBomProvider.Review(conflicted,new(bom.Id,0,null,ManufacturerChange:new(other.Id,"REJECTED",0)),persona);
        var resolved=Confirm(rejected,"MFG");
        Check(resolved.Rows[0].ManufacturerIdentity!.Proposals.Contains(other)&&resolved.Rows[0].ManufacturerIdentity!.Decision(other.Id)=="REJECTED","explicit conflict rejection preserved after confirmation");
        var pending=confirmed with {Rows=[r with {ManufacturerIdentity=r.ManufacturerIdentity with {Proposals=r.ManufacturerIdentity.Proposals.Append(other).ToArray()}},pcb]};
        Reject(()=>Accept(pending),"Accept cannot confirm pending competing proposals");
        Reject(()=>SimCandidateBomProvider.Review(pending,new(bom.Id,0,null,WholeRowApproval:new(pending.Rows[0].ReviewState.Token)),persona),"alternate whole-row endpoint cannot confirm competing proposals");
        var manual=Accept(confirmed,"MANUAL-OVERRIDE");
        Check(manual.Rows[0].ManufacturerIdentity!.Proposals.Any(p=>p.PartNumber=="MANUAL-OVERRIDE"&&p.SourceLabel=="Manual Technical Review entry")&&manual.Rows[0].ReviewState.Reviewed&&
            manual.Rows[0].SourcePartNumberReview!.Current.Status=="OVERRIDDEN","manual override retains explicit provenance and acceptance behavior");
        var pnEdit=SimCandidateBomProvider.Review(confirmed,new(bom.Id,0,null,ApprovedPartChange:new(r.ManufacturerIdentity.Proposals[0].Id,"EDITED",null,r.ReviewState.Token)),persona);
        Check(!pnEdit.Rows[0].Confirmed&&pnEdit.Rows[0].SourcePartNumberReview!.Current.Status=="OVERRIDDEN"&&pnEdit.Rows[0].ManufacturerIdentity!.State=="CONFIRMED","approved P/N manager invalidates source link without rejecting the explicit new identity");
        var sub=Confirm(bom with {Rows=[row with {ComponentType="SUBASSEMBLY"},pcb]},"CUSTOMER");
        var customerEdit=SimCandidateBomProvider.Review(sub,new(bom.Id,0,null,IdentityBasisChange:new("CUSTOMER_PN","CUSTOMER-OVERRIDE",sub.Rows[0].ReviewState.Token)),persona);
        Check(customerEdit.Rows[0].IdentityBasis=="CUSTOMER_PN"&&customerEdit.Rows[0].SourcePartNumberReview!.Current.Status=="OVERRIDDEN"&&Accept(customerEdit).Rows[0].ReviewState.Reviewed,"customer override on subassembly remains independent of Type");
        var assemblySource=Confirm(bom,"ASSEMBLY");
        var assemblyOverride=SimCandidateBomProvider.Review(assemblySource,new(bom.Id,0,new(row.Values),WorksheetAcceptance:new(assemblySource.Rows[0].ReviewState.Token,"STANDARD_COTS","SIM-R-1K REV A")),persona);
        Check(assemblyOverride.Rows[0].AssemblyIdentity!.PartNumber=="SIM-R-1K REV A"&&assemblyOverride.Rows[0].SourcePartNumberReview!.Current.Status=="OVERRIDDEN"&&assemblyOverride.Rows[0].ReviewState.Reviewed,"explicit assembly identity override is applied, not silently discarded");
        Reject(()=>Confirm(bom,"DLE"),"unsupported basis rejected");
        Reject(()=>Confirm(bom with {Rows=[row with {ComponentType="DNP"},pcb]},"MFG"),"DNP rejects identity confirmation");
        Check(Serialize(JsonSerializer.Deserialize<SimCandidateBom>(before,DleAnalysisContract.Json)!)==before,"older candidate JSON round trips without migration");
    }
}
