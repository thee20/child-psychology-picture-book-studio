param(
    [Parameter(Mandatory = $true)]
    [string]$JsonPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$data = [IO.File]::ReadAllText($JsonPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$word = $null
$document = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Add()
    $selection = $word.Selection

    function Add-Paragraph([string]$Text, [int]$Style = 0) {
        if ($Style -gt 0) { $selection.Style = $document.Styles.Item($Style) }
        $selection.TypeText($Text)
        $selection.TypeParagraph()
    }

    Add-Paragraph ([string]$data.title) -2
    Add-Paragraph ("年级：{0}    课时：{1}    主题：{2}" -f $data.grade, $data.duration, $data.theme)
    Add-Paragraph '一、学情分析' -3
    Add-Paragraph ([string]$data.studentAnalysis)
    Add-Paragraph '二、教学目标' -3
    foreach ($item in @($data.objectives)) { Add-Paragraph ("• " + [string]$item) }
    Add-Paragraph '三、教学重点与难点' -3
    Add-Paragraph ("重点：" + [string]$data.keyPoint)
    Add-Paragraph ("难点：" + [string]$data.difficulty)
    Add-Paragraph '四、教学准备' -3
    foreach ($item in @($data.materials)) { Add-Paragraph ("• " + [string]$item) }
    Add-Paragraph '五、教学过程' -3
    foreach ($phase in @($data.phases)) {
        Add-Paragraph (([string]$phase.name) + "（" + ([string]$phase.minutes) + "分钟）") -4
        Add-Paragraph ("教师活动：" + [string]$phase.teacher)
        Add-Paragraph ("学生活动：" + [string]$phase.students)
        Add-Paragraph ("设计意图：" + [string]$phase.purpose)
    }
    Add-Paragraph '六、评价与延伸' -3
    Add-Paragraph ([string]$data.assessment)
    Add-Paragraph ([string]$data.extension)

    $document.SaveAs2($OutputPath, 16) # wdFormatDocumentDefault (.docx)
} finally {
    if ($document) { $document.Close([ref]0) }
    if ($word) { $word.Quit() }
    if ($document) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) | Out-Null }
    if ($word) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

