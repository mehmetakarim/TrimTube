// One entry point locally and in CI. A stale report can never pass a fresh run.
const {spawnSync}=require('child_process');
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
function run(command,args,timeout=180000,extraEnv={}) {
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;Object.assign(env,extraEnv);
 const result=spawnSync(command,args,{cwd:root,env,stdio:'inherit',windowsHide:true,timeout});
 if(result.error || result.status!==0) throw Error(`Test failed: ${args.join(' ')} (${result.error?.code || result.status})`);
}
function report(relative,minimum,action) {
 const file=path.join(root,relative);if(fs.existsSync(file))fs.unlinkSync(file);
 action();
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(data.failure || data.errors?.length || !Array.isArray(data.checks) || data.checks.length<minimum) throw Error(`Incomplete or failed report: ${relative}`);
 console.log(`Verified ${relative}: ${data.checks.length} checks`);
}
try {
 for(const name of ['check-secure-settings','check-transcripts','check-timeline','check-review','check-providers','check-voice-video']) run(process.execPath,[`scripts/${name}.cjs`]);
 if(process.argv.includes('--integration')) {
  const venv=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  run(fs.existsSync(venv)?venv:process.platform==='win32'?'python':'python3',['scripts/check_tracker.py']);
  report('build/media-qa/results.json',43,()=>run(process.execPath,['scripts/check-media.cjs']));
  report('build/studio-qa/results.json',149,()=>run(require('electron'),['--no-sandbox','--in-process-gpu','scripts/check-studio.cjs']));
  // Anlatımlı video: uygulamanın kullandığı Electron Node'u ile gerçek HyperFrames render (ilk çalıştırmada tarayıcı bileşeni indirilir)
  report('build/voice-video-qa/results.json',24,()=>run(require('electron'),['scripts/check-voice-video.cjs','--render','--report'],600000,{ELECTRON_RUN_AS_NODE:'1'}));
 }
} catch(err) {console.error(err.message);process.exitCode=1;}
