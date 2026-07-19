$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$appName = [string]([char]0x513F) + [char]0x7AE5 + [char]0x5FC3 + [char]0x7406 + [char]0x7ED8 + [char]0x672C + [char]0x5DE5 + [char]0x574A
$exePath = Join-Path $root 'PictureBookStudio-Launcher.exe'
$iconPath = Join-Path $root 'app.ico'
$runtimeDir = Join-Path $root 'desktop-runtime'
$desktopProject = Join-Path $root 'desktop\PictureBookStudio.csproj'

Add-Type -AssemblyName System.Drawing
$iconBuilder = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class StudioIconBuilder
{
    public static void Build(string path)
    {
        int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };
        var frames = new List<byte[]>();
        foreach (int size in sizes) frames.Add(Render(size));
        using (var stream = File.Create(path))
        using (var writer = new BinaryWriter(stream))
        {
            writer.Write((short)0);
            writer.Write((short)1);
            writer.Write((short)sizes.Length);
            int offset = 6 + sizes.Length * 16;
            for (int i = 0; i < sizes.Length; i++)
            {
                writer.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                writer.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                writer.Write((byte)0);
                writer.Write((byte)0);
                writer.Write((short)1);
                writer.Write((short)32);
                writer.Write(frames[i].Length);
                writer.Write(offset);
                offset += frames[i].Length;
            }
            foreach (byte[] frame in frames) writer.Write(frame);
        }
    }

    private static byte[] Render(int size)
    {
        using (var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.Clear(Color.Transparent);
            float scale = size / 256f;
            graphics.ScaleTransform(scale, scale);

            using (var background = Rounded(10, 10, 236, 236, 54))
            using (var gradient = new LinearGradientBrush(new Rectangle(10, 10, 236, 236),
                Color.FromArgb(238, 112, 76), Color.FromArgb(219, 80, 63), 135f))
            {
                graphics.FillPath(gradient, background);
            }
            using (var glow = new SolidBrush(Color.FromArgb(38, 255, 246, 223)))
                graphics.FillEllipse(glow, 38, 28, 178, 178);

            using (var shadow = new SolidBrush(Color.FromArgb(45, 38, 49, 46)))
                graphics.FillEllipse(shadow, 48, 184, 160, 20);

            using (var page = new SolidBrush(Color.FromArgb(255, 250, 239)))
            using (var pageLine = new Pen(Color.FromArgb(31, 66, 59), 7f))
            {
                pageLine.StartCap = LineCap.Round;
                pageLine.EndCap = LineCap.Round;
                using (var left = new GraphicsPath())
                {
                    left.AddBezier(45, 72, 82, 62, 112, 72, 126, 92);
                    left.AddLine(126, 92, 126, 190);
                    left.AddBezier(126, 190, 104, 172, 78, 166, 45, 176);
                    left.CloseFigure();
                    graphics.FillPath(page, left);
                    graphics.DrawPath(pageLine, left);
                }
                using (var right = new GraphicsPath())
                {
                    right.AddBezier(211, 72, 174, 62, 144, 72, 130, 92);
                    right.AddLine(130, 92, 130, 190);
                    right.AddBezier(130, 190, 152, 172, 178, 166, 211, 176);
                    right.CloseFigure();
                    graphics.FillPath(page, right);
                    graphics.DrawPath(pageLine, right);
                }
                graphics.DrawLine(pageLine, 128, 91, 128, 192);
            }

            using (var heart = new GraphicsPath())
            using (var heartBrush = new SolidBrush(Color.FromArgb(225, 88, 68)))
            {
                heart.AddBezier(128, 151, 103, 134, 91, 117, 100, 105);
                heart.AddBezier(100, 105, 109, 94, 124, 101, 128, 111);
                heart.AddBezier(128, 111, 132, 101, 147, 94, 156, 105);
                heart.AddBezier(156, 105, 165, 117, 153, 134, 128, 151);
                heart.CloseFigure();
                graphics.FillPath(heartBrush, heart);
            }

            using (var pencil = new Pen(Color.FromArgb(252, 205, 91), 13f))
            {
                pencil.StartCap = LineCap.Round;
                pencil.EndCap = LineCap.Round;
                graphics.DrawLine(pencil, 180, 48, 211, 79);
            }
            using (var pencilTip = new Pen(Color.FromArgb(31, 66, 59), 7f))
            {
                pencilTip.StartCap = LineCap.Round;
                pencilTip.EndCap = LineCap.Round;
                graphics.DrawLine(pencilTip, 207, 75, 216, 84);
            }

            using (var memory = new MemoryStream())
            {
                bitmap.Save(memory, ImageFormat.Png);
                return memory.ToArray();
            }
        }
    }

    private static GraphicsPath Rounded(float x, float y, float width, float height, float radius)
    {
        var path = new GraphicsPath();
        float d = radius * 2;
        path.AddArc(x, y, d, d, 180, 90);
        path.AddArc(x + width - d, y, d, d, 270, 90);
        path.AddArc(x + width - d, y + height - d, d, d, 0, 90);
        path.AddArc(x, y + height - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
'@
Add-Type -TypeDefinition $iconBuilder -ReferencedAssemblies System.Drawing
[StudioIconBuilder]::Build($iconPath)

if (-not (Test-Path -LiteralPath $desktopProject)) { throw 'Desktop project was not found.' }
$resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
$resolvedRuntime = [IO.Path]::GetFullPath($runtimeDir).TrimEnd('\')
if (-not $resolvedRuntime.StartsWith($resolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolvedRuntime -Leaf) -ne 'desktop-runtime') {
    throw 'Refusing to clean an unexpected runtime directory.'
}
if (Test-Path -LiteralPath $runtimeDir) { Remove-Item -LiteralPath $runtimeDir -Recurse -Force }
# Self-contained so end users do not need a separate .NET 6 Desktop Runtime install.
& dotnet publish $desktopProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o $runtimeDir --nologo
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $runtimeDir 'PictureBookStudio.exe'))) {
    throw 'WebView2 desktop application build failed.'
}

if (Test-Path -LiteralPath $exePath) { Remove-Item -LiteralPath $exePath -Force }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $csc)) { throw 'C# compiler was not found.' }
& $csc /nologo /target:winexe "/win32icon:$iconPath" "/out:$exePath" /reference:System.dll /reference:System.Windows.Forms.dll (Join-Path $root 'desktop-launcher.cs')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exePath)) { throw 'Desktop launcher compilation failed.' }

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop ($appName + '.lnk')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Native picture book and primary school psychology teaching studio'
$shortcut.Save()

Write-Output "EXE=$exePath"
Write-Output "RUNTIME=$runtimeDir"
Write-Output "SHORTCUT=$shortcutPath"
