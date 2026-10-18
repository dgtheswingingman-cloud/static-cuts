# Repeatedly calls the match-spotify Edge Function until every track has
# been checked. Run this from PowerShell (needs internet access).
#
# Usage: .\run-spotify-matching.ps1 -FunctionUrl "https://<project-ref>.functions.supabase.co/match-spotify"
#
# Gentle by default: 10 songs per batch, 20s between batches, which is about
# 30 Spotify searches a minute (one search per song). The old pace (about 140
# a minute) got a 24-hour block. 20,000 songs takes roughly 11 hours, so run
# it overnight. You can stop it with Ctrl+C at any time and start it again
# later: it carries on from where it got to.

param(
    [Parameter(Mandatory=$true)]
    [string]$FunctionUrl,
    [int]$BatchSize = 10,
    [int]$PauseSeconds = 20
)

$started = Get-Date

$totalChecked = 0
$totalMatched = 0
$consecutiveRateLimits = 0

while ($true) {
    try {
        $response = Invoke-RestMethod -Uri "$FunctionUrl`?limit=$BatchSize" -Method Get
    } catch {
        Write-Host ">>> Request failed: $_. Waiting 60s and retrying..."
        Start-Sleep -Seconds 60
        continue
    }

    $response | ConvertTo-Json -Compress | Write-Host

    $checked = if ($response.checked) { $response.checked } else { 0 }
    $matched = if ($response.matched) { $response.matched } else { 0 }
    $totalChecked += $checked
    $totalMatched += $matched
    $mins = [Math]::Max(1, [Math]::Round(((Get-Date) - $started).TotalMinutes))
    Write-Host ">>> $(Get-Date -Format HH:mm) running totals: checked=$totalChecked matched=$totalMatched (about $([Math]::Round($totalChecked / $mins)) a minute)"

    if ($response.done -eq $true) {
        Write-Host ">>> All tracks checked. Done."
        break
    }

    if ($response.rateLimited -eq $true) {
        $consecutiveRateLimits++
        $baseWait = if ($response.retryAfterSeconds) { [int]$response.retryAfterSeconds } else { 30 }

        # If Spotify wants us to wait more than 10 minutes, this is an
        # extended block, not normal throttling -- don't sit here retrying
        # for hours, that risks making it worse. Stop and tell the user.
        if ($baseWait -gt 600) {
            $hours = [Math]::Round($baseWait / 3600, 1)
            Write-Host ""
            Write-Host ">>> Spotify has issued an extended rate-limit block (~$hours hours)."
            Write-Host ">>> Stopping now rather than retrying during the block window."
            Write-Host ">>> Re-run this script after the wait has passed."
            break
        }

        $wait = [Math]::Min($baseWait * $consecutiveRateLimits, 300)  # cap normal backoff at 5 minutes
        Write-Host ">>> Spotify rate limit hit (x$consecutiveRateLimits in a row), waiting ${wait}s before retrying..."
        Start-Sleep -Seconds $wait
    } else {
        $consecutiveRateLimits = 0
        # Pause between every batch, not just after hitting a limit, so
        # requests stay spread out well under Spotify's burst threshold.
        Start-Sleep -Seconds $PauseSeconds
    }
}
