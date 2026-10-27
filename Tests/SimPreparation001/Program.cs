using System.Text;
using System.Text.Json;
var json=new JsonSerializerOptions(JsonSerializerDefaults.Web);
var actor=new SimPersona("test","test","Fixture Reviewer","ACTIVE",[],["technical_review.disposition"],false,"test");
void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS "+name);}
void Reject(Action action,string name){try{action();throw new Exception(name+" unexpectedly allowed");}catch(SimRfqIntakeProblem){Check(true,name);}}
string Row(params string[] f)=>string.Join('\t',f);
var lines=new List<string>{Row([..SimVproParser.Headers,"/ DRAW#=TEST REV A /"])};
foreach(var i in Enumerable.Range(0,7)){
 var seq=i*3+1;var find=i==0?"18":i<6?"18."+i:"19";
 lines.Add(Row(seq.ToString("000"),"ITEM-"+i,"Fixture component","", "1","1","EA","1","0","0","0","",""));
 lines.Add(Row((seq+1).ToString("000"),"PRECUT-"+i,"Historical alternate","", "10",".0001","EA","1","0","0","0","",""));
 lines.Add(Row((seq+2).ToString("000"),"","("+find+")J"+(i+1),"","1","0","  ","0","0","0","0","",""));
}
var bytes=Encoding.ASCII.GetBytes(string.Join('\n',lines));
var bom=SimVproParser.Parse(bytes,"fixture-doc","TEST","A","Fixture");
var original=JsonSerializer.Serialize(bom.Rows,json);
var pieces=bom.Rows.Skip(1).Take(5).Select((r,i)=>new SimPreparationPiece(r.RowId!,"MAKE_FROM_STOCK",new[]{2,4,6,8,7}[i])).ToArray();
SimCandidateReviewRequest Request(SimCandidateBom b,SimPreparationPiece[]? choices=null,string? group=null)=>new(b.Id,0,null,PreparationChange:new(b.PreparationToken,group,b.Rows[0].RowId!,"18","CUSTOMER",choices??pieces,""));
var grouped=SimCandidateBomProvider.Review(bom,Request(bom),actor);
Check(grouped.PreparationGroups?.Length==1&&grouped.PreparationHistory?.Length==1,"explicit grouping persisted with audit");
Check(JsonSerializer.Serialize(grouped.Rows,json)==original,"grouping preserves every original row, identity and review");
Check(grouped.PreparationDemand.Length==1&&grouped.PreparationDemand[0] is {Kind:"STOCK",Quantity:null},"five derived uses create one pending stock demand, not five purchases or guessed yield");
Check(SimPreparation.Current(grouped,grouped.PreparationGroups![0]),"source hash and row fingerprint current");
Reject(()=>SimCandidateBomProvider.Review(grouped,Request(bom),actor),"concurrent edit rejects stale token");
Reject(()=>SimCandidateBomProvider.Review(bom,Request(bom),actor with{Permissions=[]}),"disposition permission required");
Reject(()=>SimCandidateBomProvider.Review(bom,Request(bom,[pieces[0],pieces[0]]),actor),"duplicate child blocked");
Reject(()=>SimCandidateBomProvider.Review(bom,Request(bom,[pieces[0] with{Method="BOTH"}]),actor),"one sourcing method only");
Reject(()=>SimCandidateBomProvider.Review(grouped,Request(grouped),actor),"overlapping group blocked");
Reject(()=>SimPreparation.RequireDownstream(grouped),"grouped final acceptance/export blocked");
var rfq=JsonSerializer.Deserialize<SimRfqWorkspace>(JsonSerializer.Serialize(new{inputs=new{materials=new{candidate=grouped}}},json),json)!;
try{typeof(SimRfqIntakeStore).GetMethod("MaterialView",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!.Invoke(null,[rfq]);throw new Exception("Material projection unexpectedly allowed");}
catch(System.Reflection.TargetInvocationException e) when(e.InnerException is SimRfqIntakeProblem problem && problem.Message==SimPreparation.Pending){Check(true,"actual material projection rejects unsupported grouped flattening");}
SimPreparation.RequireDownstream(bom);Check(true,"ordinary legacy BOM unaffected by downstream guard");
var mixed=SimCandidateBomProvider.Review(grouped,Request(grouped,[pieces[0] with{Method="BUY_PRECUT"},..pieces.Skip(1)],grouped.PreparationGroups![0].Id),actor);
Check(mixed.PreparationDemand.Length==2&&mixed.PreparationDemand.Count(d=>d.Kind=="STOCK")==1&&mixed.PreparationDemand.Count(d=>d.Kind=="PRECUT")==1,"mixed sourcing counts precut use only once and keeps stock quantity pending");
var purchased=SimCandidateBomProvider.Review(mixed,Request(mixed,pieces.Select(p=>p with{Method="BUY_PRECUT"}).ToArray(),mixed.PreparationGroups![0].Id),actor);
Check(purchased.PreparationDemand.All(d=>d.Kind=="PRECUT")&&purchased.PreparationDemand.Length==5,"all precut excludes stock demand");
var reopened=JsonSerializer.Deserialize<SimCandidateBom>(JsonSerializer.Serialize(mixed,json),json)!;
Check(reopened.PreparationToken==mixed.PreparationToken&&reopened.PreparationHistory!.Length==2,"JSON reopen retains grouping choices, token and history");
var stale=reopened with{GoverningSha256="changed-source"};
Check(stale.PreparationDemand.All(d=>d.Kind=="BLOCKED"),"source switch invalidates saved grouping; no demand emitted");
var changedRows=reopened.Rows.ToArray();changedRows[1]=changedRows[1] with{Values=new(changedRows[1].Values){["quantity"]="2"}};
Check((reopened with{Rows=changedRows}).PreparationDemand.All(d=>d.Kind=="BLOCKED"),"changed quantity invalidates grouping without altering history");
Check(SimPreparation.LiteralFind(bom.Rows[1],"18.1")&&!SimPreparation.LiteralFind(bom.Rows[1],"18.2")&&!SimPreparation.LiteralFind(bom.Rows[1],"18..1")&&!SimPreparation.LiteralFind(bom.Rows[1],"0"),"literal imported decimal supported without arbitrary reassignment");
Check(!SimPreparation.LiteralFind(bom.Rows[1] with{RowId="manual-1"},"18.1"),"manual path cannot masquerade as imported decimal");
var nob=bom.Rows[1] with{Extracted=new(bom.Rows[1].Extracted){["lineNumber"]="NOB"}};Check(SimPreparation.LiteralFind(nob,"NOB"),"literal imported NOB supported");
var acceptedValues=bom.Rows[1].Values.Where(v=>SimCandidateBomProvider.Fields.Contains(v.Key)).ToDictionary(v=>v.Key,v=>v.Value);
var acceptedField=SimCandidateBomProvider.Review(bom,new(bom.Id,1,acceptedValues),actor);
Check(!acceptedField.Rows[1].ReviewState.ApprovalBlockers.Any(x=>x.Contains("values are missing or invalid")),"decimal row field review no longer fails integer-only validator");
var approved=SimCandidateBomProvider.Review(bom,new(bom.Id,1,null,AlternateChange:new("APPROVE",bom.Rows[1].Alternates![0].Id,bom.Rows[1].Alternates![0].PartNumber,null,0)),actor);
var selected=SimCandidateBomProvider.Review(approved,new(bom.Id,1,null,ApprovedAlternateSelection:new(approved.Rows[1].Alternates![0].Id,approved.Rows[1].ReviewState.Token)),actor);
var accepted=SimCandidateBomProvider.Review(selected,new(bom.Id,1,acceptedValues,WorksheetAcceptance:new(selected.Rows[1].ReviewState.Token,"STANDARD_COTS")),actor);
Check(accepted.Rows[1].ReviewState.Reviewed&&accepted.Rows[1].Values["lineNumber"]=="18.1","decimal Find survives explicit approve/select/Accept without renumbering");
await StoreChecks.Run(bytes,actor,pieces);
Console.WriteLine("PASS preparation first-slice checks; no live customer record used");
