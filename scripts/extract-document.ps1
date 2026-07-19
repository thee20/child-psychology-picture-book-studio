param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath
)

$ErrorActionPreference = 'Stop'
$extension = [IO.Path]::GetExtension($InputPath).ToLowerInvariant()

if ($extension -in @('.txt', '.md', '.json')) {
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    [IO.File]::ReadAllText($InputPath, [Text.Encoding]::UTF8)
    exit 0
}

$word = $null
$document = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Open($InputPath, $false, $true)
    $text = [string]$document.Content.Text
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::Write($text)
} finally {
    if ($document) { $document.Close([ref]0) }
    if ($word) { $word.Quit() }
    if ($document) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null }
    if ($word) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

