param(
    [string]$BaseUrl = "http://127.0.0.1:8090",
    [string]$WebUrl = "http://127.0.0.1:18000",
    [int]$IntervalMs = 500,
    [int]$FreshMs = 3000,
    [switch]$AllAudioEvents,
    [switch]$History,
    [switch]$Once
)

$ErrorActionPreference = "Stop"
$sequence = 0
$webAfterMs = 0
$lastFrames = $null
$lastTranscripts = $null

function Get-EventText {
    param($Event)

    if ($Event.payload.transcript) { return [string]$Event.payload.transcript }
    if ($Event.payload.payload_text) { return [string]$Event.payload.payload_text }
    if ($Event.payload.message) { return [string]$Event.payload.message }
    if ($Event.payload.reply) { return [string]$Event.payload.reply }
    if ($Event.payload.answer) { return [string]$Event.payload.answer }
    if ($Event.payload.intent) { return [string]$Event.payload.intent }
    return ""
}

function Write-EventLine {
    param(
        [string]$Prefix,
        $Event,
        [ConsoleColor]$Color = [ConsoleColor]::Green
    )

    $text = (Get-EventText $Event).Trim()
    $time = Get-Date -Format "HH:mm:ss"
    if ($text) {
        Write-Host ("[{0}] {1} #{2} {3}: {4}" -f $time, $Prefix, $Event.sequence, $Event.event_type, $text) -ForegroundColor $Color
    } else {
        Write-Host ("[{0}] {1} #{2} {3}" -f $time, $Prefix, $Event.sequence, $Event.event_type) -ForegroundColor $Color
    }
}

function Get-UnixTimeMilliseconds {
    return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

if (-not $History) {
    try {
        $existing = Invoke-RestMethod -Uri "$BaseUrl/api/events?after_sequence=0" -TimeoutSec 5
        foreach ($event in @($existing.events)) {
            $sequence = [Math]::Max($sequence, [int]$event.sequence)
        }
    } catch {
        Write-Warning "Could not initialize desktop_bot event cursor: $($_.Exception.Message)"
    }
    $webAfterMs = Get-UnixTimeMilliseconds
}

Write-Host "Watching microphone transcripts and web linkage"
Write-Host "desktop_bot: $BaseUrl"
Write-Host "web/api:     $WebUrl"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

while ($true) {
    try {
        $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 3
        $audio = $health.audio
        if ($audio) {
            $frameAge = 0
            if ($audio.last_frame_age_ms -ne $null) {
                $frameAge = [int]$audio.last_frame_age_ms
            }
            $fresh = $audio.connected -and ($audio.last_frame_age_ms -eq $null -or $frameAge -le $FreshMs)
            $state = if ($fresh) {
                "LIVE"
            } elseif ($audio.connected) {
                "STALE"
            } else {
                "WAITING"
            }
            $peer = if ($audio.peer_host) { "$($audio.peer_host):$($audio.peer_port)" } else { "-" }
            $frames = [int64]$audio.frames_received
            $transcripts = [int64]$health.metrics.speech_transcripts
            $frameDelta = if ($lastFrames -eq $null) { 0 } else { $frames - $lastFrames }
            $transcriptDelta = if ($lastTranscripts -eq $null) { 0 } else { $transcripts - $lastTranscripts }
            $lastFrames = $frames
            $lastTranscripts = $transcripts
            $color = if ($fresh) { [ConsoleColor]::Green } elseif ($audio.connected) { [ConsoleColor]::Yellow } else { [ConsoleColor]::DarkYellow }
            Write-Host ("[{0}] audio={1} peer={2} frames={3} (+{4}) age={5}ms rms={6:N3} peak={7:N3} transcripts={8} (+{9})" -f `
                (Get-Date -Format "HH:mm:ss"),
                $state,
                $peer,
                $frames,
                $frameDelta,
                $frameAge,
                [double]$audio.rms,
                [double]$audio.peak,
                $transcripts,
                $transcriptDelta) -ForegroundColor $color
        }

        $events = Invoke-RestMethod -Uri "$BaseUrl/api/events?after_sequence=$sequence" -TimeoutSec 5
        foreach ($event in @($events.events)) {
            $sequence = [Math]::Max($sequence, [int]$event.sequence)
            $isTranscript = $event.event_type -eq "speech.transcribed"
            $isAudio = $event.source -eq "audio"
            $isResult = $event.source -eq "external"

            if ($isTranscript -or ($AllAudioEvents -and $isAudio)) {
                Write-EventLine "BOT" $event Green
            } elseif ($isResult) {
                Write-EventLine "BOT" $event Cyan
            }
        }

        try {
            $webEvents = Invoke-RestMethod -Uri "$WebUrl/api/v1/perception/events?afterMs=$webAfterMs" -TimeoutSec 5
            foreach ($event in @($webEvents.items)) {
                $timestamp = [int64]$event.timestampMs
                $webAfterMs = [Math]::Max($webAfterMs, $timestamp)
                if ($event.source -eq "audio" -or $event.source -eq "external") {
                    Write-EventLine "WEB" $event Yellow
                }
            }
        } catch {
            Write-Warning "Web linkage unavailable: $($_.Exception.Message)"
        }
    } catch {
        Write-Warning $_.Exception.Message
    }

    if ($Once) {
        break
    }
    Start-Sleep -Milliseconds $IntervalMs
}
