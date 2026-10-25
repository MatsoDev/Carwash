# Carwash POS updater (Windows PowerShell 5+)
# Downloads the latest GitHub release ZIP, keeps a backup, and copies files over.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'MatsoDev/Carwash'
$Root = Split-Path -Parent $PSScriptRoot
$VersionFile = Join-Path $Root 'version.json'
$BackupsDir = Join-Path $Root 'backups'

function Say($text) { Write-Host $text }
function Fail($text) {
  Write-Host ""
  Write-Host "⚠️  $text" -ForegroundColor Red
  Write-Host "    البيانات المحفوظة في المتصفح (IndexedDB) مش بتتأثر بتحديث الملفات." -ForegroundColor DarkGray
  exit 1
}

Say ""
Say "════════════════════════════════════════"
Say "   تحديث مغسلة سيارات (Carwash POS)"
Say "════════════════════════════════════════"
Say ""

try {
  $local = Get-Content -LiteralPath $VersionFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $current = [string]$local.version
} catch {
  Fail "مش قادر أقرأ version.json. تأكد إنك شغّلت الملف من داخل مجلد التطبيق."
}
Say "النسخة الحالية: v$current"
Say ""

Say "قبل التحديث: من الإعدادات ← النسخ الاحتياطي، اعمل نسخة JSON."
$answer = Read-Host "هل أخدت نسخة احتياطية؟ اكتب y للمتابعة أو n للإلغاء"
if ($answer -notmatch '^(y|Y|yes|نعم)$') {
  Say "تم الإلغاء. اعمل النسخة الاحتياطية الأول وبعدين شغّل update.bat تاني."
  exit 0
}

Say ""
Say "بجيب آخر إصدار من GitHub..."
$headers = @{ 'User-Agent' = 'Carwash-POS-Updater'; 'Accept' = 'application/vnd.github+json' }
try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -TimeoutSec 30
} catch {
  Fail "مفيش نت أو GitHub مش متاح دلوقتي. جرّب تاني لما النت يرجع."
}

$latest = ([string]$release.tag_name).TrimStart('v')
if ([string]::IsNullOrWhiteSpace($latest)) { $latest = [string]$release.name }

function VersionValue($v) {
  $parts = ($v -split '\.') | ForEach-Object { [int]($_ -replace '[^0-9].*$', '') }
  while ($parts.Count -lt 3) { $parts += 0 }
  return ($parts[0] * 1000000) + ($parts[1] * 1000) + $parts[2]
}

if ((VersionValue $latest) -le (VersionValue $current)) {
  Say ""
  Say "✅ إنت بالفعل على أحدث نسخة (v$current)."
  exit 0
}
Say "فيه نسخة جديدة: v$latest"

$asset = $release.assets | Where-Object { $_.name -like 'carwash-pos-*.zip' } | Select-Object -First 1
if (-not $asset) { Fail "الإصدار الجديد مش فيه ملف ZIP اسمه carwash-pos-vX.Y.Z.zip." }

New-Item -ItemType Directory -Force -Path $BackupsDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$backupZip = Join-Path $BackupsDir "pre-update-v$current-$stamp.zip"
Say "بعمل نسخة احتياطية من ملفات البرنامج..."
try {
  $items = Get-ChildItem -LiteralPath $Root -Force | Where-Object { $_.Name -notin @('backups', '.git') }
  Compress-Archive -Path $items.FullName -DestinationPath $backupZip -Force
  Say "النسخة الاحتياطية: $backupZip"
} catch {
  Fail "مش قادر أعمل نسخة احتياطية من الملفات: $($_.Exception.Message)"
}

$tempZip = Join-Path $env:TEMP "carwash-update-$stamp.zip"
$tempDir = Join-Path $env:TEMP "carwash-update-$stamp"
Say "بنزّل التحديث..."
try {
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempZip -UseBasicParsing -TimeoutSec 180
} catch {
  Fail "فشل تحميل التحديث. جرّب تاني أو نزّل الـ ZIP من صفحة الإصدارات."
}

Say "بفك ضغط الملف..."
try {
  Expand-Archive -LiteralPath $tempZip -DestinationPath $tempDir -Force
} catch {
  Fail "ملف التحديث تالف أو مش ZIP سليم."
}

# If the archive has a single top-level folder, use it.
$inner = @(Get-ChildItem -LiteralPath $tempDir -Force)
if ($inner.Count -eq 1 -and $inner[0].PSIsContainer) { $tempDir = $inner[0].FullName }

if (-not (Test-Path (Join-Path $tempDir 'index.html'))) {
  Fail "ملف التحديث مش فيه index.html. التحديث مش هيتطبق."
}

# Make sure this is the new version.
try {
  $newMeta = Get-Content -LiteralPath (Join-Path $tempDir 'version.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ((VersionValue ([string]$newMeta.version)) -lt (VersionValue $latest)) {
    Fail "نسخة الملفات ($($newMeta.version)) أقدم من الإصدار المعلن ($latest)."
  }
} catch {
  Fail "version.json جوه ملف التحديث ناقص أو تالف."
}

Say "بنطبق التحديث (ملفاتك القديمة اتنسخت في backups)..."
try {
  $exclude = @('backups', '.git')
  Get-ChildItem -LiteralPath $tempDir -Force | Where-Object { $_.Name -notin $exclude } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Root -Recurse -Force
  }
} catch {
  Fail "حصل خطأ أثناء نسخ الملفات: $($_.Exception.Message). تقدر ترجع للنسخة الاحتياطية من مجلد backups."
}

Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Say ""
Say "✅ تم التحديث إلى v$latest."
Say "   - بيانات الفواتير والعملاء محفوظة زي ما هي (في المتصفح)."
Say "   - فك ضغط ZIP فوق المجلد القديم كان ممكن كمان، لكن update.bat عملها أوتوماتيك."
Say "   - شغّل start.bat دلوقتي."
Say ""
$open = Read-Host "تحب أفتح start.bat دلوقتي؟ (y/n)"
if ($open -match '^(y|Y|yes|نعم)$') {
  Start-Process -FilePath (Join-Path $Root 'start.bat') -WorkingDirectory $Root
}
