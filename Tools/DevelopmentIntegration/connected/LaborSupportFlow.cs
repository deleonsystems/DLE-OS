using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
internal static class LaborSupportFlow{
 internal static async Task Run(HttpClient client,string id,string root,string key,SimRfqIntakeStore sourceStore,Action<bool,string> check){
  // Snapshot only generated fixture state before any Labor edit. This independent
  // target tests template application without manufacturing a completed plan.
  var sourceState=Path.Combine(root,"state");var targetState=Path.Combine(root,"template-target");
  var targetStore=new SimRfqIntakeStore(targetState,"ISOLATED_DEVELOPMENT_REHEARSAL"){LibraryRfqPackageRead=sourceStore.LibraryRfqPackageRead,LibraryRfqFileRead=sourceStore.LibraryRfqFileRead};
  async Task<JsonElement> Call(string path,object? body=null,string method="GET",string who="junior",int expected=200){using var req=new HttpRequestMessage(new HttpMethod(method),"/api/quoting/v1/"+path);req.Headers.Add("X-Fixture-Session",who);req.Headers.Add("X-Rehearsal-Intent","fixture-only");if(body!=null)req.Content=JsonContent.Create(body);using var response=await client.SendAsync(req);var text=await response.Content.ReadAsStringAsync();check((int)response.StatusCode==expected,$"labor/prior {method} {path} {who}: {(int)response.StatusCode}"+(response.IsSuccessStatusCode?"":" "+text));return JsonDocument.Parse(text).RootElement.Clone();}
  T D<T>(JsonElement j)=>j.Deserialize<T>(SimLibraryBomStore.Json)!;
  var plan=D<SimLaborView>(await Call($"rfqs/{id}/labor"));
  var slide=new SimLaborSlide(Guid.NewGuid().ToString(),"NOTE","Synthetic assembly guide","Synthetic instruction",1,[new(Guid.NewGuid().ToString(),"Step",[],new(1,.5,.5,1,1))]);
  var operations=new[]{new SimLaborOperation("assembly","Synthetic assembly",Instructions:"Reusable synthetic structure",OperationQuantity:1,RunSeconds:60,Slides:[slide])};
  var save=new SimLaborRequest(plan.Plan.Revision,plan.Plan.DefinitionId,plan.Plan.Quantity,operations,75,25,CalculationVersion:SimRfqIntakeStore.LaborUnitBatchCalculation,SlideContractVersion:8,TimingCalculationContractVersion:1,ManufacturingLead:plan.Plan.ManufacturingLead,LeadContractVersion:1);
  plan=D<SimLaborView>(await Call($"rfqs/{id}/labor",save,"POST"));
  check(plan.Plan.Operations.Single().Slides!.Single().Id==slide.Id,"note slide saved in actual Labor plan");
  await Call($"rfqs/{id}/labor",save,"POST",expected:409);
  var notes=D<SimDrawingNotesView>(await Call($"rfqs/{id}/labor/drawing-notes"));
  var drawing=new SimDrawingNotesRequest(0,notes.LaborRevision,notes.Source,[new(Guid.NewGuid().ToString(),1,"arrow",[new(.2,.2),new(.4,.4)])],null,"marks","Synthetic annotation");
  var layer=D<SimDrawingLayer>(await Call($"rfqs/{id}/labor/drawing-notes/assembly",drawing,"PUT"));
  check(layer.Revision==1&&layer.Source==notes.Source,"drawing annotation preserves pinned source and version");
  await Call($"rfqs/{id}/labor/drawing-notes/assembly",drawing,"PUT",expected:409);
  await Call($"rfqs/{id}/labor/drawing-notes/assembly",drawing with{ExpectedRevision=1},"PUT","ray",403);
  using(var req=new HttpRequestMessage(HttpMethod.Get,$"/api/quoting/v1/rfqs/{id}/labor/drawing-notes/pages/{notes.Source.DocumentId}/{notes.Source.Sha256}/1?pixels=512")){req.Headers.Add("X-Fixture-Session","michelle");using var res=await client.SendAsync(req);var bytes=await res.Content.ReadAsByteArrayAsync();check(res.IsSuccessStatusCode&&bytes.AsSpan().StartsWith(new byte[]{137,80,78,71}),"actual retained drawing rendered to PNG for read-only viewer");}
  var preview=D<SimLaborTemplatePreview>(await Call($"rfqs/{id}/labor/template-preview"));
  var templateCommand=new SimLaborTemplateSave(Guid.NewGuid().ToString(),"Synthetic reusable steps",preview.SourceToken);
  var template=D<SimLaborTemplate>(await Call($"rfqs/{id}/labor/templates",templateCommand,"POST"));
  check(template.Operations.All(o=>o.Slides==null&&o.RunSeconds==null&&o.Visuals==null),"template excludes job slides, images and timing");
  var repeated=D<SimLaborTemplate>(await Call($"rfqs/{id}/labor/templates",templateCommand,"POST"));check(repeated.ContentHash==template.ContentHash,"template save retry retains exact hash");
  await Call($"forms/labor-templates/{template.Id}",who:"adan");
  await Call($"rfqs/{id}/labor/use-template",new SimLaborTemplateUse(Guid.NewGuid().ToString(),template.Id,template.ContentHash,plan.Plan.Revision,preview.SourceToken),"POST",expected:409);
  var targetTemplates=Path.Combine(targetState,"labor-templates-v1");Directory.CreateDirectory(targetTemplates);
  File.Copy(Path.Combine(sourceState,"labor-templates-v1",template.Id+".json"),Path.Combine(targetTemplates,template.Id+".json"),false);
  var actor=ConnectedActors.Persona("junior")!;var untouched=await targetStore.ReadLabor(id);var targetPreview=await targetStore.PreviewLaborTemplate(id,actor);
  check(untouched.Plan.Revision==0&&targetPreview.CanUse,"independent synthetic target has untouched Labor");
  var apply=new SimLaborTemplateUse(Guid.NewGuid().ToString(),template.Id,template.ContentHash,untouched.Plan.Revision,targetPreview.SourceToken);
  var applied=await targetStore.UseLaborTemplate(id,apply,actor);
  check(applied.Plan.SourceTemplate?.ContentHash==template.ContentHash&&applied.Plan.Quantity==50&&applied.Plan.Operations.Length==template.Operations.Length,"template applies to untouched target retaining quantity and source hash");
  check(applied.Plan.Operations.All(o=>o.Slides is null&&o.Visuals is null&&o.RunSeconds is null),"applied template carries no job images or prices/times");
  var appliedAgain=await targetStore.UseLaborTemplate(id,apply,actor);check(appliedAgain.Plan.Revision==applied.Plan.Revision,"template application retry does not duplicate work");
  // Deliberately provision only a synthetic reference workbook in this disposable source tree.
  var directory=Path.Combine(root,"source",Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key+"\nN\nN"))),"QUOTE");Directory.CreateDirectory(directory);
  var path=Path.Combine(directory,"synthetic-prior.xls");var workbook=await File.ReadAllBytesAsync("fixtures/bom.xls");await File.WriteAllBytesAsync(path,workbook);
  var prior=D<SimPreviousQuoteView>(await Call($"rfqs/{id}/previous-quotes?department=materials",who:"michelle"));check(prior.Available&&prior.Entries.Any(e=>e.Name=="synthetic-prior.xls"),"synthetic prior workbook listed from linked revision QUOTE folder");
  var described=D<SimPreviousQuoteDescription>(await Call($"rfqs/{id}/previous-quotes/describe?department=materials&folderToken={prior.FolderToken}&path=synthetic-prior.xls",who:"michelle"));
  var selection=new SimPreviousQuoteCommand("materials",prior.SelectionToken,prior.FolderToken,"synthetic-prior.xls",described.Source.SourceToken);
  var selected=D<SimPreviousQuoteSaved>(await Call($"rfqs/{id}/previous-quotes/selection",selection,"PUT","michelle"));
  var retry=D<SimPreviousQuoteSaved>(await Call($"rfqs/{id}/previous-quotes/selection",selection,"PUT","michelle"));check(retry.SelectionToken==selected.SelectionToken,"prior reference selection retry is idempotent");
  await Call($"rfqs/{id}/previous-quotes/selection",selection with{Department="labor"},"PUT","michelle",403);
  using(var req=new HttpRequestMessage(HttpMethod.Get,$"/api/quoting/v1/rfqs/{id}/previous-quotes/file?department=materials&selectionToken={selected.SelectionToken}")){req.Headers.Add("X-Fixture-Session","ray");using var res=await client.SendAsync(req);check(res.IsSuccessStatusCode&&(await res.Content.ReadAsByteArrayAsync()).SequenceEqual(workbook),"selected prior workbook retrieves exact bytes without importing prices");}
  await File.AppendAllTextAsync(path,"synthetic change");
  await Call($"rfqs/{id}/previous-quotes/file?department=materials&selectionToken={selected.SelectionToken}",expected:409);
 }
}
