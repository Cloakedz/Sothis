# Sothis: read the text on a screenshot with the OCR built into Windows.
#   -Path <png>   image to read (Sothis saves the screenshot here)
#   -Scale <n>    enlarge first so the small scoreboard text reads better
# Prints one line of JSON: {"w":..,"h":..,"lines":[{"t":"text","words":[{"t":"..","x":..,"y":..,"w":..,"h":..}]}]}
param([Parameter(Mandatory = $true)][string]$Path, [double]$Scale = 2, [switch]$Fg)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Drawing, System.Runtime.WindowsRuntime

  $src = [System.Drawing.Image]::FromFile($Path)
  $s = [Math]::Min($Scale, [Math]::Min(9900 / $src.Width, 9900 / $src.Height))
  $w = [int]($src.Width * $s); $h = [int]($src.Height * $s)
  $big = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose(); $srcW = $src.Width; $srcH = $src.Height; $src.Dispose()
  $tmp = Join-Path $env:TEMP ("sothis-ocr-" + [guid]::NewGuid().ToString('N') + ".png")
  $big.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()

  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType = WindowsRuntime]

  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(-1)
    $task.Result
  }

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $eng) { $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US')) }
  if (-not $eng) { throw 'no-ocr-language' }
  $res = Await ($eng.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose()
  Remove-Item $tmp -ErrorAction SilentlyContinue

  $lines = @()
  foreach ($ln in $res.Lines) {
    $words = @()
    foreach ($wd in $ln.Words) {
      $r = $wd.BoundingRect
      $words += [ordered]@{ t = $wd.Text; x = [int]($r.X / $s); y = [int]($r.Y / $s); w = [int]($r.Width / $s); h = [int]($r.Height / $s) }
    }
    $lines += [ordered]@{ t = $ln.Text; words = $words }
  }
  $out = [ordered]@{ w = $srcW; h = $srcH; lines = $lines }
  if ($Fg) {   # which program is in front (so we only trust text from the game itself)
    try {
      Add-Type -Namespace SothisFg -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);'
      $fpid = [uint32]0; $null = [SothisFg.W]::GetWindowThreadProcessId([SothisFg.W]::GetForegroundWindow(), [ref]$fpid)
      $out.fg = (Get-Process -Id $fpid -ErrorAction Stop).ProcessName + ".exe"
    } catch { $out.fg = "" }
  }
  # sent as Base64 UTF-8 on its own marked line so odd characters on screen can't break it
  $json = $out | ConvertTo-Json -Depth 6 -Compress
  [Console]::Out.WriteLine("SOTHISB64:" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
} catch {
  [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
}
