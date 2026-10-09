// electron-builder afterPack: onnxruntime-node (yerel seslendirme) her platform ve mimari
// için ikili taşır (~300 MB). Pakette yalnız hedefin kendi ikilisi kalır. Dosya desenlerindeki
// ${platform} makrosu derlemenin yapıldığı makineye göre açıldığı için bu iş burada, hedefe
// (context.electronPlatformName / context.arch) göre yapılır.
const fs = require('fs');
const path = require('path');
const { Arch } = require('builder-util');

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName; // win32 | darwin | linux
  const arch = Arch[context.arch]; // x64 | arm64 | ...
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const bin = path.join(resources, 'app', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
  if (!fs.existsSync(bin)) throw Error('onnxruntime-node ikilileri pakette bulunamadı: ' + bin);
  for (const os of fs.readdirSync(bin)) {
    for (const cpu of fs.readdirSync(path.join(bin, os))) {
      if (os !== platform || cpu !== arch) fs.rmSync(path.join(bin, os, cpu), { recursive: true, force: true });
    }
    if (!fs.readdirSync(path.join(bin, os)).length) fs.rmSync(path.join(bin, os), { recursive: true, force: true });
  }
  const kept = path.join(bin, platform, arch);
  if (!fs.existsSync(kept) || !fs.readdirSync(kept).some(f => f.startsWith('onnxruntime_binding'))) throw Error(`Yerel seslendirme çalışma zamanı ${platform}/${arch} için yok.`);
  if (!fs.existsSync(path.join(resources, 'ema', 'ema_sound.onnx'))) throw Error('EMA modelleri pakette yok (node scripts/fetch-ema.js çalıştırılmadı mı?).');
  console.log(`  • yerel seslendirme: ${platform}/${arch} çalışma zamanı ve modeller pakette`);
};
