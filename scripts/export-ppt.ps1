param(
    [Parameter(Mandatory = $true)]
    [string]$JsonPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$data = [IO.File]::ReadAllText($JsonPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$powerPoint = $null
$presentation = $null
try {
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $presentation = $powerPoint.Presentations.Add()
    $presentation.PageSetup.SlideSize = 15 # 16:9

    $index = 1
    foreach ($item in @($data.slides)) {
        $layout = if ($index -eq 1) { 1 } else { 2 }
        $slide = $presentation.Slides.Add($index, $layout)
        $slide.FollowMasterBackground = $false
        $slide.Background.Fill.ForeColor.RGB = 0xF7F4EC

        $slide.Shapes.Title.TextFrame.TextRange.Text = [string]$item.title
        $titleRange = $slide.Shapes.Title.TextFrame.TextRange
        $titleRange.Font.NameFarEast = '微软雅黑'
        $titleRange.Font.Name = 'Microsoft YaHei'
        $titleRange.Font.Color.RGB = 0x315A4C
        $titleRange.Font.Bold = $true

        if ($layout -eq 1) {
            $subtitle = $slide.Shapes.Placeholders.Item(2).TextFrame.TextRange
            $subtitleText = if ($item.subtitle) { [string]$item.subtitle } else { [string]$data.subtitle }
            $subtitle.Text = $subtitleText
            $subtitle.Font.NameFarEast = '微软雅黑'
            $subtitle.Font.Name = 'Microsoft YaHei'
            $subtitle.Font.Color.RGB = 0x6D766F
        } else {
            $body = $slide.Shapes.Placeholders.Item(2).TextFrame.TextRange
            $body.Text = (@($item.bullets) | ForEach-Object { [string]$_ }) -join "`r"
            $body.Font.NameFarEast = '微软雅黑'
            $body.Font.Name = 'Microsoft YaHei'
            $body.Font.Size = 24
            $body.Font.Color.RGB = 0x29352F
            for ($paragraph = 1; $paragraph -le $body.Paragraphs().Count; $paragraph++) {
                $body.Paragraphs($paragraph).ParagraphFormat.Bullet.Visible = -1
            }
            if ($item.notes) {
                $notesText = [string]$item.notes
                foreach ($shape in @($slide.NotesPage.Shapes)) {
                    if ($shape.PlaceholderFormat.Type -eq 2) {
                        $shape.TextFrame.TextRange.Text = $notesText
                        break
                    }
                }
            }
        }
        $index++
    }

    $presentation.SaveAs($OutputPath, 24) # ppSaveAsOpenXMLPresentation
} finally {
    if ($presentation) { $presentation.Close() }
    if ($powerPoint) { $powerPoint.Quit() }
    if ($presentation) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) | Out-Null }
    if ($powerPoint) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint) | Out-Null }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
