const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const bash=process.env.CROSSSIM_TEST_BASH||(process.platform==='win32'?'C:/Program Files/Git/usr/bin/bash.exe':'/bin/bash');
const posix=p=>p.replace(/\\/g,'/').replace(/^([A-Z]):/i,(_,drive)=>'/'+drive.toLowerCase());
const installer=posix(path.resolve('module/customize.sh'));
fs.mkdirSync(path.resolve('build'),{recursive:true});
const root=fs.mkdtempSync(path.join(path.resolve('build'),'installer-test-'));
fs.mkdirSync(path.join(root,'webroot'));
fs.writeFileSync(path.join(root,'bridge.jar'),'test fixture');
fs.writeFileSync(path.join(root,'control.sh'),'test fixture');
fs.writeFileSync(path.join(root,'webroot/index.html'),'test fixture');
function run(extra={},modpath=root){
  return spawnSync(bash,['-s'],{encoding:'utf8',input:`
ui_print() { printf '%s\\n' "$*"; }
abort() { printf 'ABORT: %s\\n' "$*"; exit 42; }
set_perm() { perm_target="$1"; printf 'PERM: %s %s\\n' "\${perm_target##*/}" "$4"; }
. "$CROSSSIM_TEST_INSTALLER"
`,env:{...process.env,API:'36',BOOTMODE:'true',KSU:'',KSU_KERNEL_VER_CODE:'',APATCH:'',APATCH_VER:'',MAGISK_VER_CODE:'',
    MODPATH:posix(modpath),CROSSSIM_TEST_INSTALLER:installer,...extra}});
}
for(const [label,env,expected] of [
  ['KernelSU',{KSU:'true',KSU_KERNEL_VER_CODE:'12345'},/KernelSU family/],
  ['SukiSU compatible flags',{KSU:'true',KSU_KERNEL_VER_CODE:'40796',MAGISK_VER_CODE:'28000'},/KernelSU family/],
  ['Magisk current',{MAGISK_VER_CODE:'31000'},/Root manager: Magisk/],
  ['APatch',{APATCH:'true'},/Root manager: APatch/]
])test('installer environment contract: '+label,()=>{
  const r=run(env);assert.equal(r.status,0,r.stderr+r.stdout);assert.match(r.stdout,expected);
  assert.match(r.stdout,/PERM: bridge.jar 0644/);assert.match(r.stdout,/PERM: action.sh 0755/);
});
test('older Magisk gets the missing Action warning but can still install',()=>{
  const r=run({MAGISK_VER_CODE:'27000'});assert.equal(r.status,0);assert.match(r.stdout,/no native module Action button/);
});
test('unsupported Android and malformed API values are rejected',()=>{
  assert.equal(run({API:'30'}).status,42);assert.equal(run({API:'not-an-api'}).status,42);
});
test('incomplete module is rejected before claiming successful installation',()=>{
  const missing=fs.mkdtempSync(path.join(path.resolve('build'),'installer-missing-'));
  const r=run({},missing);assert.equal(r.status,42);assert.match(r.stdout,/Missing bridge.jar/);
});
