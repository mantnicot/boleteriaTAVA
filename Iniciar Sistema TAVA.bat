@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Inicio Sistema Boleteria TAVA

cd /d "%~dp0"

set "APP_URL=http://localhost:3000/#inicio"
set "HEALTH_URL=http://localhost:3000/api/health"
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\Sistema Boleteria TAVA.lnk"
set "TARGET_PATH=%~f0"
set "WORK_DIR=%~dp0"
set "ICON_FILE=%CD%\tava-shortcut.ico"
set "ICON_LOCATION=%SystemRoot%\System32\shell32.dll,176"

echo =============================================
echo   Inicio automatico Sistema Boleteria TAVA
echo =============================================
echo.

rem Crea/actualiza un unico acceso directo en el escritorio con icono personalizado.
call :ensure_icon
call :create_shortcut

call :healthcheck
if not errorlevel 1 (
  start "" "%APP_URL%"
  echo El sistema ya estaba ejecutandose.
  exit /b 0
)

echo [1/4] Verificando Node.js...
where node >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo Node.js no encontrado. Instalando Node.js LTS...
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  )
  set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] No se pudo instalar/encontrar Node.js.
    echo Instala Node.js LTS desde https://nodejs.org y vuelve a dar clic.
    pause
    exit /b 1
  )
)

where npm >nul 2>nul
if errorlevel 1 (
  set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] npm no esta disponible.
    echo Reinstala Node.js LTS y vuelve a dar clic.
    pause
    exit /b 1
  )
)

echo [2/4] Verificando dependencias...
call :deps_ready
if errorlevel 1 (
  echo Faltan dependencias criticas. Intentando instalar/reparar...
  call :install_deps
  if errorlevel 1 (
    echo [ADVERTENCIA] npm fallo, pero validare si alcanza para iniciar.
    call :deps_ready
    if errorlevel 1 (
      echo [ERROR] Faltan modulos criticos y npm no pudo repararlos.
      echo Ejecuta este archivo otra vez o reinstala Node.js LTS.
      pause
      exit /b 1
    )
  )
) else (
  echo Dependencias listas.
)

echo [3/4] Verificando archivo .env...
if not exist ".env" if exist ".env.example" (
  copy /Y ".env.example" ".env" >nul
)

echo [4/4] Iniciando sistema...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList '/c','cd /d ""%CD%"" && node server/index.js' -WorkingDirectory '%CD%'" >nul 2>nul

set /a ATTEMPTS=45
:wait_server
call :healthcheck
if not errorlevel 1 (
  start "" "%APP_URL%"
  echo Sistema iniciado correctamente.
  timeout /t 1 >nul
  exit /b 0
)
set /a ATTEMPTS-=1
if !ATTEMPTS! LEQ 0 goto :start_error
timeout /t 1 >nul
goto :wait_server

:start_error
echo [ERROR] El servidor no respondio en localhost:3000.
echo Abre esta carpeta y ejecuta "node server/index.js" para ver el detalle.
pause
exit /b 1

:deps_ready
set "DEPS_OK=1"
for %%D in (express googleapis multer nodemailer pdf-lib exceljs sharp) do (
  if not exist "node_modules\%%D\package.json" set "DEPS_OK=0"
)
if "%DEPS_OK%"=="1" exit /b 0
exit /b 1

:install_deps
echo Intento 1/4: npm install...
call npm cache verify >nul 2>nul
call npm install --no-audit --no-fund
if not errorlevel 1 exit /b 0

echo Intento 2/4: limpiar cache npm e intentar de nuevo...
call npm cache clean --force >nul 2>nul
call npm install --no-audit --no-fund
if not errorlevel 1 exit /b 0

where winget >nul 2>nul
if not errorlevel 1 (
  echo Intento 3/4: reparar Node.js + npm con winget...
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements --force
  set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
  call npm install --no-audit --no-fund
  if not errorlevel 1 exit /b 0
)

echo Intento 4/4: plan B con pnpm...
call :install_with_pnpm
if not errorlevel 1 exit /b 0

echo Plan C: intentar con yarn...
call :install_with_yarn
if not errorlevel 1 exit /b 0

exit /b 1

:install_with_pnpm
where pnpm >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 exit /b 1
  winget install -e --id pnpm.pnpm --silent --accept-package-agreements --accept-source-agreements
)
set "PATH=%LocalAppData%\pnpm;%ProgramFiles%\pnpm;%PATH%"
where pnpm >nul 2>nul
if errorlevel 1 exit /b 1
call pnpm install --no-frozen-lockfile
if not errorlevel 1 exit /b 0
exit /b 1

:install_with_yarn
where yarn >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 exit /b 1
  winget install -e --id Yarn.Yarn --silent --accept-package-agreements --accept-source-agreements
)
set "PATH=%LocalAppData%\Yarn\bin;%ProgramFiles(x86)%\Yarn\bin;%ProgramFiles%\Yarn\bin;%PATH%"
where yarn >nul 2>nul
if errorlevel 1 exit /b 1
call yarn install
if not errorlevel 1 exit /b 0
exit /b 1

:ensure_icon
if exist "%CD%\logo-tava.ico" (
  set "ICON_LOCATION=%CD%\logo-tava.ico"
  exit /b 0
)
if exist "%CD%\public\assets\logo-tava.ico" (
  set "ICON_LOCATION=%CD%\public\assets\logo-tava.ico"
  exit /b 0
)
if exist "%ICON_FILE%" (
  set "ICON_LOCATION=%ICON_FILE%"
  exit /b 0
)

rem Genera un icono local simple (TAVA) si no existe uno .ico.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Add-Type -AssemblyName System.Drawing; $bmp=New-Object System.Drawing.Bitmap 256,256; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias; $bg=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,40,44,52)); $fg=New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,255,255,255)); $g.FillRectangle($bg,0,0,256,256); $font=New-Object System.Drawing.Font('Segoe UI',64,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel); $sf=New-Object System.Drawing.StringFormat; $sf.Alignment='Center'; $sf.LineAlignment='Center'; $g.DrawString('TAVA',$font,$fg,(New-Object System.Drawing.RectangleF(0,0,256,256)),$sf); $icon=[System.Drawing.Icon]::FromHandle($bmp.GetHicon()); $fs=[System.IO.File]::Open('%ICON_FILE%',[System.IO.FileMode]::Create); $icon.Save($fs); $fs.Close(); $icon.Dispose(); $font.Dispose(); $fg.Dispose(); $bg.Dispose(); $g.Dispose(); $bmp.Dispose() } catch {}" >nul 2>nul
if exist "%ICON_FILE%" set "ICON_LOCATION=%ICON_FILE%"
exit /b 0

:create_shortcut
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($env:SHORTCUT_PATH); $s.TargetPath=$env:TARGET_PATH; $s.WorkingDirectory=$env:WORK_DIR; $s.IconLocation=$env:ICON_LOCATION; $s.Save()" >nul 2>nul
exit /b 0

:healthcheck
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-RestMethod -Uri '%HEALTH_URL%' -TimeoutSec 2; if($r.ok -eq $true){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
exit /b %ERRORLEVEL%
