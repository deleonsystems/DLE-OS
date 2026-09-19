param([string]$Directory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
function Await($op,$type){$t=$asTask.MakeGenericMethod($type).Invoke($null,@($op));$t.Wait();$t.Result}
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'A local Windows OCR recognizer is required.' }
Get-ChildItem $Directory -Filter 'page-*.png' | ForEach-Object {
 $file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($_.FullName)) ([Windows.Storage.StorageFile])
 $stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
 $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 $result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
 $words=@(foreach($line in $result.Lines){foreach($word in $line.Words){@{text=$word.Text;x=$word.BoundingRect.X;y=$word.BoundingRect.Y;w=$word.BoundingRect.Width;h=$word.BoundingRect.Height}}})
 @{text=$result.Text;angle=$result.TextAngle;words=$words} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $Directory ($_.BaseName+'.ocr.json')) -Encoding UTF8
 Write-Output ($_.BaseName+': '+$words.Count+' words');$bitmap.Dispose();$stream.Dispose()
}
