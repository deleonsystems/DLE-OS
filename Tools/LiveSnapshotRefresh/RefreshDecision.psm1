Set-StrictMode -Version Latest

function Get-LiveSnapshotRefreshDisposition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [bool] $SourceUnchanged,
        [Parameter(Mandatory)]
        [bool] $ForceFullExtraction,
        [Parameter(Mandatory)]
        [bool] $QualificationCurrentFixture
    )

    if ($ForceFullExtraction -and $QualificationCurrentFixture) {
        throw (
            'ForceFullExtraction and QualificationCurrentFixture are ' +
            'mutually exclusive.'
        )
    }
    if ($QualificationCurrentFixture) {
        return 'QUALIFICATION_CURRENT_FIXTURE'
    }
    if ($SourceUnchanged -and -not $ForceFullExtraction) {
        return 'NO_SOURCE_CHANGES'
    }
    return 'FULL_EXTRACTION'
}

Export-ModuleMember -Function Get-LiveSnapshotRefreshDisposition
