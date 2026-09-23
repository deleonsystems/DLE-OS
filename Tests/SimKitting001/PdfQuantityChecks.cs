using System.Text;
using System.Text.Json;

internal static class PdfQuantityChecks
{
    internal static int Run()
    {
        var snapshot=JsonSerializer.Serialize(new{workOrderNumber="0999999",assemblyItemNumber="ISOLATED",revision="A",runNumber=1,
            submissionType="KIT_COMPLETE",versionNumber=1,submittedBy="Isolated Reviewer",submittedAtUtc="2026-09-23T00:00:00Z",
            draft=new{header=new{scheduledProduction="1",unitOfMeasure="EA",description="Fractional display test"},assemblyInstructions=Array.Empty<object>(),
                groups=new[]{new{actionable=true,sequence="1",findNumber="1",partNumber="SMALL-FRACTION",description="No rounding to zero",requiredQuantity=.000012500m,
                    unitOfMeasure="EA",references=Array.Empty<string>(),notes=Array.Empty<string>(),relatedParts=Array.Empty<object>(),entry=(object?)null}}}});
        var pdf=Encoding.ASCII.GetString(KittingCasePdfWriter.Create(snapshot));
        if(!pdf.Contains("0.0000125",StringComparison.Ordinal)||pdf.Contains("0.000012500",StringComparison.Ordinal))
            throw new Exception("Shared PDF quantity display lost meaningful fraction or retained unnecessary trailing zeros.");
        Console.WriteLine("PASS shared PDF keeps nonzero fractional evidence and trims trailing zeros");
        return 1;
    }
}
