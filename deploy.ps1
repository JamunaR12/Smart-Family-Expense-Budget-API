# deploy.ps1 — one-command build + trim + deploy for the Smart Family Expense API.
# Run from the project root in PowerShell:  .\deploy.ps1
# If PowerShell blocks it ("running scripts is disabled"), run instead:
#   powershell -ExecutionPolicy Bypass -File .\deploy.ps1

$ErrorActionPreference = 'Stop'

if (-not (Test-Path package.json)) {
    throw "Run this from the project root (the folder with package.json)."
}

# 1. Generate the Prisma client and build the NestJS app (dist/)
npm run sam:prebuild
if ($LASTEXITCODE -ne 0) { throw "sam:prebuild failed" }

# 2. SAM build (no cache, so the fresh dist/ is packed)
sam build --no-cached
if ($LASTEXITCODE -ne 0) { throw "sam build failed" }

$build = ".aws-sam\build\ApiFunction"

# 3. Remove dev-only packages that bloat the Lambda package (verified runtime-safe)
Remove-Item -Recurse -Force "$build\node_modules\prisma" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$build\node_modules\effect" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$build\node_modules\typescript" -ErrorAction SilentlyContinue

# 4. Copy the real generated Prisma client over the placeholder stubs
#    (SAM's npm pack only writes placeholder stubs into .prisma/client)
Remove-Item -Recurse -Force "$build\node_modules\.prisma" -ErrorAction SilentlyContinue
Copy-Item -Recurse "node_modules\.prisma" "$build\node_modules\.prisma"

# 5. Drop the Windows engine (Lambda is Linux; keep the rhel .so.node)
Remove-Item -Force "$build\node_modules\.prisma\client\query_engine-windows.dll.node" -ErrorAction SilentlyContinue

# 6. Drop the non-PostgreSQL WASM engine files (the database is PostgreSQL)
Get-ChildItem "$build\node_modules\@prisma\client\runtime" -File |
    Where-Object { $_.Name -match 'mysql|cockroachdb|sqlserver|sqlite' } |
    Remove-Item -Force

# 7. Size check (Lambda unzipped limit is 262,144,000 bytes)
$size = (Get-ChildItem -Recurse $build | Measure-Object -Property Length -Sum).Sum
Write-Host "Package size: $size bytes (limit 262144000)"
if ($size -ge 262144000) { throw "Package is still over the Lambda size limit." }

# 8. Deploy
sam deploy --stack-name smart-expense-budget-api --region us-east-2 --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset --parameter-overrides DatabaseUrl=/expense/database-url JwtSecret=/expense/jwt-secret PlatformTimezone=UTC LambdaSecurityGroupId=sg-097b84b98107dc684 PrivateSubnetIds=subnet-07c99c2e61d3a861a,subnet-029669b4442a9c0e9
if ($LASTEXITCODE -ne 0) { throw "sam deploy failed" }

Write-Host "Deploy done. Health: https://hx05d7xp0j.execute-api.us-east-2.amazonaws.com/api/v1/health"
Write-Host "Docs:   https://hx05d7xp0j.execute-api.us-east-2.amazonaws.com/api/v1/docs"
