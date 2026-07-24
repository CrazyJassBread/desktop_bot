param(
    [int]$AudioPort = 8081,
    [int]$VisionPort = 0
)

if ($VisionPort -eq 0) {
    $VisionPort = $AudioPort + 1
}

foreach ($port in @($AudioPort, $VisionPort)) {
    if ($port -lt 1 -or $port -gt 65535) {
        throw "Invalid TCP port: $port. Valid range is 1-65535."
    }
}

if ($AudioPort -eq $VisionPort) {
    throw "AudioPort and VisionPort must be different."
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WebApp = Join-Path $RepoRoot "integrations\ai-hub-os-web"

function Update-TextFile {
    param(
        [string]$Path,
        [scriptblock]$Transform
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Host "skip missing: $Path"
        return
    }

    $old = Get-Content -LiteralPath $Path -Raw
    $new = & $Transform $old
    if ($new -ne $old) {
        Set-Content -LiteralPath $Path -Value $new -NoNewline
        Write-Host "updated: $Path"
    } else {
        Write-Host "unchanged: $Path"
    }
}

function Replace-Match {
    param(
        [string]$Text,
        [string]$Pattern,
        [scriptblock]$Evaluator
    )

    return [regex]::Replace(
        $Text,
        $Pattern,
        [System.Text.RegularExpressions.MatchEvaluator]$Evaluator
    )
}

Update-TextFile (Join-Path $RepoRoot "config.yaml") {
    param($text)
    $text = Replace-Match $text '(?m)^# - TCP \d+: PCM s16le, 16 kHz, mono$' { "# - TCP $AudioPort`: PCM s16le, 16 kHz, mono" }
    $text = Replace-Match $text '(?m)^# - HTTP \d+: POST /upload with a 640x480 JPEG body$' { "# - HTTP $VisionPort`: POST /upload with a 640x480 JPEG body" }
    $text = Replace-Match $text '(?m)^(\s*audio_port:\s*)\d+\s*$' { param($m) $m.Groups[1].Value + $AudioPort }
    $text = Replace-Match $text '(?m)^(\s*vision_port:\s*)\d+\s*$' { param($m) $m.Groups[1].Value + $VisionPort }
    $text
}

Update-TextFile (Join-Path $RepoRoot "app\config.py") {
    param($text)
    $text = Replace-Match $text '(?m)^(\s*audio_port:\s*int\s*=\s*)\d+\s*$' { param($m) $m.Groups[1].Value + $AudioPort }
    $text = Replace-Match $text '(?m)^(\s*vision_port:\s*int\s*=\s*)\d+\s*$' { param($m) $m.Groups[1].Value + $VisionPort }
    $text
}

Update-TextFile (Join-Path $RepoRoot "app\transport\hardware_sources.py") {
    param($text)
    $text = Replace-Match $text '(?m)^(\s*port:\s*int\s*=\s*)\d+(,\s*# NOTE: Audio.*)$' { param($m) $m.Groups[1].Value + $AudioPort + $m.Groups[2].Value }
    $text = Replace-Match $text '(?m)^(\s*port:\s*int\s*=\s*)\d+(,\s*#NOTE Image.*)$' { param($m) $m.Groups[1].Value + $VisionPort + $m.Groups[2].Value }
    $text
}

Update-TextFile (Join-Path $RepoRoot "scripts\receive_microphone.py") {
    param($text)
    Replace-Match $text '(?m)^(PORT\s*=\s*)\d+\s*$' { param($m) $m.Groups[1].Value + $AudioPort }
}

Update-TextFile (Join-Path $RepoRoot "scripts\receive_images.py") {
    param($text)
    $text = Replace-Match $text 'HTTPJPEGImageSource\("0\.0\.0\.0",\s*\d+,' { "HTTPJPEGImageSource(`"0.0.0.0`", $VisionPort," }
    $text = Replace-Match $text 'http://0\.0\.0\.0:\d+/upload' { "http://0.0.0.0:$VisionPort/upload" }
    $text
}

Update-TextFile (Join-Path $WebApp "services\perception-gateway.mjs") {
    param($text)
    $text = Replace-Match $text 'TCP PCM · :\d+ · 16kHz mono s16le' { "TCP PCM · :$AudioPort · 16kHz mono s16le" }
    $text = Replace-Match $text 'HTTP JPEG · :\d+/upload · 640×480' { "HTTP JPEG · :$VisionPort/upload · 640×480" }
    $text
}

Update-TextFile (Join-Path $WebApp "app.js") {
    param($text)
    Replace-Match $text '音频 \d+、图像 \d+' { "音频 $AudioPort、图像 $VisionPort" }
}

Write-Host "Done. Audio=$AudioPort Vision=$VisionPort"
