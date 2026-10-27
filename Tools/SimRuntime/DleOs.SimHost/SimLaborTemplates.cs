using System.Security.Cryptography;
using System.Text.Json;

internal sealed record SimLaborTemplateOrigin(string Id,int Version,string ContentHash,string ApplyId,string AppliedBy,DateTimeOffset AppliedAtUtc,string TargetToken);
internal sealed record SimLaborTemplate(string Schema,string Id,int Version,string Name,SimLaborOperation[] Operations,string SourceRfq,int SourceRevision,string SourceToken,string CreatedBy,DateTimeOffset CreatedAtUtc,string ContentHash);
internal sealed record SimLaborTemplateSave(string RequestId,string Name,string SourceToken);
internal sealed record SimLaborTemplateUse(string RequestId,string TemplateId,string ContentHash,int ExpectedRevision,string TargetToken);
internal sealed record SimLaborTemplatePreview(SimLaborOperation[] Operations,string[] Excluded,string SourceToken,bool CanSave,bool CanUse,string? UnavailableReason);

internal sealed partial class SimRfqIntakeStore
{
    private string LaborTemplatesPath=>Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(dataPath))!,"labor-templates-v1");
    private static readonly string[] TemplateExclusions=["Customer drawings and all job slides / images","Oven profile values and job notes","Quantities, time estimates, rates and prices","Signoffs and inspection results"];
    private static string TemplateHash<T>(T value)=>Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value,new JsonSerializerOptions(JsonSerializerDefaults.Web))));
    private static void TemplatePermission(SimPersona persona,bool edit=false,bool labor=false)
    {
        if(!persona.IsActive||!persona.Can("assembly_library.view")||edit&&!persona.Can("assembly_library.edit")||labor&&(!persona.Can("rfq.view")||!persona.Can("technical_review.disposition")))
            throw SimRfqIntakeProblem.Conflict("LABOR_TEMPLATE_DENIED","This session does not have permission for this template action.");
    }
    private static string TemplateGuid(string id)
    {
        if(!Guid.TryParseExact(id,"D",out var guid))throw SimRfqIntakeProblem.BadRequest("LABOR_TEMPLATE_ID","Reopen the template before continuing.");
        return guid.ToString("D");
    }
    private string TemplatePath(string id)=>Path.Combine(LaborTemplatesPath,TemplateGuid(id)+".json");
    private async Task<SimLaborTemplate> ReadLaborTemplateFile(string id)
    {
        var path=TemplatePath(id);
        if(!File.Exists(path))throw SimRfqIntakeProblem.Conflict("LABOR_TEMPLATE_MISSING","This template is unavailable. Reopen Forms Library.");
        var template=JsonSerializer.Deserialize<SimLaborTemplate>(await File.ReadAllTextAsync(path),jsonOptions);
        if(template is null||template.Schema!="DLE_LABOR_TEMPLATE_V1"||template.Id!=TemplateGuid(id)||template.Version!=1||TemplateHash(template with{ContentHash=""})!=template.ContentHash)
            throw SimRfqIntakeProblem.Conflict("LABOR_TEMPLATE_CHANGED","The saved template could not be verified. No worksheet was changed.");
        return template;
    }
    internal async Task<object> ListLaborTemplates(SimPersona persona)
    {
        TemplatePermission(persona);await gate.WaitAsync();try{
            var list=new List<object>();
            if(Directory.Exists(LaborTemplatesPath))foreach(var path in Directory.EnumerateFiles(LaborTemplatesPath,"*.json").OrderBy(p=>p,StringComparer.Ordinal)){
                var template=await ReadLaborTemplateFile(Path.GetFileNameWithoutExtension(path));
                list.Add(new{template.Id,template.Version,template.Name,template.ContentHash,stepCount=template.Operations.Length,operationCount=template.Operations.Count(o=>o.ParentId is null),template.CreatedAtUtc});
            }
            return new{items=list};
        }finally{gate.Release();}
    }
    internal async Task<SimLaborTemplate> GetLaborTemplate(string id,SimPersona persona)
    {TemplatePermission(persona);await gate.WaitAsync();try{return await ReadLaborTemplateFile(id);}finally{gate.Release();}}
    private static string LaborTemplateToken(SimLaborView view)=>TemplateHash(new{view.Rfq.IntakeId,view.Rfq.LibraryRfq,view.Rfq.Lanes.Labor,view.Plan});
    // Only explicitly reusable text and structure cross this boundary. No job references are copied.
    internal static SimLaborOperation[] LaborTemplateStructure(SimLaborOperation[] source)
    {
        var map=source.ToDictionary(o=>o.Id,_=>Guid.NewGuid().ToString("D"));
        IEnumerable<SimLaborOperation> Walk(string? parent){foreach(var op in source.Where(o=>o.ParentId==parent)){
            yield return new(map[op.Id],op.Name,Instructions:op.Instructions,ParentId:parent is null?null:map[parent],TimeBasis:op.TimeBasis,
                ResponsibleRole:op.ResponsibleRole,InstructionSourceId:op.InstructionSourceId is {} reference?map[reference]:null,Department:op.Department,Handoff:op.Handoff);
            foreach(var child in Walk(op.Id))yield return child;
        }}
        return Walk(null).ToArray();
    }
    private static bool EmptyForLaborTemplate(SimLaborView view)
    {
        var p=view.Plan;
        if(view.Rfq.Lanes.Labor.Status=="COMPLETE"||p.SourceTemplate is not null||p.Versions.Length>0||p.RevisionHistory?.Length>0||p.RemovedNotes?.Length>0||p.RemovedVisuals?.Length>0)return false;
        if(p.Operations.Length==0)return true;
        var defaultPlan=LaborView(view.Rfq with{Lanes=view.Rfq.Lanes with{LaborQuote=null}}).Plan;
        return TemplateHash(p.Operations)==TemplateHash(defaultPlan.Operations);
    }
    internal async Task<SimLaborTemplatePreview> PreviewLaborTemplate(string id,SimPersona persona)
    {
        TemplatePermission(persona);if(!persona.Can("rfq.view"))throw SimRfqIntakeProblem.Conflict("LABOR_TEMPLATE_DENIED","Labor viewing is not permitted.");
        await gate.WaitAsync();try{
            var record=await RequireRfqRecord(id);var view=LaborView(RfqView(record,await ReadRfqLanes()));
            var editable=persona.Can("technical_review.disposition")&&view.Rfq.Lanes.Labor.Status!="COMPLETE"&&LaborRevisionBlocker(view,(await ReadDatasetAsync()).Records) is null;
            var empty=EmptyForLaborTemplate(view)&&!((await DrawingLayers()).GetValueOrDefault(id)??[]).Any();
            return new(LaborTemplateStructure(view.Plan.Operations),TemplateExclusions,LaborTemplateToken(view),editable&&persona.Can("assembly_library.edit")&&view.Plan.Revision>0&&view.Plan.Operations.Length>0,editable&&empty,
                !editable?"This worksheet is read-only.":!empty?"Use template is available only for an untouched Labor worksheet.":null);
        }finally{gate.Release();}
    }
    internal async Task<SimLaborTemplate> SaveLaborTemplate(string id,SimLaborTemplateSave command,SimPersona persona)
    {
        TemplatePermission(persona,edit:true,labor:true);var requestId=TemplateGuid(command.RequestId);var name=(command.Name??"").Trim();
        if(name.Length is <1 or >120||name.Any(char.IsControl))throw SimRfqIntakeProblem.BadRequest("LABOR_TEMPLATE_NAME","Enter a template name up to 120 characters.");
        await gate.WaitAsync();try{
            var path=TemplatePath(requestId);
            if(File.Exists(path)){
                var prior=await ReadLaborTemplateFile(requestId);
                if(prior.Name==name&&prior.SourceRfq==id&&prior.SourceToken==command.SourceToken)return prior;
                throw SimRfqIntakeProblem.Conflict("LABOR_TEMPLATE_RETRY","This save belongs to a different template. Reopen the preview.");
            }
            var record=await RequireRfqRecord(id);var view=LaborView(RfqView(record,await ReadRfqLanes()));
            if(LaborTemplateToken(view)!=command.SourceToken)throw SimRfqIntakeProblem.Conflict("LABOR_TEMPLATE_STALE","Labor changed. Reopen the template preview before saving.");
            if(view.Plan.Revision==0||view.Plan.Operations.Length==0||view.Plan.Operations.Any(o=>string.IsNullOrWhiteSpace(o.Name)))throw SimRfqIntakeProblem.Conflict("LABOR_TEMPLATE_SOURCE","Save Labor with named steps before saving its structure as a template.");
            var template=new SimLaborTemplate("DLE_LABOR_TEMPLATE_V1",requestId,1,name,LaborTemplateStructure(view.Plan.Operations),id,view.Plan.Revision,command.SourceToken,persona.DisplayName,DateTimeOffset.UtcNow,"");
            template=template with{ContentHash=TemplateHash(template)};
            Directory.CreateDirectory(LaborTemplatesPath);var temp=path+".write-"+Guid.NewGuid().ToString("N");
            try{await File.WriteAllTextAsync(temp,JsonSerializer.Serialize(template,jsonOptions));var check=JsonSerializer.Deserialize<SimLaborTemplate>(await File.ReadAllTextAsync(temp),jsonOptions);if(check is null||TemplateHash(check with{ContentHash=""})!=template.ContentHash)throw new IOException("Template verification failed.");File.Move(temp,path,false);}
            finally{if(File.Exists(temp))File.Delete(temp);}
            return template;
        }finally{gate.Release();}
    }
    internal Task<SimLaborView> UseLaborTemplate(string id,SimLaborTemplateUse command,SimPersona persona)=>SaveLabor(id,new(command.ExpectedRevision,"",0,[],null,0,TemplateApply:command),persona);
    private static SimLaborSlide BlankTemplateReflow(string step)
    {
        SimDrawingMark Text(string value,double x,double y)=>new(Guid.NewGuid().ToString("D"),1,"text",[new(x,y)],value,Color:"#173d4b",FontSize:.027);
        var marks=new List<SimDrawingMark>{Text("Reflow setup",.065,.09)};
        foreach(var (y,label,values) in new[]{(.25,"Zone",new[]{"1","2","3","4","5"}),(.35,"Upper C",new[]{"-","-","-","-","-"}),(.45,"Lower C",new[]{"-","-","-","-","-"})}){marks.Add(Text(label,.065,y));for(var i=0;i<5;i++)marks.Add(Text(values[i],.25+i*.115,y));}
        marks.Add(Text("Belt speed: -",.065,.55));
        return new(Guid.NewGuid().ToString("D"),"NOTE","Reflow setup","",1,[new(Guid.NewGuid().ToString("D"),"Profile",marks.ToArray(),new(1,.5,.5,1,1))],ReflowStepId:step);
    }
}

internal static partial class SimRfqIntakeEndpoints
{
    private static void MapLaborTemplates(WebApplication app,SimStateStore state,SimRfqIntakeStore store,SimPersonaSessionStore personas)
    {
        async Task<IResult> Run(HttpContext c,string permission,Func<SimPersona,Task<object>> action){
            c.Response.Headers.CacheControl="private, no-store";
            var denied=DeniedTechnicalReview(c,state,personas,permission);if(denied is not null)return denied;
            try{return Results.Json(await action(personas.Resolve(c)));}
            catch(SimRfqIntakeProblem e){return Results.Json(new{message=e.Message,code=e.Code},statusCode:e.StatusCode);}
            catch(Exception e)when(e is IOException or UnauthorizedAccessException or JsonException){return Results.Json(new{message="Template storage could not be confirmed. Reopen to check before retrying."},statusCode:503);}
        }
        app.MapGet("/api/sim/forms/labor-templates",async Task<IResult> (HttpContext c)=>await Run(c,"assembly_library.view",p=>store.ListLaborTemplates(p)));
        app.MapGet("/api/sim/forms/labor-templates/{templateId}",(string templateId,HttpContext c)=>Run(c,"assembly_library.view",async p=>await store.GetLaborTemplate(templateId,p)));
        app.MapGet("/api/sim/rfqs/{id}/labor/template-preview",(string id,HttpContext c)=>Run(c,"rfq.view",async p=>await store.PreviewLaborTemplate(id,p)));
        app.MapPost("/api/sim/rfqs/{id}/labor/templates",(string id,SimLaborTemplateSave command,HttpContext c)=>Run(c,"technical_review.disposition",async p=>await store.SaveLaborTemplate(id,command,p)));
        app.MapPost("/api/sim/rfqs/{id}/labor/use-template",(string id,SimLaborTemplateUse command,HttpContext c)=>Run(c,"technical_review.disposition",async p=>await store.UseLaborTemplate(id,command,p)));
    }
}
