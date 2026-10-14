// electron-builder afterPack hook: gives the packaged SKYFALL.exe its icon and version information
// (what Explorer, the taskbar and the installer show) with resedit, a pure-JS PE resource editor, so
// Windows builds work on Linux/macOS CI without Wine/rcedit.

const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { NtExecutable, NtExecutableResource, Resource, Data } = await import('resedit');
  const info = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const ico = path.join(context.packager.projectDir, 'build', 'icon.ico');

  const pe = NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = NtExecutableResource.from(pe);

  // replace the first icon group (Electron's default icon) with ours
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, Data.IconFile.from(fs.readFileSync(ico)).icons.map((i) => i.data));

  const [major, minor, patch] = info.version.split('.').map((n) => parseInt(n, 10) || 0);
  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] || Resource.VersionInfo.createEmpty();
  const lang = { lang: 1033, codepage: 1200 };
  vi.setFileVersion(major, minor, patch, 0, 1033);
  vi.setProductVersion(major, minor, patch, 0, 1033);
  vi.setStringValues(lang, {
    ProductName: info.productName,
    FileDescription: info.productName,
    CompanyName: info.companyName || info.productName,
    LegalCopyright: info.copyright || '',
    OriginalFilename: `${info.productFilename}.exe`,
    InternalName: info.productFilename,
    FileVersion: info.version,
    ProductVersion: info.version,
  });
  vi.removeStringValue(lang, 'SquirrelAwareVersion'); // Electron's stub default; SKYFALL doesn't use Squirrel
  vi.outputToResourceEntries(res.entries);

  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log(`  • afterPack: icon + version ${info.version} written to ${path.basename(exe)}`);
};
