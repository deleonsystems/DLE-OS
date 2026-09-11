internal static class SimRfqIntakeEndpoints
{
    private static readonly object[] Customers =
    [
        new
        {
            customerId = "SIM-CUSTOMER-ABBOTT",
            customerNumber = "990100",
            customerName = "Abbott",
            aliases = new[] { "Abbott Laboratories" },
            sources = new[] { "SIM Qualification Fixture" },
            synthetic = true
        }
    ];

    internal static void Map(WebApplication app, SimStateStore state,
        SimRfqIntakeStore store, SimPersonaSessionStore personas)
    {
        app.MapGet("/api/platform/live/v1/customer-directory/search", (HttpContext context) =>
        {
            var denied = Denied(context, state, personas, write: false);
            if (denied is not null) return denied;
            var query = context.Request.Query["q"].ToString().Trim();
            var items = Customers.Where(item => string.IsNullOrWhiteSpace(query) ||
                item.ToString()!.Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();
            return Results.Json(new
            {
                query,
                items,
                returnedCount = items.Length,
                totalItems = items.Length,
                page = 1,
                pageSize = 25,
                totalPages = items.Length == 0 ? 0 : 1,
                hasMore = false,
                environment = "SIM",
                synthetic = true
            });
        });

        app.MapPost("/api/sim/intake-drafts/{draft}/documents", async Task<IResult> (string draft, HttpContext context) =>
        {
            var denied = Denied(context, state, personas, true); if (denied is not null) return denied;
            if (!context.Request.Headers.ContainsKey("X-SIM-Document-Upload")) return Results.StatusCode(400);
            try { return Results.Json(await store.StageDocument(draft, context.Request.Query["name"].ToString(), long.TryParse(context.Request.Query["lastModified"], out var modified) ? modified : 0, context.Request.Body, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "SIM could not write and verify the file. Intake was not submitted." }, statusCode: 503); }
        });
        app.MapDelete("/api/sim/intake-drafts/{draft}/documents/{id}", async Task<IResult> (string draft, string id, HttpContext context) =>
        {
            var denied = Denied(context, state, personas, true); if (denied is not null) return denied;
            try { await store.RemoveStagedDocument(draft,id,personas.Resolve(context)); return Results.NoContent(); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
        });
        app.MapGet("/api/sim/rfq-intakes/{intakeId}/documents/{id}", async Task<IResult> (string intakeId, string id, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context,state,personas,"technical_review.view"); if (denied is not null) return denied;
            try
            {
                var result = await store.OpenDocument(intakeId,id);
                context.Response.Headers["X-Content-Type-Options"] = "nosniff";
                context.Response.Headers["Cache-Control"] = "private, no-store";
                var disposition = new System.Net.Http.Headers.ContentDispositionHeaderValue(result.Document.Type == "application/pdf" && context.Request.Query["download"] != "true" ? "inline" : "attachment") { FileNameStar = result.Document.Name };
                context.Response.Headers["Content-Disposition"] = disposition.ToString();
                return Results.File(result.Bytes,result.Document.Type,enableRangeProcessing:true);
            }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { message = p.Message, code = p.Code }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "SIM document storage is unavailable." }, statusCode: 503); }
        });

        app.MapPost("/api/sim/rfq-intakes", async Task<IResult> (
            SimRfqIntakeCreateRequest request, HttpContext context) =>
        {
            var denied = Denied(context, state, personas, write: true);
            if (denied is not null) return denied;
            try
            {
                var result = await store.CreateAsync(request, personas.Resolve(context), state.Current.Metadata!);
                return Results.Json(result, statusCode: StatusCodes.Status201Created);
            }
            catch (SimRfqIntakeProblem problem)
            {
                return Results.Json(new { code = problem.Code, message = problem.Message, environment = "SIM" },
                    statusCode: problem.StatusCode);
            }
        });

        app.MapGet("/api/sim/rfq-intakes/{intakeId}", async Task<IResult> (
            string intakeId, HttpContext context) =>
        {
            var denied = Denied(context, state, personas, write: false);
            if (denied is not null) return denied;
            var record = await store.ReadAsync(intakeId);
            return record is null
                ? Results.Json(new { code = "DLE_OS_SIM_RFQ_INTAKE_NOT_FOUND", message = "The SIM RFQ Intake does not exist." }, statusCode: 404)
                : Results.Json(record);
        });

        app.MapGet("/api/sim/technical-reviews", async Task<IResult> (HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.view");
            if (denied is not null) return denied;
            return Results.Json(await store.ListTechnicalReviewsAsync());
        });

        app.MapGet("/api/sim/technical-reviews/{intakeId}", async Task<IResult> (
            string intakeId, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.view");
            if (denied is not null) return denied;
            var review = await store.ReadTechnicalReviewAsync(intakeId);
            return review is null
                ? Results.Json(new { code = "DLE_OS_SIM_TECHNICAL_REVIEW_NOT_FOUND", message = "The SIM Technical Review item does not exist." }, statusCode: 404)
                : Results.Json(review);
        });

        app.MapPost("/api/sim/technical-reviews/{intakeId}/assembly-history",
            (string intakeId, HttpContext context) => UpdateHistory(intakeId, null, context));
        app.MapPut("/api/sim/technical-reviews/{intakeId}/assembly-classification",
            (string intakeId, SimAssemblyClassificationRequest request, HttpContext context) =>
                UpdateHistory(intakeId, request.AssemblyClassification ?? "", context));

        async Task<IResult> UpdateHistory(string intakeId, string? classification, HttpContext context)
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try { return Results.Json(await store.UpdateAssemblyHistoryAsync(intakeId, classification, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem problem)
            {
                return Results.Json(new { code = problem.Code, message = problem.Message, environment = "SIM" }, statusCode: problem.StatusCode);
            }
        }

        app.MapPut("/api/sim/technical-reviews/{intakeId}/technical-package", async Task<IResult> (string intakeId, SimPackageRequest request, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try { return Results.Json(await store.ReviewMaterialsAsync(intakeId, personas.Resolve(context), request, inventoryOnly: true)); }
            catch (SimRfqIntakeProblem problem)
            {
                return Results.Json(new { code = problem.Code, message = problem.Message, environment = "SIM" }, statusCode: problem.StatusCode);
            }
        });

        app.MapPost("/api/sim/technical-reviews/{intakeId}/materials-definition", async Task<IResult> (string intakeId, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try { return Results.Json(await store.ReviewMaterialsAsync(intakeId, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem problem)
            {
                return Results.Json(new { code = problem.Code, message = problem.Message, environment = "SIM" }, statusCode: problem.StatusCode);
            }
        });

        app.MapPost("/api/sim/technical-reviews/{intakeId}/complete-bom-review", async Task<IResult> (string intakeId, SimBomCompletionRequest request, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try { return Results.Json(await store.CompleteBomReview(intakeId, request, personas.Resolve(context))); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { code = p.Code, message = p.Message }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "BOM Review could not be saved. Reopen before retrying." }, statusCode: 503); }
        });
        app.MapPost("/api/sim/technical-reviews/{intakeId}/candidate-bom", (string intakeId, HttpContext context) => Candidate(intakeId, null, context));
        app.MapPost("/api/sim/technical-reviews/{intakeId}/analysis-jobs", async Task<IResult> (string intakeId, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try { return Results.Json(await store.SubmitAnalysis(intakeId, personas.Resolve(context)), statusCode: 202); }
            catch (SimRfqIntakeProblem p) { return Results.Json(new { code = p.Code, message = p.Message }, statusCode: p.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "Analysis storage is unavailable." }, statusCode: 503); }
        });
        app.MapGet("/api/sim/technical-reviews/{intakeId}/analysis-jobs/latest", async Task<IResult> (string intakeId, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.view");
            if (denied is not null) return denied;
            try { return Results.Json(new { job = await store.LatestAnalysis(intakeId) }); }
            catch (IOException) { return Results.Json(new { message = "Analysis storage is unavailable." }, statusCode: 503); }
        });
        app.MapPut("/api/sim/technical-reviews/{intakeId}/candidate-bom", (string intakeId, SimCandidateReviewRequest request, HttpContext context) => Candidate(intakeId, request, context));
        async Task<IResult> Candidate(string intakeId, SimCandidateReviewRequest? request, HttpContext context)
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try { return Results.Json(await store.CandidateBomAsync(intakeId, personas.Resolve(context), request)); }
            catch (SimRfqIntakeProblem problem) { return Results.Json(new { code = problem.Code, message = problem.Message }, statusCode: problem.StatusCode); }
            catch (IOException) { return Results.Json(new { message = "SIM candidate storage is unavailable; reopen before retrying." }, statusCode: 503); }
        }

        app.MapDelete("/api/sim/technical-reviews/{intakeId}", async Task<IResult> (
            string intakeId, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try
            {
                return Results.Json(await store.DeleteTechnicalReviewAsync(intakeId));
            }
            catch (SimRfqIntakeProblem problem)
            {
                return Results.Json(new { code = problem.Code, message = problem.Message, environment = "SIM" },
                    statusCode: problem.StatusCode);
            }
        });

        app.MapPut("/api/sim/technical-reviews/{intakeId}/disposition", async Task<IResult> (
            string intakeId, SimTechnicalReviewDispositionRequest request, HttpContext context) =>
        {
            var denied = DeniedTechnicalReview(context, state, personas, "technical_review.disposition");
            if (denied is not null) return denied;
            try
            {
                var result = await store.SaveTechnicalReviewAsync(
                    intakeId, request, personas.Resolve(context));
                return Results.Json(result);
            }
            catch (SimRfqIntakeProblem problem)
            {
                return Results.Json(new { code = problem.Code, message = problem.Message, environment = "SIM" },
                    statusCode: problem.StatusCode);
            }
        });
    }

    private static IResult? Denied(HttpContext context, SimStateStore state,
        SimPersonaSessionStore personas, bool write)
    {
        if (!state.Current.IsHealthy)
            return Results.Json(new { code = state.Current.ErrorCode, message = state.Current.Message, environment = "SIM" }, statusCode: 503);
        var persona = personas.Resolve(context);
        if (!persona.IsActive)
            return Results.Json(new { code = "DLE_OS_USER_DISABLED", message = "The selected synthetic persona is disabled." }, statusCode: 403);
        if (write && !persona.Can("rfq.intake.create"))
            return Results.Json(new { code = "DLE_OS_PERMISSION_DENIED", message = "The selected SIM persona cannot create RFQ intakes.", requiredPermission = "rfq.intake.create" }, statusCode: 403);
        return null;
    }

    private static IResult? DeniedTechnicalReview(HttpContext context, SimStateStore state,
        SimPersonaSessionStore personas, string permission)
    {
        if (!state.Current.IsHealthy)
            return Results.Json(new { code = state.Current.ErrorCode, message = state.Current.Message, environment = "SIM" }, statusCode: 503);
        var persona = personas.Resolve(context);
        if (!persona.IsActive)
            return Results.Json(new { code = "DLE_OS_USER_DISABLED", message = "The selected synthetic persona is disabled." }, statusCode: 403);
        if (!persona.Can(permission))
            return Results.Json(new { code = "DLE_OS_PERMISSION_DENIED", message = "The selected SIM persona cannot access this Technical Review action.", requiredPermission = permission }, statusCode: 403);
        return null;
    }
}
