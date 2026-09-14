internal static class LocalProviderChecks
{
    internal static async Task Run(DleAnalysisInput input, DleAnalysisDocument[] documents, DleAnalysisResult fixtureResult)
    {
        void Check(bool value,string name) { if(!value)throw new Exception("FAIL: "+name);Console.WriteLine("PASS: local routing "+name); }
        var hosted=new CountingProvider(fixtureResult); var local=new CountingProvider(fixtureResult);
        var router=new PolicyAnalysisProvider(hosted,local);
        await router.ExecuteAnalysisJob(input,documents,"",default);
        Check(hosted.Calls==0 && local.Calls==1,"unapproved sources never enter hosted adapter");
        var result=await new LocalDocumentAnalysisProvider().ExecuteAnalysisJob(input,documents,"",default);
        DleAnalysisContract.Validate(input,result.Result);
        Check(result.Provider==DleAnalysisPolicy.Local && result.Result.Rows.Length>0,"local PDF parser returns shared result contract");
        Check(result.Result.Rows.All(r=>r.Fields.Values.All(f=>f.Relationship=="NOT_COMPARED" && f.SupportingEvidence is null)),"no invented supporting agreement");
        var bad=documents.Select(d=>d.Source.DocumentId==input.GoverningDocumentId ? new DleAnalysisDocument(d.Source with {Sha256=DleAnalysisContract.Hash([1,2,3])},[1,2,3]) : d).ToArray();
        var failed=await new LocalDocumentAnalysisProvider().ExecuteAnalysisJob(input,bad,"",default);
        Check(failed.Result.Outcome=="BLOCKED" && hosted.Calls==0,"invalid PDF blocks without hosted fallback");
        try { await new CodexAppServerAnalysisProvider("unused").ExecuteAnalysisJob(input with {ProviderRoute=DleAnalysisPolicy.Hosted},documents,"",default);throw new Exception("Hosted accepted unapproved sources"); }
        catch(IOException) { Check(true,"direct hosted adapter enforces approval"); }
        Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256",string.Join(',',documents.Select(d=>d.Source.Sha256)));
        Check(DleAnalysisPolicy.Select(documents)==DleAnalysisPolicy.Hosted,"all approved sources select hosted");
        await router.ExecuteAnalysisJob(input with {ProviderRoute=DleAnalysisPolicy.Hosted},documents,"",default);
        Check(hosted.Calls==1,"approved hosted dispatch");
        await router.ExecuteAnalysisJob(input,documents,"",default);
        Check(hosted.Calls==1 && local.Calls==2,"local job stays local after allowlist changes");
        Environment.SetEnvironmentVariable("DLE_OS_SIM_ANALYSIS_APPROVED_SHA256",documents[0].Source.Sha256);
        Check(DleAnalysisPolicy.Select(documents)==DleAnalysisPolicy.Local,"mixed approval routes entire package locally");
        try { await router.ExecuteAnalysisJob(input with {ProviderRoute=DleAnalysisPolicy.Hosted},documents,"",default);throw new Exception("Revoked approval dispatched"); }
        catch(IOException) { Check(hosted.Calls==1,"revoked hosted approval blocks dispatch"); }
    }
    private sealed class CountingProvider(DleAnalysisResult result):IAnalysisProvider
    {
        internal int Calls;
        public Task<DleAnalysisResponse> ExecuteAnalysisJob(DleAnalysisInput input,DleAnalysisDocument[] docs,string instructions,CancellationToken cancellationToken) { Calls++;return Task.FromResult(new DleAnalysisResponse(result,"TEST","1","none")); }
    }
}
