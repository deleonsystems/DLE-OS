using System.Text;using System.Text.Json;
var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);var actor=new SimPersona("test","test","Fixture Reviewer","ACTIVE",[],["technical_review.disposition"],false,"test");
void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+label);}
string Row(params string[] f)=>string.Join('\t',f);
var bytes=Encoding.ASCII.GetBytes(string.Join('\n',Row([..SimVproParser.Headers,"/ DRAW#=TEST REV A /"]),Row("001","INTERNAL-PN","Fixture","","1","1","EA","1","0","0","0","",""),Row("002","ALT-A","Fixture alternate A","","10",".0001","EA","1","0","0","0","",""),Row("003","ALT-B","Fixture alternate B","","10",".0001","EA","1","0","0","0","",""),Row("004","","(1)C1","","1","0","  ","0","0","0","0","","")));
var bom=SimVproParser.Parse(bytes,"txt","TEST","A","Fixture");var row=bom.Rows[0];var other=row with{Index=1,RowId="other",Alternates=[]};bom=bom with{Rows=[row,other]};var otherJson=JsonSerializer.Serialize(other,json);
SimCandidateBom Change(SimCandidateBom b,SimCandidateReviewRequest r)=>SimCandidateBomProvider.Review(b,r,actor);
void Reject(Func<SimCandidateBom> f,string name){try{f();throw new Exception(name+" allowed");}catch(SimRfqIntakeProblem){Check(true,name);}}
SimCandidateReviewRequest Select(SimCandidateBom b,string? id)=>new(b.Id,0,null,ApprovedAlternateSelection:new(id,b.Rows[0].ReviewState.Token));
Check(bom.Rows[0].ApprovedAlternates.Length==0,"proposed alternatives not eligible");Reject(()=>Change(bom,Select(bom,"vpro-002")),"cannot select unapproved alternate");
bom=Change(bom,new(bom.Id,0,null,AlternateChange:new("EDIT","vpro-002","ALT-A","CONFIRMED",0)));
Check(bom.Rows[0].ApprovedAlternates.Length==0,"reviewed-only CONFIRMED is not approval");
bom=Change(bom,new(bom.Id,0,null,AlternateChange:new("APPROVE","vpro-002","ALT-A",null,1)));
Check(bom.Rows[0].ApprovedAlternates.Single().PartNumber=="ALT-A"&&bom.Rows[0].SelectedApprovedAlternate is null&&!bom.Rows[0].ReviewState.Reviewed,"approve makes exact choice available without selection or row acceptance");
var stale=Select(bom,"vpro-002");bom=Change(bom,new(bom.Id,0,null,AlternateChange:new("EDIT","vpro-003","ALT-B","NOT_APPROVED",2)));
Reject(()=>Change(bom,stale),"concurrent row change rejects stale selection");
bom=Change(bom,Select(bom,"vpro-002"));row=bom.Rows[0];Check(row.ApprovedAlternateSelectionCurrent&&!row.Confirmed&&!row.ReviewState.Reviewed,"selection persists independently from row acceptance");Check(row.SelectedApprovedAlternate!.PartNumber=="ALT-A"&&string.IsNullOrEmpty(row.SelectedApprovedAlternate.ManufacturerName)&&row.SelectedApprovedAlternate.SourceSha256==bom.GoverningSha256&&row.Values["partNumber"]=="INTERNAL-PN","exact identity/hash retained with no guessed manufacturer or source overwrite");
var serialized=JsonSerializer.Serialize(bom,json);bom=JsonSerializer.Deserialize<SimCandidateBom>(serialized,json)!;Check(bom.Rows[0].ApprovedAlternateSelectionCurrent&&bom.Rows[0].SelectedApprovedAlternate!.AlternateId=="vpro-002","selection survives save/reopen");
var selected=bom;var r=selected.Rows[0];var fields=SimCandidateBomProvider.Fields.ToDictionary(k=>k,k=>r.Values[k]);
bom=Change(selected,new(selected.Id,0,fields,WorksheetAcceptance:new(r.ReviewState.Token,r.ComponentType)));
Check(bom.Rows[0].ReviewState.Reviewed&&SimApprovedPartIdentities.Resolve(bom.Rows[0]).Contains("ALT-A"),"explicit row Accept succeeds separately and retains selected approved identity");
var revoked=Change(bom,new(bom.Id,0,null,AlternateChange:new("EDIT","vpro-002","ALT-A","NOT_APPROVED",bom.Rows[0].AlternateRevision)));
Check(!revoked.Rows[0].ApprovedAlternateSelectionCurrent&&!revoked.Rows[0].ReviewState.Reviewed&&!revoked.Rows[0].ApprovedAlternates.Any(),"revocation removes eligibility and invalidates selected row acceptance");
Reject(()=>Change(revoked,new(revoked.Id,0,fields,WorksheetAcceptance:new(revoked.Rows[0].ReviewState.Token,r.ComponentType))),"revoked selected alternate cannot be accepted");
var edited=Change(bom,new(bom.Id,0,null,AlternateChange:new("APPROVE","vpro-002","ALT-CHANGED",null,bom.Rows[0].AlternateRevision)));
Check(!edited.Rows[0].ApprovedAlternateSelectionCurrent&&edited.Rows[0].SelectedApprovedAlternate!.PartNumber=="ALT-A","changed approved bytes require deliberate reselection; prior selection retained");
var staleSource=bom with{Rows=[bom.Rows[0] with{ManufacturerIdentity=bom.Rows[0].ManufacturerIdentity! with{Stale=true}},other]};Check(staleSource.Rows[0].ApprovedAlternates.Length==0&&!staleSource.Rows[0].ApprovedAlternateSelectionCurrent,"stale source identity hides eligible choices");
var cleared=Change(selected,Select(selected,null));Check(cleared.Rows[0].SelectedApprovedAlternate is null&&cleared.Rows[0].ApprovedAlternateSelectionHistory!.Length==2,"explicit clear retains selection history");
Check(JsonSerializer.Serialize(bom.Rows[1],json)==otherJson,"unrelated row unchanged");
foreach(var manual in new[]{false,true}){var legacy=selected with{VproImport=null,ManualDraft=manual?new("MANUAL","Fixture",DateTimeOffset.UtcNow):null,Rows=[selected.Rows[0] with{SourcePartNumberReview=null,SelectedApprovedAlternate=null},other]};legacy=Change(legacy,Select(legacy,"vpro-002"));Check(legacy.Rows[0].ApprovedAlternateSelectionCurrent,manual?"manual path supports exact approved alternate selection":"legacy path supports exact approved alternate selection");}
Console.WriteLine("PASS synthetic approve-select-accept/reopen/revoke/concurrency flow; no live records used");
await StoreChecks.Run(bytes,actor);
