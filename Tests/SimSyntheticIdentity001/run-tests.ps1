[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\DleOs.SimHost.csproj'
$catalogSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimPersonaCatalog.cs'
$rendererSource = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\SimShellRenderer.cs'
$identitySource = Join-Path $repository 'Tools\DevelopmentRuntime\DleOs.DevelopmentFrontend\DevelopmentIdentityUi.cs'
$workspaceShellSource = Join-Path $repository 'SRC\shell\workspace-shell.js'
$testPort = 5197
$baseUri = "http://127.0.0.1:$testPort"
$testRoot = Join-Path $repository '.sim-state\identity-qualification'
$stdout = Join-Path $testRoot 'host.stdout.log'
$stderr = Join-Path $testRoot 'host.stderr.log'
$checks = [Collections.Generic.List[string]]::new()

function Require($Condition, [string] $Message) {
    if ($Condition -is [Array]) { throw "FAIL: non-Boolean test result for $Message" }
    if (-not [bool]$Condition) { throw "FAIL: $Message" }
    $checks.Add($Message)
}

function Read-Text([string] $Path) {
    return [IO.File]::ReadAllText($Path)
}

function Invoke-SimHttp {
    param(
        [Microsoft.PowerShell.Commands.WebRequestSession] $Session,
        [string] $Method,
        [string] $Path,
        [object] $Body
    )
    $parameters = @{
        Uri = $baseUri + $Path
        Method = $Method
        WebSession = $Session
        UseBasicParsing = $true
        TimeoutSec = 5
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $Body | ConvertTo-Json -Compress
    }
    try {
        $response = Invoke-WebRequest @parameters
        $text = $response.Content
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body = $(if ([string]::IsNullOrWhiteSpace($text)) { $null } else { $text | ConvertFrom-Json })
        }
    }
    catch {
        $response = $_.Exception.Response
        $text = [string]$_.ErrorDetails.Message
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body = $(if ([string]::IsNullOrWhiteSpace($text)) { $null } else { $text | ConvertFrom-Json })
        }
    }
}

function Select-Persona($Session, [string] $PersonaId) {
    $selection = Invoke-SimHttp $Session 'POST' '/api/sim/persona' @{ personaId = $PersonaId }
    Require ($selection.Status -eq 200 -and $selection.Body.selectedPersonaId -eq $PersonaId) "persona selection succeeds: $PersonaId"
}

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
& dotnet build $project --nologo --verbosity quiet
if ($LASTEXITCODE -ne 0) { throw 'FAIL: SIM synthetic identity build failed.' }
$checks.Add('SIM synthetic identity host builds')

$catalogText = Read-Text $catalogSource
$rendererText = Read-Text $rendererSource
$identityText = Read-Text $identitySource
$workspaceShellText = Read-Text $workspaceShellSource

foreach ($personaId in @('administrator','operations-manager','kitting-operator','shipping-operator','read-only-viewer','no-access','disabled')) {
    Require ($catalogText -match [regex]::Escape('"' + $personaId + '"')) "persona catalog declares $personaId"
}
Require ($catalogText -match 'DefaultPersonaId = "administrator"') 'default persona is deterministic'
Require ($catalogText -match 'synthetic = true') 'current-user and catalog contracts explicitly mark synthetic identities'
Require ($catalogText -match 'HttpOnly = true' -and $catalogText -match 'SameSiteMode.Strict') 'persona selection uses an opaque same-site HTTP-only session'
Require ($rendererText -match '/api/sim/persona' -and $rendererText -match 'window.location.reload') 'persona switching invalidates stale browser capability state'
Require ($rendererText -match 'dleSimPersonaRecovery') 'disabled identity retains a SIM persona recovery control'
Require ($identityText -match "shipping:'shipments.view'" -and $identityText -match "'invoice-history':'sync.operations'") 'shared workspace selector uses established Shipping and Invoice permissions'
Require ($workspaceShellText -match 'hasAuthorizedWorkspace' -and $workspaceShellText -match '!option.disabled') 'workspace selector is available to authorized non-admin personas'

$existingListener = Get-NetTCPConnection -State Listen -LocalPort $testPort -ErrorAction SilentlyContinue
Require ($null -eq $existingListener) 'identity qualification port is free before startup'

$hostProcess = $null
try {
    $env:DLE_OS_SIM_PORT = [string]$testPort
    $dll = Join-Path $repository 'Tools\SimRuntime\DleOs.SimHost\bin\Debug\net8.0\DleOs.SimHost.dll'
    $hostProcess = Start-Process dotnet -ArgumentList @($dll) -WorkingDirectory $repository `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue

    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($hostProcess.HasExited) { break }
        try {
            $probe = Invoke-RestMethod -Uri "$baseUri/api/sim/status" -TimeoutSec 1
            $ready = $probe.status -eq 'READY'
            if ($ready) { break }
        }
        catch { Start-Sleep -Milliseconds 100 }
    }
    Require $ready 'SIM starts for synthetic identity qualification'

    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $catalog = Invoke-SimHttp $session 'GET' '/api/sim/personas' $null
    Require ($catalog.Status -eq 200 -and @($catalog.Body.personas).Count -eq 7) 'persona catalog endpoint returns seven deterministic personas'
    Require ($catalog.Body.defaultPersonaId -eq 'administrator' -and $catalog.Body.currentPersonaId -eq 'administrator') 'new browser session defaults to SIM Administrator'
    Require (@($catalog.Body.personas | Where-Object { -not $_.synthetic }).Count -eq 0) 'every exposed persona is synthetic'

    $administrator = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    Require ($administrator.Status -eq 200 -and $administrator.Body.user.displayName -eq 'SIM Administrator') 'default current-user identity is SIM Administrator'
    Require ($administrator.Body.isSuperAdmin -and @($administrator.Body.permissions).Count -eq 0) 'SUPER_ADMIN uses bypass semantics without enumerated grants'
    Require ($administrator.Body.synthetic -and $administrator.Body.environment -eq 'SIM') 'default current-user contract carries synthetic SIM markers'

    Select-Persona $session 'operations-manager'
    $operations = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    Require ($operations.Status -eq 200 -and $operations.Body.roles -contains 'SIM_OPERATIONS_MANAGER') 'Operations Manager role projects through current-user contract'
    Require ($operations.Body.permissions -contains 'sync.operations' -and $operations.Body.permissions -contains 'operations-center.verified-status.write') 'Operations Manager receives established Operations Center permissions'
    Require ((Invoke-SimHttp $session 'GET' '/api/sync/operations/current' $null).Status -eq 501) 'authorized Operations route reaches only the local unimplemented boundary'

    Select-Persona $session 'kitting-operator'
    $kitting = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    Require ($kitting.Body.permissions -contains 'kitting.view' -and $kitting.Body.permissions -contains 'kitting.disposition') 'Kitting Operator uses repository-qualified Kitting permissions'
    Require ((Invoke-SimHttp $session 'GET' '/api/kitting-dispositions/v1/work-orders/0000001' $null).Status -eq 501) 'Kitting Operator passes server-side Kitting read authorization'
    $kittingShipping = Invoke-SimHttp $session 'GET' '/api/shipment-staging/v1/shipments' $null
    Require ($kittingShipping.Status -eq 403 -and $kittingShipping.Body.requiredPermission -eq 'shipments.view') 'Kitting Operator is denied Shipping server-side'

    Select-Persona $session 'shipping-operator'
    $shipping = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    Require ($shipping.Body.permissions -contains 'shipments.view' -and $shipping.Body.permissions -contains 'shipments.stage') 'Shipping Operator uses repository-qualified Shipping permissions'
    Require ((Invoke-SimHttp $session 'GET' '/api/shipment-staging/v1/shipments' $null).Status -eq 501) 'Shipping Operator passes server-side Shipping read authorization'
    $shippingKitting = Invoke-SimHttp $session 'POST' '/api/kitting-dispositions/v1/work-orders/0000001/events' @{}
    Require ($shippingKitting.Status -eq 403 -and $shippingKitting.Body.requiredPermission -eq 'kitting.disposition') 'Shipping Operator is denied Kitting mutation server-side'

    Select-Persona $session 'read-only-viewer'
    $viewer = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    $writePermissions = @($viewer.Body.permissions | Where-Object { $_ -in @('work_orders.approve','work_orders.replace','work_orders.revoke','work_orders.mark_no_work_order_required','kitting.disposition','rma_rework.manage','shipments.stage','shipments.cancel','shipments.confirm','shipments.reconcile','sync.operations','operations-center.verified-status.write') })
    Require ($viewer.Status -eq 200 -and $writePermissions.Count -eq 0) 'Read-Only Viewer receives no write or synchronization permission'
    Require ((Invoke-SimHttp $session 'GET' '/api/shipment-staging/v1/shipments' $null).Status -eq 501) 'Read-Only Viewer passes Shipping read authorization'
    $viewerWrite = Invoke-SimHttp $session 'POST' '/api/shipment-staging/v1/shipments' @{}
    Require ($viewerWrite.Status -eq 403 -and $viewerWrite.Body.requiredPermission -eq 'shipments.stage') 'Read-Only Viewer is denied Shipping mutation server-side'

    Select-Persona $session 'no-access'
    $noAccess = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    Require ($noAccess.Status -eq 200 -and @($noAccess.Body.permissions).Count -eq 0 -and -not $noAccess.Body.isSuperAdmin) 'No-Access User remains authenticated with no capabilities'
    Require ((Invoke-SimHttp $session 'GET' '/api/platform/live/v1/work-orders' $null).Status -eq 403) 'No-Access User is denied a mapped workspace route server-side'

    Select-Persona $session 'disabled'
    $disabled = Invoke-SimHttp $session 'GET' '/api/auth/me' $null
    Require ($disabled.Status -eq 403 -and $disabled.Body.error.code -eq 'DLE_OS_USER_DISABLED') 'Disabled User receives the established disabled current-user response'
    Require ((Invoke-SimHttp $session 'GET' '/api/shipment-staging/v1/shipments' $null).Status -eq 403) 'disabled status overrides assigned Shipping permissions server-side'

    Select-Persona $session 'administrator'
    $governed = Invoke-SimHttp $session 'POST' '/api/sync/operations' @{}
    Require ($governed.Status -eq 501 -and $governed.Body.code -eq 'DLE_OS_SIM_BUSINESS_CONTRACT_UNAVAILABLE') 'SIM Administrator cannot execute governed synchronization'
    $invalid = Invoke-SimHttp $session 'POST' '/api/sim/persona' @{ personaId = 'unknown-persona' }
    Require ($invalid.Status -eq 400 -and $invalid.Body.code -eq 'DLE_OS_SIM_PERSONA_UNKNOWN') 'unknown persona selection fails closed'

    $freshSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $freshUser = Invoke-SimHttp $freshSession 'GET' '/api/auth/me' $null
    Require ($freshUser.Body.personaId -eq 'administrator') 'independent browser session starts deterministically as administrator'

    $shell = Invoke-WebRequest -UseBasicParsing -Uri "$baseUri/" -TimeoutSec 5
    Require ($shell.Content -match 'dleSimPersonaControl' -and $shell.Content -match 'dleSimPersonaRecovery') 'shared shell contains active and disabled-state persona controls'
    Require ($shell.Content -match "fetch\('/api/auth/me'" -and $shell.Content -notmatch 'JSON\.parse\(atob') 'shared shell consumes the normal current-user endpoint without embedded identity'
    Require ($shell.Content -match '#invoiceHistorySyncButton' -and $shell.Content -match '#syncOperationsButton') 'governed execution controls remain suppressed for every persona'
}
finally {
    Remove-Item Env:DLE_OS_SIM_PORT -ErrorAction SilentlyContinue
    if ($null -ne $hostProcess -and -not $hostProcess.HasExited) {
        Stop-Process -Id $hostProcess.Id -Force
        $hostProcess.WaitForExit()
    }
}

Require ($hostProcess.HasExited) 'synthetic identity qualification host stops cleanly'

Write-Host "PASS: $($checks.Count) DLE-OS SIM synthetic identity checks."
$checks | ForEach-Object { Write-Host "  - $_" }
