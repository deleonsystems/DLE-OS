[CmdletBinding()]
param(
    [string] $BaseUrl =
        'http://DLE-OS-HOST:5052/api/platform/live/v1/' +
        'sales-order-work-order-relationships'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True {
    param(
        [bool] $Condition,
        [string] $Message
    )
    if (-not $Condition) { throw $Message }
}

function Get-Relationships {
    param([string] $Query)
    return Invoke-RestMethod `
        -UseDefaultCredentials `
        -Uri ($BaseUrl + '?' + $Query)
}

$all = Get-Relationships 'page=1&pageSize=200'
Assert-True ($all.totalItems -eq 108) 'Unfiltered total is not 108.'
Assert-True (@($all.items).Count -eq 108) 'Unfiltered response is incomplete.'

$page1 = Get-Relationships 'page=1&pageSize=25'
$page2 = Get-Relationships 'page=2&pageSize=25'
Assert-True (@($page1.items).Count -eq 25) 'Page 1 size is incorrect.'
Assert-True (@($page2.items).Count -eq 25) 'Page 2 size is incorrect.'
$page1Keys = @($page1.items | ForEach-Object {
    "$($_.customerNumber)|$($_.salesOrderNumber)|$($_.salesOrderLineNumber)"
})
$page2Keys = @($page2.items | ForEach-Object {
    "$($_.customerNumber)|$($_.salesOrderNumber)|$($_.salesOrderLineNumber)"
})
Assert-True (
    @($page1Keys | Where-Object { $_ -in $page2Keys }).Count -eq 0
) 'Adjacent pages overlap.'

$customer = Get-Relationships (
    'page=1&pageSize=200&customerNumber=001082')
Assert-True (
    @($customer.items | Where-Object {
        $_.customerNumber -ne '001082'
    }).Count -eq 0
) 'Customer filter returned another customer.'

$order = Get-Relationships (
    'page=1&pageSize=200&salesOrderNumber=0012088')
Assert-True (
    @($order.items | Where-Object {
        $_.salesOrderNumber -ne '0012088'
    }).Count -eq 0
) 'Sales Order filter returned another order.'

$line = Get-Relationships (
    'page=1&pageSize=200&salesOrderLineNumber=010')
Assert-True (
    @($line.items | Where-Object {
        $_.salesOrderLineNumber -ne '010'
    }).Count -eq 0
) 'Sales Order line filter returned another line.'

$workOrder = Get-Relationships (
    'page=1&pageSize=200&workOrderNumber=0115350')
Assert-True ($workOrder.totalItems -eq 1) 'Work Order filter context is incorrect.'
$aero = @($workOrder.items)[0]
Assert-True (
    $aero.resolutionStatus -eq 'AMBIGUOUS'
) 'Work Order filter collapsed the AERO FLUID ambiguity.'
Assert-True ($aero.candidateCount -eq 2) 'Candidate count was reduced.'
$aeroCandidates = @($aero.candidates | ForEach-Object workOrderNumber)
Assert-True (
    '0115350' -in $aeroCandidates -and '0115417' -in $aeroCandidates
) 'Work Order filter omitted a governed candidate.'

$combined = Get-Relationships (
    'page=1&pageSize=200&customerNumber=001165&' +
    'salesOrderNumber=0011824&salesOrderLineNumber=090&' +
    'workOrderNumber=0115350')
Assert-True ($combined.totalItems -eq 1) 'Combined filter returned the wrong context.'
Assert-True (
    @($combined.items)[0].candidateCount -eq 2
) 'Combined filter reduced the complete candidate list.'

$empty = Get-Relationships (
    'page=1&pageSize=200&customerNumber=999999&salesOrderNumber=9999999')
Assert-True ($empty.totalItems -eq 0) 'Empty filter returned a nonzero total.'
Assert-True (@($empty.items).Count -eq 0) 'Empty filter returned rows.'

foreach ($relationship in $all.items) {
    Assert-True (
        $relationship.candidateCount -eq @($relationship.candidates).Count
    ) 'candidateCount does not match the complete candidate array.'
    $isExact = $relationship.resolutionStatus -eq 'EXACT_LINE_UNIQUE'
    Assert-True (
        $isExact -eq -not [string]::IsNullOrWhiteSpace(
            $relationship.actionableWorkOrderNumber)
    ) 'Relationship actionability does not match exact-line uniqueness.'
}

Write-Output 'WORKORDER-RELATIONSHIP-001 runtime HTTP contract: PASS'
