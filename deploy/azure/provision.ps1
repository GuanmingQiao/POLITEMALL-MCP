# One-time Azure provisioning for the hosted politemall-mcp server.
# Requires the Azure CLI signed in (`az login`) to the subscription that will own the resources, with
# Owner on it (the script creates role assignments). Safe to re-run after a partial failure: the
# resource group, IP, NSG and vault are created idempotently. A re-run adds a new master-key version
# and fails at the VM step if the VM already exists (skip to step 5 by hand in that case).

$ErrorActionPreference = "Stop"
$rg       = "politemall-mcp-rg"
$location = "eastasia"
$vmName   = "politemall-mcp"
$vmSize   = "Standard_B2als_v2"   # needs Basv2 vCPU quota in the region (request it if it is 0)
$ipName   = "politemall-mcp-ip"
$nsgName  = "politemall-mcp-nsg"
# Key Vault names are global: change this if it is taken.
$kvName   = "politemall-mcp-kv"

# Runs az and fails on a non-zero exit code. Windows PowerShell 5.1 turns anything a native command
# writes to stderr (including az's harmless warnings) into a terminating error, so stderr is sent to a
# file and only shown when the command actually failed.
function Invoke-Az {
  $ErrorActionPreference = "Continue"   # local to this function; the exit code below is the real check
  $errFile = New-TemporaryFile
  try {
    $out = & az.cmd @args 2>$errFile.FullName
    if ($LASTEXITCODE -ne 0) {
      throw "az $($args[0..1] -join ' ') failed (exit $LASTEXITCODE): $(Get-Content $errFile.FullName -Raw)"
    }
    $out
  } finally { Remove-Item $errFile.FullName -ErrorAction SilentlyContinue }
}

# 0. The resource providers a new subscription may not have registered yet.
foreach ($p in "Microsoft.Compute", "Microsoft.Network", "Microsoft.KeyVault") {
  Invoke-Az provider register --namespace $p --wait | Out-Null
}

Invoke-Az group create --name $rg --location $location | Out-Null

# 1. Static public IP, so the <ip-with-dashes>.sslip.io hostname survives VM restarts.
Invoke-Az network public-ip create --resource-group $rg --name $ipName --sku Standard --allocation-method Static | Out-Null
$ip = Invoke-Az network public-ip show --resource-group $rg --name $ipName --query ipAddress --output tsv
$publicHost = ($ip -replace '\.', '-') + ".sslip.io"

# 2. Network security group: only 80/443 inbound, no SSH (management is via Run Command).
Invoke-Az network nsg create --resource-group $rg --name $nsgName | Out-Null
Invoke-Az network nsg rule create --resource-group $rg --nsg-name $nsgName --name web --priority 100 `
  --direction Inbound --access Allow --protocol Tcp --destination-port-ranges 80 443 | Out-Null

# 3. Key Vault (RBAC mode) holding a random AES-256 master key that encrypts each person's stored
#    sessions. The key is generated here and goes straight into the vault; it is never printed.
Invoke-Az keyvault create --resource-group $rg --name $kvName --location $location --enable-rbac-authorization true | Out-Null
$kvId = Invoke-Az keyvault show --name $kvName --query id --output tsv
$me   = Invoke-Az ad signed-in-user show --query id --output tsv
Invoke-Az role assignment create --assignee-object-id $me --assignee-principal-type User --role "Key Vault Secrets Officer" --scope $kvId | Out-Null
Start-Sleep -Seconds 45   # role assignments take a moment to apply
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
Invoke-Az keyvault secret set --vault-name $kvName --name master-key --value ([Convert]::ToBase64String($bytes)) | Out-Null
$bytes = $null

# 4. The VM, with a system-assigned managed identity. cloud-init installs Docker and clones the repo
#    but does not start the app (see deploy/README.md).
Invoke-Az vm create --resource-group $rg --name $vmName --image Ubuntu2204 --size $vmSize `
  --public-ip-address $ipName --nsg $nsgName --assign-identity '[system]' `
  --admin-username azureuser --generate-ssh-keys `
  --custom-data (Join-Path $PSScriptRoot "cloud-init.yaml") `
  --os-disk-size-gb 30 | Out-Null

# 5. Let the VM's identity read (only) secrets in this one vault.
$principal = Invoke-Az vm show --resource-group $rg --name $vmName --query identity.principalId --output tsv
Invoke-Az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal `
  --role "Key Vault Secrets User" --scope $kvId | Out-Null

Write-Output "Public host:        $publicHost"
Write-Output "Key Vault URL:      https://$kvName.vault.azure.net"
Write-Output "Next: finish the deploy as described in deploy/README.md."

