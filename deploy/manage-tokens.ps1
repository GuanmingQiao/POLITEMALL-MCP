# Helper for generating/rotating a teammate's access token.
# Usage: . .\deploy\manage-tokens.ps1 ; New-UserToken -Id "teammate-1" -Name "Alex" -ValidDays 90
# Then merge the printed entry into server/data/users.json, push it to the instance via SSM,
# and give the teammate ONLY the token value (never share users.json itself).

function New-UserToken {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$Name,
        [int]$ValidDays = 90
    )
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
    $now = [DateTime]::UtcNow
    $entry = [ordered]@{
        id             = $Id
        name           = $Name
        token          = $token
        tokenCreatedAt = $now.ToString("o")
        tokenExpiresAt = $now.AddDays($ValidDays).ToString("o")
    }
    $entry | ConvertTo-Json
    Write-Output "`nGive this token to $Name (and only to them): $token"
}
