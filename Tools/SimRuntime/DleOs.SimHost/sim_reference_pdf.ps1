param([Parameter(Mandatory=$true)][string]$InputPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
$word=$null;$doc=$null;$options=$null
try {
    $word=New-Object -ComObject Word.Application
    $word.Visible=$false
    $word.DisplayAlerts=0
    $word.AutomationSecurity=3
    $options=@($word.Options.UpdateLinksAtOpen,$word.Options.UpdateFieldsAtPrint,$word.Options.UpdateLinksAtPrint)
    $word.Options.UpdateLinksAtOpen=$false
    $word.Options.UpdateFieldsAtPrint=$false
    $word.Options.UpdateLinksAtPrint=$false
    $doc=$word.Documents.Open([ref]$InputPath,[ref]$false,[ref]$true,[ref]$false)
    $doc.ExportAsFixedFormat($OutputPath,17)
} finally {
    if($doc){$doc.Close([ref]0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)}
    if($word){if($options){$word.Options.UpdateLinksAtOpen=$options[0];$word.Options.UpdateFieldsAtPrint=$options[1];$word.Options.UpdateLinksAtPrint=$options[2]};$word.Quit([ref]0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)}
}
