using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class DesktopLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string app = Path.Combine(root, "desktop-runtime", "PictureBookStudio.exe");
            if (!File.Exists(app))
                throw new FileNotFoundException("桌面运行组件缺失，请重新运行“生成桌面程序.ps1”。", app);

            ProcessStartInfo info = new ProcessStartInfo(app);
            info.WorkingDirectory = root;
            info.UseShellExecute = true;
            Process.Start(info);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "儿童心理绘本工坊", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
