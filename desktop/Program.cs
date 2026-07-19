using System.Diagnostics;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PictureBookStudio;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        BootLog("Program main entered. base=" + AppContext.BaseDirectory);
        using var mutex = new Mutex(true, "ChildPsychologyPictureBookStudio.Native", out bool firstInstance);
        BootLog("Mutex firstInstance=" + firstInstance);
        if (!firstInstance)
        {
            MessageBox.Show("儿童心理绘本工坊已经打开。", "儿童心理绘本工坊", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new StudioWindow());
    }

    private static void BootLog(string message)
    {
        try
        {
            string root = new DirectoryInfo(AppContext.BaseDirectory).Parent?.FullName ?? AppContext.BaseDirectory;
            File.AppendAllText(Path.Combine(root, "desktop-startup.log"), DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
        }
        catch { }
    }
}

internal sealed class StudioWindow : Form
{
    private const int Port = 4173;
    private static readonly Uri AppUri = new($"http://127.0.0.1:{Port}");
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly Label loadingLabel = new()
    {
        Dock = DockStyle.Fill,
        Text = "正在准备绘本工坊…",
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Microsoft YaHei UI", 14F, FontStyle.Regular),
        ForeColor = Color.FromArgb(61, 70, 67),
        BackColor = Color.FromArgb(240, 242, 239)
    };
    private Process? serverProcess;
    /// <summary>When true, FormClosed will POST /api/shutdown for an attached desktop-owned orphan.</summary>
    private bool shutdownAttachedOnExit;
    private static readonly object LogSync = new();
    private string? lastExportDirectory;

    public StudioWindow()
    {
        Text = "儿童心理绘本工坊";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1100, 720);
        Size = new Size(1500, 940);
        BackColor = Color.FromArgb(240, 242, 239);
        Icon = LoadWindowIcon();
        Controls.Add(loadingLabel);
        Shown += async (_, _) => await InitializeAsync();
        FormClosed += (_, _) => StopOwnedServer();
    }

    private async Task InitializeAsync()
    {
        try
        {
            string root = ResolveProjectRoot();
            Log("Initialize root=" + root + "; base=" + AppContext.BaseDirectory);
            if (!await IsAppHealthyAsync())
            {
                StartServer(root);
                Log("Server start requested.");
                for (int attempt = 0; attempt < 80 && !await IsAppHealthyAsync(); attempt++)
                    await Task.Delay(150);
            }
            else
            {
                // Port already healthy: attach. If prior desktop shell left an orphan
                // (STUDIO_OWNED_BY=desktop), shut it down when this shell exits.
                string? ownedBy = await ReadHealthOwnedByAsync();
                shutdownAttachedOnExit = string.Equals(ownedBy, "desktop", StringComparison.OrdinalIgnoreCase);
                Log("Attached to existing server; ownedBy=" + (ownedBy ?? "(none)") +
                    "; shutdownAttachedOnExit=" + shutdownAttachedOnExit);
            }

            if (!await IsAppHealthyAsync())
                throw new InvalidOperationException("本地服务启动失败，请检查项目目录中的 desktop-startup.log。");

            string dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ChildPsychologyPictureBookStudio",
                "WebView2");
            Directory.CreateDirectory(dataDir);
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await webView.EnsureCoreWebView2Async(environment);
            ConfigureWebView();
            Controls.Clear();
            Controls.Add(webView);
            webView.Source = AppUri;
        }
        catch (Exception error)
        {
            Log(error.ToString());
            loadingLabel.Text = "桌面程序启动失败\r\n\r\n" + error.Message;
            MessageBox.Show(error.Message, "儿童心理绘本工坊", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ConfigureWebView()
    {
        CoreWebView2Settings settings = webView.CoreWebView2.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsBuiltInErrorPageEnabled = true;
        // 允许页面触发下载（Word/PPTX 导出）
        try { settings.IsGeneralAutofillEnabled = false; } catch { /* older runtime */ }
        webView.CoreWebView2.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Light;
        try
        {
            string downloads = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Downloads");
            if (Directory.Exists(downloads))
                webView.CoreWebView2.Profile.DefaultDownloadFolderPath = downloads;
        }
        catch { /* ignore */ }

        webView.CoreWebView2.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out Uri? uri) && IsLocalAppUri(uri))
                webView.CoreWebView2.Navigate(args.Uri);
        };
        webView.CoreWebView2.NavigationStarting += (_, args) =>
        {
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out Uri? uri) || !IsLocalAppUri(uri))
                args.Cancel = true;
        };
        webView.CoreWebView2.DownloadStarting += (_, args) =>
        {
            // 使用默认下载文件夹并显示系统保存流程
            args.Handled = false;
            Log("Download starting: " + args.ResultFilePath);
        };
        webView.CoreWebView2.ProcessFailed += (_, _) => webView.Reload();
        webView.CoreWebView2.WebMessageReceived += (_, args) =>
        {
            try
            {
                string message = args.TryGetWebMessageAsString();
                if (string.IsNullOrWhiteSpace(message)) return;
                if (message.Contains("\"type\":\"exit\"", StringComparison.OrdinalIgnoreCase)
                    || message.Contains("\"type\": \"exit\"", StringComparison.OrdinalIgnoreCase)
                    || (message.Contains("exit", StringComparison.OrdinalIgnoreCase)
                        && !message.Contains("save-file", StringComparison.OrdinalIgnoreCase)
                        && message.Length < 40))
                {
                    BeginInvoke(new Action(Close));
                    return;
                }
                if (message.Contains("save-file", StringComparison.OrdinalIgnoreCase)
                    && !message.Contains("save-file-result", StringComparison.OrdinalIgnoreCase))
                {
                    BeginInvoke(new Action(() => HandleSaveFileMessage(message)));
                }
            }
            catch (Exception error)
            {
                Log("WebMessage error: " + error.Message);
            }
        };
        LoadExportPrefs();
    }

    private static string ExportPrefsPath()
    {
        string dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ChildPsychologyPictureBookStudio");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "export-prefs.txt");
    }

    private void LoadExportPrefs()
    {
        try
        {
            string path = ExportPrefsPath();
            if (!File.Exists(path)) return;
            string dir = File.ReadAllText(path).Trim();
            if (Directory.Exists(dir)) lastExportDirectory = dir;
        }
        catch { /* ignore */ }
    }

    private void SaveExportPrefs(string directory)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory)) return;
            lastExportDirectory = directory;
            File.WriteAllText(ExportPrefsPath(), directory);
        }
        catch { /* ignore */ }
    }

    private static string DefaultDownloadsDir()
    {
        string downloads = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Downloads");
        try { Directory.CreateDirectory(downloads); } catch { /* ignore */ }
        return downloads;
    }

    private static string BuildSaveFilter(string fileName, string? mime)
    {
        string ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".pdf" => "PDF 文件 (*.pdf)|*.pdf|所有文件 (*.*)|*.*",
            ".png" => "PNG 图片 (*.png)|*.png|所有文件 (*.*)|*.*",
            ".jpg" or ".jpeg" => "JPEG 图片 (*.jpg)|*.jpg;*.jpeg|所有文件 (*.*)|*.*",
            ".zip" => "ZIP 压缩包 (*.zip)|*.zip|所有文件 (*.*)|*.*",
            ".docx" => "Word 文档 (*.docx)|*.docx|所有文件 (*.*)|*.*",
            ".pptx" => "PowerPoint (*.pptx)|*.pptx|所有文件 (*.*)|*.*",
            _ when !string.IsNullOrWhiteSpace(mime) && mime.Contains("pdf", StringComparison.OrdinalIgnoreCase)
                => "PDF 文件 (*.pdf)|*.pdf|所有文件 (*.*)|*.*",
            _ => "所有文件 (*.*)|*.*"
        };
    }

    private void PostSaveResult(string? requestId, bool ok, bool cancelled, string? path, string? error)
    {
        try
        {
            if (webView.CoreWebView2 == null) return;
            var payload = new Dictionary<string, object?>
            {
                ["type"] = "save-file-result",
                ["requestId"] = requestId ?? "",
                ["ok"] = ok,
                ["cancelled"] = cancelled,
                ["path"] = path ?? "",
                ["error"] = error ?? ""
            };
            string json = System.Text.Json.JsonSerializer.Serialize(payload);
            webView.CoreWebView2.PostWebMessageAsString(json);
        }
        catch (Exception ex)
        {
            Log("PostSaveResult failed: " + ex.Message);
        }
    }

    private void HandleSaveFileMessage(string message)
    {
        string? requestId = null;
        try
        {
            string fileName = $"export-{DateTime.Now:yyyyMMdd-HHmmss}.bin";
            string? base64 = null;
            string? mime = null;
            bool pickLocation = true; // 默认弹出「另存为」

            // 优先 System.Text.Json（可靠）；失败再回退手工解析
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(message);
                var root = doc.RootElement;
                if (root.TryGetProperty("requestId", out var rid) && rid.ValueKind == System.Text.Json.JsonValueKind.String)
                    requestId = rid.GetString();
                if (root.TryGetProperty("fileName", out var fn) && fn.ValueKind == System.Text.Json.JsonValueKind.String)
                    fileName = fn.GetString() ?? fileName;
                if (root.TryGetProperty("base64", out var b64) && b64.ValueKind == System.Text.Json.JsonValueKind.String)
                    base64 = b64.GetString();
                if (root.TryGetProperty("mime", out var m) && m.ValueKind == System.Text.Json.JsonValueKind.String)
                    mime = m.GetString();
                if (root.TryGetProperty("pickLocation", out var pl))
                {
                    if (pl.ValueKind == System.Text.Json.JsonValueKind.False) pickLocation = false;
                    else if (pl.ValueKind == System.Text.Json.JsonValueKind.True) pickLocation = true;
                    else if (pl.ValueKind == System.Text.Json.JsonValueKind.String
                        && bool.TryParse(pl.GetString(), out bool parsed)) pickLocation = parsed;
                }
            }
            catch (Exception parseError)
            {
                Log("JsonDocument parse fallback: " + parseError.Message);
                requestId = ExtractJsonString(message, "requestId");
                fileName = ExtractJsonString(message, "fileName") ?? fileName;
                base64 = ExtractJsonString(message, "base64");
                mime = ExtractJsonString(message, "mime");
                string? pickRaw = ExtractJsonString(message, "pickLocation");
                if (pickRaw != null && bool.TryParse(pickRaw, out bool parsedPick)) pickLocation = parsedPick;
            }

            if (string.IsNullOrWhiteSpace(base64))
            {
                Log("Save-file empty base64; messageLen=" + (message?.Length ?? 0)
                    + "; hasType=" + (message?.Contains("save-file", StringComparison.OrdinalIgnoreCase) == true)
                    + "; hasBase64Key=" + (message?.Contains("\"base64\"", StringComparison.Ordinal) == true));
                PostSaveResult(requestId, false, false, null, "导出内容为空");
                MessageBox.Show("导出内容为空。请重试；若仍失败，请确认已更新到最新桌面程序。", "儿童心理绘本工坊", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            fileName = SanitizeFileName(fileName);
            byte[] bytes = Convert.FromBase64String(base64.Trim());
            if (bytes.Length == 0)
            {
                PostSaveResult(requestId, false, false, null, "导出内容为空");
                MessageBox.Show("导出内容为空。", "儿童心理绘本工坊", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string target;
            if (pickLocation)
            {
                string initialDir = !string.IsNullOrWhiteSpace(lastExportDirectory) && Directory.Exists(lastExportDirectory)
                    ? lastExportDirectory
                    : DefaultDownloadsDir();

                using var dialog = new SaveFileDialog
                {
                    Title = "导出文件另存为",
                    FileName = fileName,
                    Filter = BuildSaveFilter(fileName, mime),
                    InitialDirectory = initialDir,
                    OverwritePrompt = true,
                    AddExtension = true,
                    RestoreDirectory = true
                };
                string ext = Path.GetExtension(fileName);
                if (!string.IsNullOrEmpty(ext)) dialog.DefaultExt = ext.TrimStart('.');

                if (dialog.ShowDialog(this) != DialogResult.OK || string.IsNullOrWhiteSpace(dialog.FileName))
                {
                    PostSaveResult(requestId, false, true, null, "已取消保存");
                    Log("Save-file cancelled by user");
                    return;
                }
                target = dialog.FileName;
            }
            else
            {
                string downloads = DefaultDownloadsDir();
                target = EnsureUniquePath(Path.Combine(downloads, fileName));
            }

            File.WriteAllBytes(target, bytes);
            string? parent = Path.GetDirectoryName(target);
            if (!string.IsNullOrWhiteSpace(parent)) SaveExportPrefs(parent);
            Log("Saved export: " + target + " bytes=" + bytes.Length);
            PostSaveResult(requestId, true, false, target, null);

            // 在资源管理器中选中文件，方便用户找到
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = $"/select,\"{target}\"",
                    UseShellExecute = true
                });
            }
            catch { /* ignore */ }
        }
        catch (Exception error)
        {
            Log("Save-file failed: " + error);
            PostSaveResult(requestId, false, false, null, error.Message);
            MessageBox.Show("导出保存失败：\r\n" + error.Message, "儿童心理绘本工坊", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string SanitizeFileName(string name)
    {
        foreach (char c in Path.GetInvalidFileNameChars())
            name = name.Replace(c, '-');
        name = name.Trim();
        if (string.IsNullOrWhiteSpace(name)) name = "export.bin";
        if (name.Length > 120) name = name[..120];
        return name;
    }

    private static string EnsureUniquePath(string path)
    {
        if (!File.Exists(path)) return path;
        string dir = Path.GetDirectoryName(path) ?? "";
        string stem = Path.GetFileNameWithoutExtension(path);
        string ext = Path.GetExtension(path);
        for (int i = 2; i < 1000; i++)
        {
            string candidate = Path.Combine(dir, $"{stem} ({i}){ext}");
            if (!File.Exists(candidate)) return candidate;
        }
        return Path.Combine(dir, $"{stem}-{DateTime.Now:HHmmss}{ext}");
    }

    private static string? ExtractJsonString(string json, string key)
    {
        // 正确跳过空白：旧实现把 "\s*" 当字面量匹配，导致 "base64":"..." 永远解析失败 →「导出内容为空」
        if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return null;
        string needle = "\"" + key + "\"";
        int searchFrom = 0;
        while (searchFrom < json.Length)
        {
            int keyPos = json.IndexOf(needle, searchFrom, StringComparison.Ordinal);
            if (keyPos < 0) return null;
            int i = keyPos + needle.Length;
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            if (i >= json.Length || json[i] != ':')
            {
                searchFrom = keyPos + 1;
                continue;
            }
            i++;
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            if (i >= json.Length || json[i] != '"')
            {
                searchFrom = keyPos + 1;
                continue;
            }
            i++; // 跳过开引号
            var sb = new System.Text.StringBuilder(Math.Max(64, json.Length - i));
            for (; i < json.Length; i++)
            {
                char c = json[i];
                if (c == '\\' && i + 1 < json.Length)
                {
                    char n = json[i + 1];
                    if (n == '"' || n == '\\' || n == '/') { sb.Append(n); i++; continue; }
                    if (n == 'n') { sb.Append('\n'); i++; continue; }
                    if (n == 'r') { sb.Append('\r'); i++; continue; }
                    if (n == 't') { sb.Append('\t'); i++; continue; }
                    if (n == 'u' && i + 5 < json.Length)
                    {
                        string hex = json.Substring(i + 2, 4);
                        if (int.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out int code))
                        {
                            sb.Append((char)code);
                            i += 5;
                            continue;
                        }
                    }
                    sb.Append(n);
                    i++;
                    continue;
                }
                if (c == '"') return sb.ToString();
                sb.Append(c);
            }
            return sb.Length > 0 ? sb.ToString() : null;
        }
        return null;
    }

    private static bool IsLocalAppUri(Uri uri) =>
        uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase) && uri.Port == Port;

    private void StartServer(string root)
    {
        string server = Path.Combine(root, "server.js");
        if (!File.Exists(server)) throw new FileNotFoundException("未找到程序服务文件。", server);
        string node = FindNode();
        Log("Starting node=" + node + "; server=" + server);
        var info = new ProcessStartInfo(node, $"\"{server}\"")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        info.Environment["STUDIO_OWNED_BY"] = "desktop";
        info.Environment["HOST"] = "127.0.0.1";
        info.Environment["PORT"] = Port.ToString();
        serverProcess = Process.Start(info) ?? throw new InvalidOperationException("无法启动本地服务。");
        ChildProcessJob.Assign(serverProcess);
        serverProcess.OutputDataReceived += (_, args) => { if (!string.IsNullOrWhiteSpace(args.Data)) Log("node: " + args.Data); };
        serverProcess.ErrorDataReceived += (_, args) => { if (!string.IsNullOrWhiteSpace(args.Data)) Log("node-error: " + args.Data); };
        serverProcess.BeginOutputReadLine();
        serverProcess.BeginErrorReadLine();
        Log("Node pid=" + serverProcess.Id + " (job-object kill-on-close)");
    }

    private void StopOwnedServer()
    {
        try
        {
            if (serverProcess is { HasExited: false })
            {
                serverProcess.Kill(true);
            }
            else if (shutdownAttachedOnExit)
            {
                // Attached to a previous desktop-owned Node with no Process handle.
                RequestLocalShutdown(force: false);
            }
        }
        catch { }
        finally
        {
            serverProcess?.Dispose();
            serverProcess = null;
            ChildProcessJob.Close();
        }
    }

    private static void RequestLocalShutdown(bool force)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            using var content = new StringContent(
                force ? "{\"force\":true}" : "{\"force\":false}",
                Encoding.UTF8,
                "application/json");
            using var response = http.PostAsync($"http://127.0.0.1:{Port}/api/shutdown", content)
                .GetAwaiter()
                .GetResult();
            Log("Attached server shutdown HTTP " + (int)response.StatusCode);
        }
        catch (Exception error)
        {
            Log("Attached server shutdown failed: " + error.Message);
        }
    }

    private static async Task<bool> IsListeningAsync()
    {
        try
        {
            using var client = new TcpClient();
            using var timeout = new CancellationTokenSource(250);
            await client.ConnectAsync("127.0.0.1", Port, timeout.Token);
            return true;
        }
        catch { return false; }
    }

    /// <summary>
    /// TCP alone is not enough: an unrelated process may own port 4173.
    /// Confirm the local app health endpoint before loading WebView.
    /// </summary>
    private static async Task<bool> IsAppHealthyAsync()
    {
        if (!await IsListeningAsync()) return false;
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(900) };
            using var response = await http.GetAsync($"http://127.0.0.1:{Port}/api/health");
            if (!response.IsSuccessStatusCode) return false;
            string body = await response.Content.ReadAsStringAsync();
            return body.Contains("\"ok\":true", StringComparison.Ordinal)
                || body.Contains("\"ok\": true", StringComparison.Ordinal);
        }
        catch (Exception error)
        {
            Log("Health probe failed: " + error.Message);
            return false;
        }
    }

    private static async Task<string?> ReadHealthOwnedByAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(900) };
            using var response = await http.GetAsync($"http://127.0.0.1:{Port}/api/health");
            if (!response.IsSuccessStatusCode) return null;
            string body = await response.Content.ReadAsStringAsync();
            // lightweight parse: "ownedBy":"desktop" or "ownedBy": null
            const string key = "\"ownedBy\"";
            int idx = body.IndexOf(key, StringComparison.Ordinal);
            if (idx < 0) return null;
            int colon = body.IndexOf(':', idx + key.Length);
            if (colon < 0) return null;
            int i = colon + 1;
            while (i < body.Length && char.IsWhiteSpace(body[i])) i++;
            if (i < body.Length && body[i] == 'n') return null; // null
            if (i >= body.Length || body[i] != '"') return null;
            int start = ++i;
            while (i < body.Length && body[i] != '"') i++;
            if (i > start) return body.Substring(start, i - start);
        }
        catch (Exception error)
        {
            Log("ownedBy probe failed: " + error.Message);
        }
        return null;
    }

    private static string ResolveProjectRoot()
    {
        string runtimeDir = AppContext.BaseDirectory;
        var parent = new DirectoryInfo(runtimeDir).Parent;
        return parent?.FullName ?? runtimeDir;
    }

    private static string FindNode()
    {
        // Keep in sync with installer/PictureBookStudio.iss NodeExists paths.
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            Path.Combine(localAppData, "Programs", "node", "node.exe"),
            Path.Combine(localAppData, "Programs", "nodejs", "node.exe")
        };
        foreach (string path in candidates)
        {
            if (File.Exists(path)) return path;
        }

        // PATH fallback (winget/user installs, portable Node, etc.)
        try
        {
            using var where = Process.Start(new ProcessStartInfo
            {
                FileName = "where.exe",
                Arguments = "node.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            });
            if (where != null)
            {
                string output = where.StandardOutput.ReadToEnd();
                where.WaitForExit(3000);
                string? hit = output
                    .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(line => line.Trim())
                    .FirstOrDefault(line => line.EndsWith("node.exe", StringComparison.OrdinalIgnoreCase) && File.Exists(line));
                if (!string.IsNullOrEmpty(hit)) return hit;
            }
        }
        catch { /* ignore */ }

        return "node.exe";
    }

    private static void Log(string message)
    {
        try
        {
            string path = Path.Combine(ResolveProjectRoot(), "desktop-startup.log");
            lock (LogSync) File.AppendAllText(path, DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
        }
        catch { }
    }

    private static Icon? LoadWindowIcon()
    {
        string path = Path.Combine(ResolveProjectRoot(), "app.ico");
        return File.Exists(path) ? new Icon(path) : null;
    }
}

/// <summary>
/// Windows Job Object so a hard-killed desktop shell also terminates its Node child
/// (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE).
/// </summary>
internal static class ChildProcessJob
{
    private static IntPtr jobHandle = IntPtr.Zero;

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x2000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr hJob, int jobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    public static void Assign(Process process)
    {
        try
        {
            if (jobHandle == IntPtr.Zero)
            {
                jobHandle = CreateJobObject(IntPtr.Zero, null);
                if (jobHandle == IntPtr.Zero) return;

                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
                {
                    BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
                    {
                        LimitFlags = JobObjectLimitKillOnJobClose
                    }
                };
                int length = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
                IntPtr ptr = Marshal.AllocHGlobal(length);
                try
                {
                    Marshal.StructureToPtr(info, ptr, false);
                    if (!SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformation, ptr, (uint)length))
                    {
                        CloseHandle(jobHandle);
                        jobHandle = IntPtr.Zero;
                        return;
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(ptr);
                }
            }

            AssignProcessToJobObject(jobHandle, process.Handle);
        }
        catch
        {
            /* best-effort; Process.Kill remains the normal path */
        }
    }

    public static void Close()
    {
        try
        {
            if (jobHandle != IntPtr.Zero)
            {
                CloseHandle(jobHandle);
                jobHandle = IntPtr.Zero;
            }
        }
        catch { }
    }
}
