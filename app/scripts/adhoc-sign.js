const { execFileSync } = require('child_process');
const path = require('path');

// electron-builder edits the bundle after Electron's stock signature, which
// leaves an invalid signature that Apple Silicon reports as "damaged".
exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
