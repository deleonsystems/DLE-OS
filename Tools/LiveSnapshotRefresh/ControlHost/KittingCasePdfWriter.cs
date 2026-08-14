using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

internal static class KittingCasePdfWriter
{
    private const decimal PageWidth=612,PageHeight=792,Left=30,Right=582,BodyTop=674,Bottom=52;
    private static readonly decimal[] Columns={30,61,89,222,407,470,582};

    internal static byte[] Create(string snapshotJson)
    {
        using var document=JsonDocument.Parse(snapshotJson);
        var report=ReadReport(document.RootElement);
        var pages=Paginate(report);
        var streams=pages.Select((page,index)=>RenderPage(report,page,index+1,pages.Count)).ToArray();
        return BuildPdf(streams);
    }

    private static PdfReport ReadReport(JsonElement root)
    {
        var draft=root.GetProperty("draft");
        var header=draft.TryGetProperty("header",out var h)?h:default;
        var instructions=new List<string>();
        if(draft.TryGetProperty("assemblyInstructions",out var ins)&&ins.ValueKind==JsonValueKind.Array)
            foreach(var item in ins.EnumerateArray())
                instructions.Add(Text(item,"materialMessage"));
        var groups=new List<PdfGroup>();
        foreach(var group in draft.GetProperty("groups").EnumerateArray())
        {
            if(!Bool(group,"actionable"))continue;
            var related=new List<string>();
            if(group.TryGetProperty("relatedParts",out var rel)&&rel.ValueKind==JsonValueKind.Array)
                foreach(var item in rel.EnumerateArray())
                    related.Add(item.TryGetProperty("row",out var row)?Text(row,"itemNumber"):Text(item,"partNumber"));
            var refs=Strings(group,"references");var notes=Strings(group,"notes");
            var entry=group.TryGetProperty("entry",out var e)&&e.ValueKind==JsonValueKind.Object?e:(JsonElement?)null;
            var allocations=new List<PdfAllocation>();
            if(entry is not null&&entry.Value.TryGetProperty("allocations",out var allocs)&&allocs.ValueKind==JsonValueKind.Array)
                foreach(var allocation in allocs.EnumerateArray())allocations.Add(new(Text(allocation,"partNumber"),Number(allocation,"quantity"),Text(allocation,"purchaseOrder")));
            groups.Add(new(Text(group,"sequence"),Text(group,"findNumber"),Text(group,"partNumber"),related,
                Text(group,"description"),refs,notes,Number(group,"requiredQuantity"),Text(group,"unitOfMeasure"),
                entry is null?"NOT DISPOSITIONED":Text(entry.Value,"method"),entry is null?0:Number(entry.Value,"pickedQuantity"),
                entry is null?0:Number(entry.Value,"shortageQuantity"),entry is null?0:Number(entry.Value,"extraQuantity"),
                entry is null?"":Text(entry.Value,"selectedPartNumber"),entry is null?"":Text(entry.Value,"purchaseOrder"),allocations));
        }
        bool? poTraceabilityRequired=root.TryGetProperty("poTraceabilityRequired",out var traceability)&&
            traceability.ValueKind is JsonValueKind.True or JsonValueKind.False?traceability.GetBoolean():null;
        return new(Text(root,"workOrderNumber"),Text(root,"assemblyItemNumber"),Text(root,"revision"),Int(root,"runNumber"),
            Text(root,"submissionType"),Int(root,"versionNumber"),Text(root,"submittedBy"),Text(root,"submittedAtUtc"),
            header.ValueKind==JsonValueKind.Object?Text(header,"scheduledProduction"):"",header.ValueKind==JsonValueKind.Object?Text(header,"unitOfMeasure"):"",
            header.ValueKind==JsonValueKind.Object?Text(header,"description"):"",poTraceabilityRequired,
            instructions.Where(x=>x.Length>0).ToList(),groups);
    }

    private static List<PdfPage> Paginate(PdfReport report)
    {
        var pages=new List<PdfPage>();var page=new PdfPage();decimal y=BodyTop-17;
        if(report.Instructions.Count>0)y-=InstructionHeight(report.Instructions);
        foreach(var group in report.Groups)
        {
            var height=GroupHeight(group);
            if(page.Groups.Count>0&&y-height<Bottom){pages.Add(page);page=new PdfPage();y=BodyTop-17;}
            page.Groups.Add(group);y-=height;
        }
        pages.Add(page);return pages;
    }

    private static string RenderPage(PdfReport report,PdfPage page,int number,int count)
    {
        var c=new Canvas();
        c.Text(Left,765,"DE LEON ENTERPRISES",11,true);c.Text(220,765,"KITTING SUBMISSION",13,true);
        c.TextRight(Right,765,$"PAGE {number} OF {count}",8,true);c.Line(Left,756,Right,756,1.4m);
        var label=report.SubmissionType=="KIT_SHORT"?"KIT SHORT":"KIT COMPLETE";
        c.Text(Left,741,$"WORK ORDER  {report.WorkOrder}",10,true);c.Text(215,741,$"ASSEMBLY  {report.Assembly}  REV {Dash(report.Revision)}",9,true);
        var runLabel=report.RunNumber>1?$"RUN {report.RunNumber:000}  ":"";
        c.TextRight(Right,741,$"{runLabel}{label}  V{report.Version:000}",10,true);
        c.Text(Left,726,$"DESCRIPTION  {Dash(report.Description)}",8);c.Text(315,726,$"WO QTY  {Dash(report.WoQuantity)} {report.Unit}",8,true);
        c.Text(Left,712,$"SUBMITTED  {FormatTimestamp(report.SubmittedAt)}",8);c.Text(315,712,$"OPERATOR  {report.SubmittedBy}",8);
        c.Text(Left,698,$"P.O. TRACEABILITY  {TraceabilityLabel(report.PoTraceabilityRequired)}",7.5m,true);
        DrawLegend(c,315,698);
        c.Line(Left,688,Right,688,.8m);
        if(number==1&&report.Instructions.Count>0)DrawInstructions(c,report.Instructions);
        DrawColumnHeader(c,number==1&&report.Instructions.Count>0?BodyTop-InstructionHeight(report.Instructions):BodyTop);
        var y=(number==1&&report.Instructions.Count>0?BodyTop-InstructionHeight(report.Instructions):BodyTop)-17;
        foreach(var group in page.Groups){DrawGroup(c,group,y);y-=GroupHeight(group);}
        c.Line(Left,38,Right,38,.7m);c.Text(Left,27,"IMMUTABLE DLE-OS KITTING SUBMISSION SNAPSHOT",7,true);c.TextRight(Right,27,$"WO {report.WorkOrder} / {label} V{report.Version:000}",7);
        return c.ToString();
    }

    private static void DrawInstructions(Canvas c,List<string> instructions)
    {
        var height=InstructionHeight(instructions)-8;c.Fill(Left,BodyTop-height+8,Right-Left,height,.95m);c.Rect(Left,BodyTop-height+8,Right-Left,height,.6m);
        c.Text(Left+7,BodyTop-4,"ASSEMBLY INSTRUCTIONS",8,true);var y=BodyTop-16;
        foreach(var instruction in instructions)foreach(var line in Wrap(instruction,104)){c.Text(Left+7,y,line,7.5m);y-=9;}
    }

    private static void DrawColumnHeader(Canvas c,decimal top)
    {
        c.Fill(Left,top-15,Right-Left,15,.9m);c.Line(Left,top,Right,top,.8m);c.Line(Left,top-15,Right,top-15,.8m);
        var labels=new[]{"WO SEQ","FIND","MAIN PART / RELATED","DESCRIPTION / REFERENCES","REQUIRED","KITTING RESULT"};
        for(var i=0;i<labels.Length;i++)c.Text(Columns[i]+3,top-11,labels[i],6.7m,true);
    }

    private static void DrawGroup(Canvas c,PdfGroup g,decimal top)
    {
        var height=GroupHeight(g);if(g.Short>0)c.Fill(Left,top-height,Right-Left,height,.92m);
        c.Line(Left,top,Right,top,.45m);for(var i=1;i<Columns.Length-1;i++)c.Line(Columns[i],top,Columns[i],top-height,.25m);
        c.Text(Columns[0]+3,top-11,g.Sequence,8,true);c.Text(Columns[1]+3,top-11,Dash(g.Find),8,true);
        var partLines=PartLines(g);
        DrawLines(c,Columns[2]+3,top-11,partLines,25,7.2m,g.Related.Count>0);
        var details=new List<string>();details.AddRange(Wrap(g.Description,36));if(g.References.Count>0)details.AddRange(Wrap("REFS: "+string.Join(", ",g.References),36));
        if(g.Notes.Count>0)details.AddRange(Wrap("NOTE: "+string.Join(" / ",g.Notes),36));DrawLines(c,Columns[3]+3,top-11,details,36,7.2m,false);
        c.TextRight(Columns[5]-4,top-11,$"{Qty(g.Required)} {g.Unit}",8,true);
        DrawResult(c,g,top);
        var evidence=EvidenceRows(g);if(evidence.Count>0)
        {
            var ey=top-BaseHeight(g)+2;c.Line(Columns[2]+3,ey,Right-4,ey,.4m);ey-=9;
            c.Text(Columns[2]+7,ey,"COUNT / ALLOCATION DETAIL",6.5m,true);ey-=10;
            foreach(var row in evidence)
            {
                c.Text(Columns[2]+7,ey,Clip(row.Part,28),7,true);
                c.Text(Columns[3]+7,ey,$"QTY {Qty(row.Quantity)}",7,true);
                c.Text(Columns[2]+12,ey-8,$"P.O. {Dash(row.Po)}",6.5m);
                ey-=18;
            }
        }
        c.Line(Left,top-height,Right,top-height,.45m);
    }

    private static decimal GroupHeight(PdfGroup g)=>BaseHeight(g)+(EvidenceRows(g).Count>0?20+EvidenceRows(g).Count*18:0);
    private static decimal BaseHeight(PdfGroup g)
    {
        var part=PartLines(g).Sum(x=>Math.Max(1,Wrap(x,25).Count));var detail=Wrap(g.Description,36).Count+Wrap(g.References.Count>0?"REFS: "+string.Join(", ",g.References):"",36).Count+
            Wrap(g.Notes.Count>0?"NOTE: "+string.Join(" / ",g.Notes):"",36).Count;
        var result=g.Method=="COUNT"?38:25;
        return Math.Max(result,8+Math.Max(part,detail)*9);
    }
    private static List<PdfAllocation> EvidenceRows(PdfGroup g)
    {
        if(g.Method=="COUNT"&&g.Allocations.Count>0)return g.Allocations;
        return new();
    }
    private static decimal InstructionHeight(List<string> values)=>24+values.Sum(x=>Math.Max(1,Wrap(x,104).Count))*9;
    private static List<string> PartLines(PdfGroup g)
    {
        var lines=new List<string>{g.Part};
        lines.AddRange(g.Related.Select(x=>"RELATED: "+x));
        if(g.Method!="COUNT"&&g.Po.Length>0)
        {
            if(g.SelectedPart.Length>0&&!g.SelectedPart.Equals(g.Part,StringComparison.OrdinalIgnoreCase))
                lines.Add("USED: "+g.SelectedPart);
            lines.Add("P.O. "+g.Po);
        }
        return lines;
    }
    private static void DrawResult(Canvas c,PdfGroup g,decimal top)
    {
        var x=Columns[5]+8;
        if(g.Method=="COMPLETE"||g.Method=="COMPLETE_MIN_EXTRA")
        {
            c.Check(x,top-15,10);
            if(g.Method=="COMPLETE_MIN_EXTRA")c.Text(x+16,top-13,"*",11,true);
            return;
        }
        if(g.Method=="COUNT")
        {
            c.Text(x,top-14,Qty(g.Picked),12,true);
            c.Text(x,top-24,"PICKED",6.5m,true);
            if(g.Short>0)c.Text(x,top-35,$"REMAINING SHORT {Qty(g.Short)}",6.5m,true);
            else if(g.Extra>0)c.Text(x,top-35,$"+{Qty(g.Extra)} EXTRA",7.5m,true);
            return;
        }
        c.Text(Columns[5]+3,top-11,"NOT DISPOSITIONED",6.5m,true);
    }
    private static void DrawLegend(Canvas c,decimal x,decimal y)
    {
        c.Check(x,y-2,6);c.Text(x+10,y-2,"= COMPLETE",6.5m);
        c.Check(x+86,y-2,6);c.Text(x+96,y-2,"* = COMPLETE - MIN EXTRA",6.5m);
    }
    private static string TraceabilityLabel(bool? required)=>required switch{true=>"REQUIRED",false=>"OPTIONAL",null=>"NOT RECORDED (LEGACY)"};
    private static void DrawLines(Canvas c,decimal x,decimal y,List<string> values,int width,decimal size,bool related)
    {for(var i=0;i<values.Count;i++){foreach(var line in Wrap(values[i],width)){c.Text(x,y,line,size,i==0||related&&values[i].StartsWith("RELATED:"));y-=9;}}}

    private static byte[] BuildPdf(string[] streams)
    {
        var objects=new List<string>{"<< /Type /Catalog /Pages 2 0 R >>"};var fontId=3+streams.Length*2;
        objects.Add($"<< /Type /Pages /Kids [{string.Join(" ",Enumerable.Range(0,streams.Length).Select(i=>$"{3+i*2} 0 R"))}] /Count {streams.Length} >>");
        for(var i=0;i<streams.Length;i++){var pageId=3+i*2;objects.Add($"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {fontId} 0 R /F2 {fontId+1} 0 R >> >> /Contents {pageId+1} 0 R >>");objects.Add($"<< /Length {Encoding.ASCII.GetByteCount(streams[i])} >>\nstream\n{streams[i]}\nendstream");}
        objects.Add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");objects.Add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>");
        var output=new StringBuilder("%PDF-1.4\n% DLE-OS immutable Kitting submission\n");var offsets=new List<int>{0};
        foreach(var (item,index) in objects.Select((x,i)=>(x,i))){offsets.Add(Encoding.ASCII.GetByteCount(output.ToString()));output.Append($"{index+1} 0 obj\n{item}\nendobj\n");}
        var xref=Encoding.ASCII.GetByteCount(output.ToString());output.Append($"xref\n0 {objects.Count+1}\n0000000000 65535 f \n");foreach(var offset in offsets.Skip(1))output.Append($"{offset:0000000000} 00000 n \n");
        output.Append($"trailer << /Size {objects.Count+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");return Encoding.ASCII.GetBytes(output.ToString());
    }

    private sealed class Canvas
    {
        private readonly StringBuilder value=new();
        internal void Text(decimal x,decimal y,string text,decimal size,bool bold=false)=>value.Append(FormattableString.Invariant($"BT /{(bold?"F2":"F1")} {size} Tf {x} {y} Td ({Escape(text)}) Tj ET\n"));
        internal void TextRight(decimal right,decimal y,string text,decimal size,bool bold=false){var width=Clean(text).Length*size*.6m;Text(Math.Max(Left,right-width),y,text,size,bold);}
        internal void Line(decimal x1,decimal y1,decimal x2,decimal y2,decimal width)=>value.Append(FormattableString.Invariant($"{width} w {x1} {y1} m {x2} {y2} l S\n"));
        internal void Fill(decimal x,decimal y,decimal width,decimal height,decimal gray)=>value.Append(FormattableString.Invariant($"q {gray} g {x} {y} {width} {height} re f Q\n"));
        internal void Rect(decimal x,decimal y,decimal width,decimal height,decimal line)=>value.Append(FormattableString.Invariant($"{line} w {x} {y} {width} {height} re S\n"));
        internal void Check(decimal x,decimal y,decimal size)
        {
            var midX=x+size*.35m;var midY=y-size*.35m;var endX=x+size;var endY=y+size*.38m;
            value.Append(FormattableString.Invariant($"1.4 w {x} {y} m {midX} {midY} l {endX} {endY} l S\n"));
        }
        public override string ToString()=>value.ToString();
    }

    private static List<string> Wrap(string? value,int width){var words=Clean(value).Split(' ',StringSplitOptions.RemoveEmptyEntries);var lines=new List<string>();var line="";foreach(var word in words){foreach(var piece in Chunk(word,width)){if(line.Length>0&&line.Length+1+piece.Length>width){lines.Add(line);line="";}line=line.Length==0?piece:line+" "+piece;}}if(line.Length>0)lines.Add(line);return lines;}
    private static IEnumerable<string> Chunk(string word,int width){for(var i=0;i<word.Length;i+=width)yield return word.Substring(i,Math.Min(width,word.Length-i));}
    private static string Clean(string? value)=>Regex.Replace(value??"",@"[^\x20-\x7E]"," ").Trim();
    private static string Escape(string value)=>Clean(value).Replace("\\","\\\\").Replace("(","\\(").Replace(")","\\)");
    private static string Clip(string value,int length)=>Clean(value).Length<=length?Clean(value):Clean(value)[..Math.Max(1,length-1)]+"~";
    private static string Dash(string? value)=>string.IsNullOrWhiteSpace(value)?"-":Clean(value);
    private static string Qty(decimal value)=>value.ToString("0.####",CultureInfo.InvariantCulture);
    private static string FormatTimestamp(string value)=>DateTimeOffset.TryParse(value,CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal,out var parsed)?parsed.ToString("yyyy-MM-dd HH:mm 'UTC'",CultureInfo.InvariantCulture):Dash(value);
    private static string Text(JsonElement e,string name)=>e.ValueKind==JsonValueKind.Object&&e.TryGetProperty(name,out var value)&&value.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined?Clean(value.ToString()):"";
    private static bool Bool(JsonElement e,string name)=>e.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.True;
    private static decimal Number(JsonElement e,string name)=>e.TryGetProperty(name,out var value)&&decimal.TryParse(value.ToString(),NumberStyles.Number,CultureInfo.InvariantCulture,out var number)?number:0;
    private static int Int(JsonElement e,string name)=>e.TryGetProperty(name,out var value)&&value.TryGetInt32(out var number)?number:0;
    private static List<string> Strings(JsonElement e,string name)=>e.TryGetProperty(name,out var values)&&values.ValueKind==JsonValueKind.Array?values.EnumerateArray().Select(x=>Clean(x.ToString())).Where(x=>x.Length>0).ToList():new();
    private sealed record PdfReport(string WorkOrder,string Assembly,string Revision,int RunNumber,string SubmissionType,int Version,string SubmittedBy,string SubmittedAt,string WoQuantity,string Unit,string Description,bool? PoTraceabilityRequired,List<string> Instructions,List<PdfGroup> Groups);
    private sealed record PdfGroup(string Sequence,string Find,string Part,List<string> Related,string Description,List<string> References,List<string> Notes,decimal Required,string Unit,string Method,decimal Picked,decimal Short,decimal Extra,string SelectedPart,string Po,List<PdfAllocation> Allocations);
    private sealed record PdfAllocation(string Part,decimal Quantity,string Po);
    private sealed class PdfPage{internal List<PdfGroup> Groups{get;}=new();}
}
