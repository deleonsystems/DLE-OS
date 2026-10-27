#nullable enable
// Candidate policy component, not wired into HOST. Never replaces existing DEV authorization.
internal sealed record Phase1Qualification(bool Enabled,bool IdentityBound,bool StoreApproved,bool ServiceBound);
internal sealed record Phase1Decision(int Status,string Code,string? Permission=null);
internal static class Phase1IncomingBoundary
{
    internal static Phase1Decision Decide(string method,string path,Phase1Qualification config,bool authenticated,Func<string,bool> trustedPermission,bool antiforgeryValid,long? length=null)
    {
        if(path.Equals("/api/sim",StringComparison.OrdinalIgnoreCase)||path.StartsWith("/api/sim/",StringComparison.OrdinalIgnoreCase))return new(404,"SIM_ROUTE_NOT_EXPOSED");
        if(!path.Equals("/api/quoting/v1",StringComparison.OrdinalIgnoreCase)&&!path.StartsWith("/api/quoting/v1/",StringComparison.OrdinalIgnoreCase))return new(0,"DEFER_EXISTING_CONTRACT");
        if(!(config.Enabled&&config.IdentityBound&&config.StoreApproved&&config.ServiceBound))return new(503,"QUOTING_INTEGRATION_UNAVAILABLE");
        if(!authenticated)return new(401,"AUTHENTICATION_REQUIRED");
        // These five draft contracts illustrate fail-closed integration. The full
        // exact route inventory still requires explicit HOST review/binding.
        var permission=(method,path) switch {
            ("GET" or "POST","/api/quoting/v1/intakes")=>"rfq.intake.create",
            ("GET","/api/quoting/v1/technical-reviews")=>"technical_review.view",
            ("GET","/api/quoting/v1/library")=>"assembly_library.view",
            ("GET","/api/quoting/v1/rfqs")=>"rfq.view",_=>null};
        if(permission is null)return new(404,"QUOTING_ROUTE_NOT_MAPPED");
        if(!trustedPermission(permission))return new(403,"QUOTING_PERMISSION_DENIED");
        if(method is not("GET" or "HEAD")&&!antiforgeryValid)return new(403,"ANTIFORGERY_REQUIRED");
        if(length>2*1024*1024)return new(413,"QUOTING_BODY_LIMIT");
        return new(200,"CANDIDATE_CONTRACT_ONLY",permission);
    }
}
