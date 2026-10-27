using DleOs.Integration;
using System.Text.Json;
using DleOs.Quoting.Identity;

internal sealed class ConnectedActors : IActorResolver
{
#if REHEARSAL
 internal static SimPersona? Persona(string id){
  var rights=id switch{
   "junior"=>new[]{"rfq.intake.create","rfq.view","rfq.materials.edit","rfq.readiness.view","rfq.part_requests.create","rfq.quote.prepare","technical_review.view","technical_review.disposition","assembly_library.view","assembly_library.edit"},
   _=>CandidateRoles.ForFixture(id)?.Permissions};
  var guid=id switch{"ray"=>"11111111-1111-1111-1111-111111111111","michelle"=>"22222222-2222-2222-2222-222222222222","junior"=>"33333333-3333-3333-3333-333333333333",_=>"44444444-4444-4444-4444-444444444444"};
  var role=CandidateRoles.ForFixture(id);
  return rights==null?null:new(guid,guid,"Fixture "+id,"ACTIVE",role==null?[]:[role.Code],role?.Permissions??rights,false,"Disposable rehearsal only",role?.Workspaces);
 }
#endif
 internal SimPersona Resolve(HttpContext c)=>c.Items["connected.actor"] as SimPersona??throw new BoundaryProblem(401,"AUTHENTICATION_REQUIRED");
 public ValueTask<Actor?> ResolveActor(HttpContext c){var p=c.Items["connected.actor"] as SimPersona;return ValueTask.FromResult(p==null?null:new Actor(Guid.Parse(p.Id),p.Permissions.ToHashSet(),p.DisplayName));}
 ValueTask<Actor?> IActorResolver.Resolve(HttpContext c)=>ResolveActor(c);
}
internal sealed class ConnectedIntegrity:IRequestIntegrity{public ValueTask<bool> Validate(HttpContext c)=>ValueTask.FromResult(c.Items["quoting.integrity"] is true);}

internal static class ConnectedBoundary
{
#if REHEARSAL
 private static readonly bool FixtureOnly=true;
#else
 private static readonly bool FixtureOnly=false;
#endif
 internal static void MapConnected(this WebApplication app,SimRfqIntakeStore store,SimLibraryPreparation preparation,SimLibraryBomStore library,SimStateMetadata metadata,ManagedLibraryEvidence managedEvidence)
 {
  var actors=new ConnectedActors();
#if REHEARSAL
  store.MaterialPartRecipients=()=>[ConnectedActors.Persona("junior")!];
#endif
  store.LibraryBomUpdateSource=library.WithBomUpdatePackages;
  app.Use(async(c,next)=>{
   try{
    c.Response.Headers.CacheControl="no-store";
    if(c.Request.Path.StartsWithSegments("/api/quoting")){
#if REHEARSAL
     var selected=c.Request.Headers["X-Fixture-Session"].FirstOrDefault()??c.Request.Cookies["rehearsal-profile"]??"";
     var p=ConnectedActors.Persona(selected)??throw new BoundaryProblem(401,"AUTHENTICATION_REQUIRED");c.Items["connected.actor"]=p;
     c.Items["quoting.integrity"]=c.Request.Headers["X-Rehearsal-Intent"]=="fixture-only";
#else
     var resolver=c.RequestServices.GetService<IQuotingIdentity>()??throw new IdentityDenied(503,"IDENTITY_BINDING_REQUIRED");
     var verified=await resolver.Resolve(c);
     c.Items["connected.actor"]=new SimPersona(verified.UserId.ToString("D"),verified.UserName,verified.DisplayName,"ACTIVE",verified.Roles,verified.Permissions,verified.IsSuperAdmin,"Verified DEV identity",verified.Workspaces);
     c.Items["quoting.integrity"]=true;
#endif
     if(c.Request.Method is not ("GET" or "HEAD")){
#if REHEARSAL
      if(c.Request.Headers["X-Rehearsal-Intent"]!="fixture-only")throw new BoundaryProblem(403,"ANTIFORGERY_REQUIRED");
      if(c.Request.Headers.Origin.FirstOrDefault() is string origin&&origin!=$"{c.Request.Scheme}://{c.Request.Host}")throw new BoundaryProblem(403,"ORIGIN_REJECTED");
#endif
      var upload=(c.Request.Path.Value!.Contains("/intake-drafts/")&&c.Request.Path.Value.EndsWith("/documents"))||c.Request.Path.Value=="/api/quoting/v1/pdf-readability";
      var multipart=c.Request.HasFormContentType&&(c.Request.Path.Value.EndsWith("/attachments")||c.Request.Path.Value.EndsWith("/visuals")||c.Request.Path.Value.EndsWith("/part-requests/evidence"));
      var limit=multipart?6*1024*1024:upload?QuotingLimits.FileLimit:QuotingLimits.JsonLimit;
      using var body=new MemoryStream();var buffer=new byte[8192];int n;
      while((n=await c.Request.Body.ReadAsync(buffer,c.RequestAborted))>0){if(body.Length+n>limit)throw new BoundaryProblem(413,"BODY_LIMIT");await body.WriteAsync(buffer.AsMemory(0,n),c.RequestAborted);}
      body.Position=0;c.Request.Body=body;await next();return;
     }
    }
    await next();
   }catch(IdentityDenied e){c.Response.StatusCode=e.Status;await c.Response.WriteAsJsonAsync(new{code=e.Code});}
   catch(BoundaryProblem e){c.Response.StatusCode=e.Status;await c.Response.WriteAsJsonAsync(new{code=e.Code});}
   catch(SimRfqIntakeProblem e){c.Response.StatusCode=e.StatusCode;await c.Response.WriteAsJsonAsync(new{code=e.Code,message=e.Message});}
   catch(LibraryBomPermissionException e){c.Response.StatusCode=403;await c.Response.WriteAsJsonAsync(new{message=e.Message});}
   catch(VendorReferenceProblem e){c.Response.StatusCode=e.Status;await c.Response.WriteAsJsonAsync(new{code=e.Code,message=e.Message});}
   catch(IOException){c.Response.StatusCode=503;await c.Response.WriteAsJsonAsync(new{code="STORAGE_VERIFICATION_FAILED"});}
  });
  SimPersona Need(HttpContext c,string right){var p=actors.Resolve(c);if(!p.Can(right))throw new BoundaryProblem(403,"PERMISSION_DENIED");return p;}
  app.MapGet("/api/quoting/v1/session",(HttpContext c)=>{var p=actors.Resolve(c);return Results.Json(new{environment=metadata.Environment,user=new{id=p.Id,userName=p.UserName,displayName=p.DisplayName},permissions=p.Permissions,roles=p.Roles,allowedWorkspaces=p.AllowedWorkspaces,isSuperAdmin=p.IsSuperAdmin,fixtureOnly=FixtureOnly});});
  app.MapPost("/api/quoting/v1/intake-drafts/{draft}/documents",async(string draft,string name,HttpContext c)=>{
   var p=Need(c,"rfq.intake.create");using var memory=new MemoryStream();await c.Request.Body.CopyToAsync(memory,c.RequestAborted);var bytes=memory.ToArray();
   if(!(name.EndsWith(".pdf",StringComparison.OrdinalIgnoreCase)&&bytes.AsSpan().StartsWith("%PDF-"u8))&&!(name.EndsWith(".xls",StringComparison.OrdinalIgnoreCase)&&bytes.AsSpan().StartsWith(new byte[]{0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1})))throw new BoundaryProblem(415,"FILE_SIGNATURE");
   return Results.Json(await store.StageDocument(draft,name,0,new MemoryStream(bytes),p));
  });
  app.MapDelete("/api/quoting/v1/intake-drafts/{draft}/documents/{id}",async(string draft,string id,HttpContext c)=>{await store.RemoveStagedDocument(draft,id,Need(c,"rfq.intake.create"));return Results.NoContent();});
  app.MapPost("/api/quoting/v1/rfq-intakes",async(SimRfqIntakeCreateRequest r,HttpContext c)=>{
   var actor=Need(c,"rfq.intake.create");
   if(r.IntakeType!="NEW_QUOTE_REQUEST")throw new BoundaryProblem(404,"MODULE_NOT_ENABLED");
#if REHEARSAL
   if(r.Customer is not {CustomerId:"fixture-customer",CustomerNumber:"F001",CustomerName:"Synthetic fixture customer",ResolutionSource:"isolated-fixture-directory"})throw new BoundaryProblem(400,"CUSTOMER_NOT_RESOLVED");
   return Results.Json(await store.CreateAsync(r,actor,metadata));
#else
   await (c.RequestServices.GetService<IQuotingCustomers>()??throw new BoundaryProblem(503,"CUSTOMER_BINDING_NOT_CONFIGURED")).Validate(r.Customer,c.RequestAborted);
   return Results.Json(await store.CreateAsync(r,actor,metadata));
#endif
  });
  app.MapGet("/api/quoting/v1/customers",async(HttpContext c)=>{Need(c,"rfq.intake.create");if(!FixtureOnly){if(!int.TryParse(c.Request.Query["page"].FirstOrDefault()??"1",out var page))throw new BoundaryProblem(400,"CUSTOMER_QUERY_INVALID");return Results.Json(await (c.RequestServices.GetService<IQuotingCustomers>()??throw new BoundaryProblem(503,"CUSTOMER_BINDING_NOT_CONFIGURED")).Search(c.Request.Query["q"],page,c.RequestAborted));}return Results.Json(new{items=new[]{new{customerId="fixture-customer",customerNumber="F001",customerName="Synthetic fixture customer",resolutionSource="isolated-fixture-directory"}},page=1,totalPages=1,totalItems=1,hasMore=false,fixtureOnly=true});});
  app.MapGet("/api/quoting/v1/assembly-library/preliminary",(HttpContext c)=>{Need(c,"assembly_library.view");if(!FixtureOnly){var reference=(c.RequestServices.GetService<IQuotingLibraryReference>()??throw new BoundaryProblem(503,"LIBRARY_BINDING_NOT_CONFIGURED")).Read();var headers=preparation.Headers();return Results.Json(new{environment=metadata.Environment,preliminary=true,estimateHistoryContractVersion=1,snapshotDate=reference.SnapshotDate,runId=reference.RunId,sourceSha256=reference.SourceSha256,totalHeaders=headers.Length,blankDrawingCount=headers.Count(r=>string.IsNullOrWhiteSpace(r.DrawingNumber)),items=headers});}var rows=preparation.Headers();return Results.Json(new{environment=metadata.Environment,preliminary=true,estimateHistoryContractVersion=1,snapshotDate="synthetic",runId="fixture-only",sourceSha256="fixture-only",totalHeaders=rows.Length,blankDrawingCount=0,items=rows});});
  app.MapGet("/api/quoting/v1/technical-reviews",async(HttpContext c)=>{Need(c,"technical_review.view");return Results.Json(await store.ListTechnicalReviewsAsync());});
  app.MapGet("/api/quoting/v1/technical-review/source",async(string intakeId,HttpContext c)=>{Need(c,"technical_review.view");return Results.Json(await store.PreparationSource(intakeId));});
  app.MapGet("/api/quoting/v1/technical-review/source/file",async(string intakeId,string documentId,HttpContext c)=>{Need(c,"technical_review.view");var f=await store.OpenDocument(intakeId,documentId);return Results.Json(new{document=f.Document,bytes=f.Bytes});});
  app.MapGet("/api/quoting/v1/technical-reviews/{id}",async(string id,HttpContext c)=>{Need(c,"technical_review.view");return Results.Json(await store.ReadTechnicalReviewAsync(id));});
  app.MapGet("/api/quoting/v1/rfqs/commercial",async(HttpContext c)=>{Need(c,"rfq.view");return Results.Json(await store.ReadRfqCommercialQueue());});
  app.MapGet("/api/quoting/v1/rfqs/{id}/materials",async(string id,HttpContext c)=>{Need(c,"rfq.view");return Results.Json(await store.ReadMaterials(id));});
  app.MapMethods("/api/quoting/v1/rfqs/{id}/materials",["POST","PUT"],async(string id,SimMaterialRequest r,HttpContext c)=>Results.Json(await store.SaveMaterials(id,r,Need(c,"rfq.materials.edit"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/labor",async(string id,HttpContext c)=>{Need(c,"rfq.view");return Results.Json(await store.ReadLabor(id));});
  app.MapMethods("/api/quoting/v1/rfqs/{id}/labor",["POST","PUT"],async(string id,SimLaborRequest r,HttpContext c)=>Results.Json(await store.SaveLabor(id,r,Need(c,"technical_review.disposition"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/estimate-submission",async(string id,HttpContext c)=>Results.Json(await store.ReadEstimateSubmission(id,Need(c,"rfq.readiness.view"))));
  app.MapPost("/api/quoting/v1/rfqs/{id}/estimate-submission",async(string id,SimEstimateSubmitRequest r,HttpContext c)=>Results.Json(await store.SubmitEstimate(id,r,Need(c,"technical_review.disposition"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/quote-source",async(string id,HttpContext c)=>Results.Json(SourceQuoteBoundary.View(await store.ReadQuoteSource(id,Need(c,"rfq.quote.prepare")))));
  app.MapGet("/api/quoting/v1/technical-review/rfq-handoff",async(string intakeId,int lineNumber,HttpContext c)=>Results.Json(await store.PreviewRfqHandoff(intakeId,lineNumber,Need(c,"technical_review.view"))));
  app.MapPost("/api/quoting/v1/technical-review/rfq-handoff",async(SimLibraryRfqHandoffCommand r,HttpContext c)=>Results.Json(await store.SendRfqHandoff(r,Need(c,"technical_review.disposition"))));
  app.MapGet("/api/quoting/v1/rfqs",async(HttpContext c)=>{Need(c,"rfq.view");return Results.Json(await store.ReadRfqQueue());});
  app.MapGet("/api/quoting/v1/rfqs/{id}/final-review",async(string id,HttpContext c)=>{Need(c,"rfq.readiness.view");return Results.Json(await store.ReadFinalReview(id));});
  app.MapGet("/api/quoting/v1/rfqs/{id}/quote-copies",async(string id,HttpContext c)=>Results.Json(SourceQuoteBoundary.View(await store.ReadQuoteSource(id,Need(c,"rfq.quote.prepare")))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/documents",async(string id,string department,HttpContext c)=>Results.Json(await store.RfqProjectDocuments(id,department,Need(c,"rfq.view"))));
  app.MapGet("/api/quoting/v1/rfqs/{id}/documents/{documentId}",async(string id,string documentId,string department,HttpContext c)=>{var f=await store.RfqProjectFile(id,documentId,department,Need(c,"rfq.view"));return Results.Json(new{name=f.Name,type=f.Type,base64=Convert.ToBase64String(f.Bytes)});});
  app.MapSourceQuoteBoundary(store,actors,new ConnectedIntegrity());
  app.MapGet("/api/quoting/v1/assembly-library/preparation/managed-evidence",async(string id,string token,string documentId,HttpContext c)=>Results.Json(await managedEvidence.Preview(preparation,library,id,token,documentId,Need(c,"assembly_library.edit"))));
  app.MapPost("/api/quoting/v1/assembly-library/preparation/managed-evidence",async(ManagedEvidenceCommand r,HttpContext c)=>Results.Json(await managedEvidence.Transfer(preparation,library,r,Need(c,"assembly_library.edit"))));
  ConnectedLibrary.Map(app,preparation,library,actors);
  app.MapAuxiliary(store,preparation,actors);app.MapSupporting(store,actors);
  app.MapQuoteBoundary(store,actors,new ConnectedIntegrity());
 }
}
