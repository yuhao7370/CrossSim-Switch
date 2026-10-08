const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('module/webroot/host-bridge.js','utf8');
const marker='CROSSSIM_BRIDGE_V1';
const probe=command=>command.startsWith("printf '%s\\n'");
const result='CROSSSIM_RESULT:{"ok":true,"uid":0,"enabled":true}';

function fixture(factory,fast=false){
  const calls=[];
  const context=vm.createContext({setTimeout(fn,delay){
    const timer=setTimeout(fn,delay===60000?delay:fast?Math.min(delay,15):delay);
    if(delay===60000)timer.unref();return timer;
  },clearTimeout});
  context.window=context;
  Object.assign(context,factory(context,calls));
  vm.runInContext(source,context);
  return{bridge:vm.runInContext('HostBridge',context),calls,context};
}
test('ksu three-argument callback is negotiated once and reused',async()=>{
  const f=fixture((ctx,calls)=>({ksu:{exec(...args){
    calls.push(args);assert.equal(args.length,3);assert.equal(args[1],'{}');
    queueMicrotask(()=>ctx[args[2]]('0',probe(args[0])?marker:result,''));
  }}}));
  assert.equal((await f.bridge.exec('write-on')).stdout,result);
  assert.equal((await f.bridge.exec('read-list')).code,0);
  assert.equal(f.calls.filter(c=>probe(c[0])).length,1);assert.equal(f.bridge.info(),'ksu/callback3');
});
test('callback2-only native host is detected using harmless probes',async()=>{
  const f=fixture((ctx,calls)=>({ksu:{exec(...args){
    calls.push(args);if(args.length!==2)throw Error('Unsupported signature');
    ctx[args[1]](0,probe(args[0])?marker:result,'');
  }}}));
  await f.bridge.exec('write-on');assert.equal(f.bridge.info(),'ksu/callback2');
  assert.equal(f.calls.filter(c=>c[0]==='write-on').length,1);
  assert.ok(f.calls.slice(0,-1).every(c=>probe(c[0])));
});
test('Promise<void> acknowledgement does not preempt a callback response',async()=>{
  const f=fixture((ctx,calls)=>({ksu:{exec(command,options,callback){
    calls.push(command);setTimeout(()=>ctx[callback](0,probe(command)?marker:result,''),2);
    return Promise.resolve(null);
  }}}));
  assert.equal((await f.bridge.exec('read-list')).stdout,result);
  assert.equal(f.bridge.info(),'ksu/callback3');
});
test('sync-only native host preserves its single-line protocol output',async()=>{
  const f=fixture((ctx,calls)=>({ksu:{exec(...args){
    calls.push(args);if(args.length!==1)throw Error('Unsupported signature');
    return probe(args[0])?marker:result;
  }}}));
  const r=await f.bridge.exec('write-on');assert.equal(r.code,null);assert.equal(r.stdout,result);
  assert.equal(f.bridge.info(),'ksu/direct');assert.equal(f.calls.filter(c=>c[0]==='write-on').length,1);
});
for(const codeField of ['errno','code','exitCode'])test('kernelsu Promise wrapper: '+codeField,async()=>{
  const f=fixture((ctx,calls)=>({kernelsu:{exec(command){
    calls.push(command);return Promise.resolve({[codeField]:0,stdout:probe(command)?marker:result,stderr:''});
  }}}));
  const r=await f.bridge.exec('write-on');assert.equal(r.code,0);assert.equal(r.stdout,result);
  assert.equal(f.bridge.info(),'kernelsu/direct');assert.equal(f.calls.filter(c=>c==='write-on').length,1);
});
test('failed first alias falls back only during read-only discovery',async()=>{
  const f=fixture((ctx,calls)=>({ksu:{exec(command){calls.push(command);throw Error('Unavailable');}},
    kernelsu:{exec(command){calls.push(command);return probe(command)?marker:result;}}}));
  await f.bridge.exec('write-on');assert.equal(f.calls.filter(c=>c==='write-on').length,1);
  assert.equal(f.bridge.info(),'kernelsu/direct');
});
test('exception after dispatching a write never triggers a second transport attempt',async()=>{
  let writes=0;
  const f=fixture((ctx,calls)=>({ksu:{exec(command,options,callback){
    calls.push(command);if(probe(command))ctx[callback](0,marker,'');
    else{writes++;throw Error('Result delivery failed after execution');}
  }}}));
  await assert.rejects(f.bridge.exec('write-on'),/after execution/);
  assert.equal(writes,1);assert.equal(f.calls.length,2);
});
test('timeout after a write is not retried; a late callback is inert',async()=>{
  let late;
  const f=fixture((ctx,calls)=>({ksu:{exec(command,options,callback){
    calls.push(command);if(probe(command))ctx[callback](0,marker,'');else late=callback;
  }}}),true);
  await assert.rejects(f.bridge.exec('write-on'),{code:'BRIDGE_TIMEOUT'});
  assert.equal(f.calls.filter(c=>c==='write-on').length,1);
  assert.doesNotThrow(()=>f.context[late](0,result,''));
});
test('unsupported host cannot receive a real command',async()=>{
  const f=fixture((ctx,calls)=>({ksu:{exec(command){calls.push(command);return undefined;}}}),true);
  await assert.rejects(f.bridge.exec('write-on'),{code:'BRIDGE_UNSUPPORTED'});
  assert.ok(f.calls.every(probe));
});
test('missing host produces a clear error',async()=>{
  const f=fixture(()=>({}));await assert.rejects(f.bridge.exec('write-on'),{code:'BRIDGE_MISSING'});
});
test('concurrent initial requests share one capability probe',async()=>{
  const f=fixture((ctx,calls)=>({ksu:{exec(command,options,callback){
    calls.push(command);queueMicrotask(()=>ctx[callback](0,probe(command)?marker:result,''));
  }}}));
  await Promise.all([f.bridge.exec('read-a'),f.bridge.exec('read-b')]);
  assert.equal(f.calls.filter(probe).length,1);
});
