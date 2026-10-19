# Sothis RGB: drives ASUS Aura lighting (motherboard, RAM, LED strips) through the Aura SDK that Armoury Crate installs.
# Sothis talks to it over stdin, one command per line:
#   set <mode> <rrggbb> <brightness 0-100> <speed 1-10>   mode: static | breathe | cycle | off
#   flash <rrggbb> <times>                                quick flashes, then back to the current mode
#   release                                               give the lights back to Armoury Crate and quit
# It answers on stdout: "ready <count>|<device names>" or "err <reason>".
$ErrorActionPreference = "Stop"
try {
  $sdk = New-Object -ComObject "aura.sdk.1"
  $sdk.SwitchMode()
  $devs = @(); foreach ($d in $sdk.Enumerate(0)) { $devs += $d }
} catch { [Console]::Out.WriteLine("err nosdk " + $_.Exception.Message); [Console]::Out.Flush(); exit 2 }
if (-not $devs.Count) { [Console]::Out.WriteLine("err nodevices"); [Console]::Out.Flush(); exit 3 }
$names = ($devs | ForEach-Object { try { $_.Name } catch { "?" } }) -join ","
[Console]::Out.WriteLine("ready " + $devs.Count + "|" + $names); [Console]::Out.Flush()

# Aura wants 0x00BBGGRR
function Paint([double]$r, [double]$g, [double]$b) {
  $c = ([uint32][math]::Round($b) -shl 16) -bor ([uint32][math]::Round($g) -shl 8) -bor [uint32][math]::Round($r)
  foreach ($d in $devs) {
    try { foreach ($l in $d.Lights) { $l.Color = $c }; $d.Apply() } catch {}
  }
}
function Hex($h) { $h = "$h".TrimStart("#"); if ($h -notmatch '^[0-9a-fA-F]{6}$') { $h = "ff0000" }; return @([Convert]::ToInt32($h.Substring(0,2),16), [Convert]::ToInt32($h.Substring(2,2),16), [Convert]::ToInt32($h.Substring(4,2),16)) }
function Hsv([double]$h) { $h = $h % 360; $x = 1 - [math]::Abs((($h / 60) % 2) - 1); switch ([math]::Floor($h / 60)) { 0 { ,@(1,$x,0) } 1 { ,@($x,1,0) } 2 { ,@(0,1,$x) } 3 { ,@(0,$x,1) } 4 { ,@($x,0,1) } default { ,@(1,0,$x) } } }

$mode = "static"; $rgb = @(255,0,0); $bri = 1.0; $speed = 5
$flash = $null; $t0 = [DateTime]::UtcNow; $lastStatic = ""
$in = New-Object System.IO.StreamReader([Console]::OpenStandardInput()); $pending = $in.ReadLineAsync()
while ($true) {
  if ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { break }   # Sothis closed: let go of the lights
    $p = $line.Trim() -split '\s+'
    switch ($p[0]) {
      "set" { $mode = $p[1]; $rgb = Hex $p[2]; $bri = [math]::Max(0, [math]::Min(100, [int]$p[3])) / 100; $speed = [math]::Max(1, [math]::Min(10, [int]$p[4])); $lastStatic = ""; $t0 = [DateTime]::UtcNow }
      "flash" { $flash = @{ rgb = (Hex $p[1]); n = [math]::Max(1, [math]::Min(10, [int]$p[2])); at = [DateTime]::UtcNow } ; $lastStatic = "" }
      "release" { try { $sdk.ReleaseControl(0) } catch {}; exit 0 }
    }
    $pending = $in.ReadLineAsync()
  }
  $now = [DateTime]::UtcNow
  if ($flash) {
    $ms = ($now - $flash.at).TotalMilliseconds
    if ($ms -ge $flash.n * 400) { $flash = $null; $lastStatic = "" }
    else { if (($ms % 400) -lt 220) { Paint $flash.rgb[0] $flash.rgb[1] $flash.rgb[2] } else { Paint 0 0 0 }; Start-Sleep -Milliseconds 40; continue }
  }
  $sec = ($now - $t0).TotalSeconds
  switch ($mode) {
    "off" { if ($lastStatic -ne "off") { Paint 0 0 0; $lastStatic = "off" }; Start-Sleep -Milliseconds 100 }
    "breathe" {
      $k = (1 - [math]::Cos($sec * $speed * 0.45)) / 2
      $k = 0.05 + 0.95 * $k
      Paint ($rgb[0] * $bri * $k) ($rgb[1] * $bri * $k) ($rgb[2] * $bri * $k); Start-Sleep -Milliseconds 40
    }
    "cycle" {
      $c = Hsv ($sec * $speed * 12)
      Paint (255 * $c[0] * $bri) (255 * $c[1] * $bri) (255 * $c[2] * $bri); Start-Sleep -Milliseconds 40
    }
    default {
      $key = "$($rgb -join ',')|$bri"
      if ($lastStatic -ne $key) { Paint ($rgb[0] * $bri) ($rgb[1] * $bri) ($rgb[2] * $bri); $lastStatic = $key }
      Start-Sleep -Milliseconds 100
    }
  }
}
try { $sdk.ReleaseControl(0) } catch {}
