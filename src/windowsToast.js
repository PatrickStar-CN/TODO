const TOAST_APP_ID = 'app.todotools';
const TOAST_DISPLAY_NAME = 'TODO Tools';
const TOAST_ICON_NAME = 'todo-tools-toast-icon.png';

let toastIconPathPromise = null;
let toastRegistrationPromise = null;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function utf8ToBase64(value) {
  return bytesToBase64(new TextEncoder().encode(value));
}

function encodePowerShellCommand(script) {
  const bytes = new Uint8Array(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = code >>> 8;
  }
  return bytesToBase64(bytes);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isWindows() {
  const neutralinoOS = typeof NL_OS === 'string' ? NL_OS : '';
  return /^win/i.test(neutralinoOS);
}

async function ensureToastIcon() {
  if (!toastIconPathPromise) {
    toastIconPathPromise = (async () => {
      const tempPath = await Neutralino.os.getPath('temp');
      const iconPath = `${tempPath.replace(/[\\/]+$/, '')}\\${TOAST_ICON_NAME}`;
      const response = await fetch(new URL('./icon.png', window.location.href));
      if (!response.ok) throw new Error(`Unable to load notification icon (${response.status})`);
      await Neutralino.filesystem.writeBinaryFile(iconPath, await response.arrayBuffer());
      return iconPath;
    })().catch((error) => {
      toastIconPathPromise = null;
      throw error;
    });
  }
  return toastIconPathPromise;
}

function buildToastXml(title, content, iconPath) {
  const iconUri = encodeURI(`file:///${iconPath.replace(/\\/g, '/')}`);
  return `<toast duration="short">
    <visual>
      <binding template="ToastGeneric">
        <image placement="appLogoOverride" hint-crop="none" src="${escapeXml(iconUri)}"/>
        <text>${escapeXml(title)}</text>
        <text>${escapeXml(content)}</text>
      </binding>
    </visual>
    <audio src="ms-winsoundevent:Notification.Reminder"/>
  </toast>`;
}

async function runPowerShell(script) {
  const encodedCommand = encodePowerShellCommand(script);
  const result = await Neutralino.os.execCommand(
    `powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ${encodedCommand}`
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stdErr || `PowerShell exited with code ${result.exitCode}`);
  }
}

export async function registerWindowsToastApp() {
  if (!isWindows() || typeof Neutralino?.os?.execCommand !== 'function') return false;
  if (!toastRegistrationPromise) {
    toastRegistrationPromise = (async () => {
      const iconPath = await ensureToastIcon();
      const appIdBase64 = utf8ToBase64(TOAST_APP_ID);
      const displayNameBase64 = utf8ToBase64(TOAST_DISPLAY_NAME);
      const iconPathBase64 = utf8ToBase64(iconPath);
      const script = [
        "$ErrorActionPreference = 'Stop'",
        `$appId = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${appIdBase64}'))`,
        `$displayName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${displayNameBase64}'))`,
        `$iconPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${iconPathBase64}'))`,
        `$appKey = 'HKCU:\\Software\\Classes\\AppUserModelId\\' + $appId`,
        `$settingsKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\' + $appId`,
        `New-Item -Path $appKey -Force | Out-Null`,
        `New-ItemProperty -Path $appKey -Name DisplayName -Value $displayName -PropertyType ExpandString -Force | Out-Null`,
        `New-ItemProperty -Path $appKey -Name IconUri -Value $iconPath -PropertyType ExpandString -Force | Out-Null`,
        `New-ItemProperty -Path $appKey -Name IconBackgroundColor -Value 'FF2563EB' -PropertyType String -Force | Out-Null`,
        `New-Item -Path $settingsKey -Force | Out-Null`,
        `New-ItemProperty -Path $settingsKey -Name ShowInActionCenter -Value 1 -PropertyType DWord -Force | Out-Null`
      ].join('; ');
      await runPowerShell(script);
      return true;
    })().catch((error) => {
      toastRegistrationPromise = null;
      throw error;
    });
  }
  return toastRegistrationPromise;
}

export async function showWindowsToast(title, content) {
  if (!isWindows() || typeof Neutralino?.os?.execCommand !== 'function') return false;

  try {
    await registerWindowsToastApp();
    const iconPath = await ensureToastIcon();
    const toastXmlBase64 = utf8ToBase64(buildToastXml(title, content, iconPath));
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null`,
      `[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null`,
      `$toastXml = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${toastXmlBase64}'))`,
      '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
      '$xml.LoadXml($toastXml)',
      '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${TOAST_APP_ID}').Show($toast)`
    ].join('; ');
    await runPowerShell(script);
    return true;
  } catch (error) {
    console.warn('[reminder] Windows toast failed:', error);
    return false;
  }
}
