# One-time AWS provisioning for the hosted politemall-mcp server.
# Requires the AWS CLI configured with a profile named "politemall-mcp" scoped by deploy/iam-policy.json.
# This is a record of what was run interactively — re-running end-to-end is not idempotent as-is.

$env:AWS_PROFILE = "politemall-mcp"
$env:AWS_DEFAULT_REGION = "ap-southeast-1"

# 1. Networking: use the default VPC's first public subnet.
$vpcId = aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query "Vpcs[0].VpcId" --output text

# 2. Security group: only 80/443 inbound, no SSH (management is via SSM Session Manager).
$sgId = aws ec2 create-security-group --group-name politemall-mcp-sg --description "politemall-mcp web (80/443 only)" --vpc-id $vpcId --query "GroupId" --output text
aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 443 --cidr 0.0.0.0/0

# 3. IAM role for the instance: SSM (management) + read-only access to this project's Secrets Manager path.
aws iam create-role --role-name politemall-mcp-ec2-role --assume-role-policy-document file://deploy/ec2-trust-policy.json
aws iam attach-role-policy --role-name politemall-mcp-ec2-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam put-role-policy --role-name politemall-mcp-ec2-role --policy-name secrets-read --policy-document file://deploy/ec2-secrets-policy.json
aws iam create-instance-profile --instance-profile-name politemall-mcp-instance-profile
aws iam add-role-to-instance-profile --instance-profile-name politemall-mcp-instance-profile --role-name politemall-mcp-ec2-role

# 4. Secrets Manager: random AES-256 master key used to encrypt each user's D2L session cookies at rest.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$masterKey = [Convert]::ToBase64String($bytes)
aws secretsmanager create-secret --name politemall-mcp/master-key --secret-string $masterKey
$masterKey = $null; $bytes = $null

# 5. Launch the instance. user-data.sh installs Docker, clones the public repo, and builds the
#    login-session image. It does NOT start the app — see deploy/finalize.ps1 for that (it needs
#    the instance's public DNS name and per-teammate tokens, which don't exist yet at launch time).
$amiId = (aws ec2 describe-images --owners amazon --filters "Name=name,Values=al2023-ami-2023.*-x86_64" "Name=state,Values=available" --output json | ConvertFrom-Json).Images |
  Sort-Object CreationDate -Descending | Select-Object -First 1 -ExpandProperty ImageId

$instanceId = aws ec2 run-instances `
  --image-id $amiId `
  --instance-type t3.small `
  --subnet-id subnet-0d8e745db690f05fa `
  --security-group-ids $sgId `
  --iam-instance-profile Name=politemall-mcp-instance-profile `
  --associate-public-ip-address `
  --user-data file://deploy/user-data.sh `
  --block-device-mappings file://deploy/block-device-mappings.json `
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=politemall-mcp}]" `
  --query "Instances[0].InstanceId" --output text

Write-Output "Instance: $instanceId"
