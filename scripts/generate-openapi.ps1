param(
    [Parameter(Position = 0)]
    [string]$SwaggerPath,

    [string]$Operation
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($SwaggerPath)) {
    $SwaggerPath = $env:SWAGGER_PATH
}

if ([string]::IsNullOrWhiteSpace($SwaggerPath)) {
    throw 'Pass the backend swagger.json path or set SWAGGER_PATH.'
}

$resolvedPath = (Resolve-Path -LiteralPath $SwaggerPath).Path
$match = [regex]::Match($resolvedPath, '^([A-Za-z]):\\(.*)$')
if (-not $match.Success) {
    throw "Expected an absolute Windows Swagger path: $resolvedPath"
}
$drive = $match.Groups[1].Value.ToLowerInvariant()
$relativePath = $match.Groups[2].Value.Replace('\', '/')
$wslPath = "/mnt/$drive/$relativePath"

$generatorArgs = @($wslPath)
if (-not [string]::IsNullOrWhiteSpace($Operation)) {
    $generatorArgs += @('--operation', $Operation)
}

& npm.cmd run generate -- @generatorArgs
exit $LASTEXITCODE
