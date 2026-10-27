using System.Text.Json;
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../../"));
var csv=Path.Combine(root,"Tools/SimRuntime/ReferenceSnapshots/AssemblyLibrary_Preliminary_2026-07-29/BillOfMaterial.csv");
void Check(bool b,string message){if(!b)throw new Exception(message);}
var rows=SimAssemblyLibrarySnapshot.Read(csv);
Check(rows.Length==1290,"all headers");Check(rows.Count(r=>r.DrawingNumber.TrimEnd()=="")==493,"blank drawing headers");
Check(rows.Select(r=>r.SourceKeyRaw).Distinct(StringComparer.Ordinal).Count()==1290,"raw identity uniqueness");
var collision=rows.Where(r=>r.NormalizedKeyCollision).ToArray();Check(collision.Length==2,"collision flagged on both");
Check(collision.Any(r=>r.BillNumber.TrimEnd()==" D1002189-12")&&collision.Any(r=>r.BillNumber.TrimEnd()=="D1002189-12"),"leading space preserved");
var abbott=rows.Single(r=>r.BillNumber.TrimEnd()=="B11003-30");Check(abbott.DrawingRevision.TrimEnd()=="V*"&&abbott.BomRevision.TrimEnd()=="V*"&&abbott.BomRevisionDate=="3A213A","literal separate revisions");
Check(abbott.DrawingNumber.TrimEnd()=="B11003-30 & A11003-90","drawing text");
Check(JsonSerializer.Deserialize<SimAssemblyHeader[]>(JsonSerializer.Serialize(rows))![0].SourceKeyRaw==rows[0].SourceKeyRaw,"JSON roundtrip raw key");
var temp=Path.Combine(Path.GetTempPath(),Guid.NewGuid()+".csv");try{var bytes=File.ReadAllBytes(csv);bytes[^3]^=1;File.WriteAllBytes(temp,bytes);try{SimAssemblyLibrarySnapshot.Read(temp);throw new Exception("tamper allowed");}catch(InvalidDataException){}}finally{File.Delete(temp);}
Console.WriteLine("PASS: 1290 headers, 493 blanks, distinct raw keys, collision, separate raw revisions, JSON roundtrip, tamper rejection.");
