'use strict';
// Negotiate transport with a read-only probe. Never replay a real command on failure.
const HostBridge = (() => {
  const marker='CROSSSIM_BRIDGE_V1';
  const probe="printf '%s\\n' '"+marker+"'";
  let selected=null, selecting=null, serial=0;
  const failure=code=>Object.assign(new Error(code),{code});

  function normalize(value) {
    if(typeof value==='string')return {code:null,stdout:value,stderr:''};
    if(!value || typeof value!=='object' || !('stdout' in value))throw failure('BRIDGE_INVALID_RESULT');
    const raw=value.errno ?? value.exitCode ?? value.code ?? null;
    const code=raw===null?null:Number(raw);
    if(code!==null && !Number.isInteger(code))throw failure('BRIDGE_INVALID_RESULT');
    return {code,stdout:String(value.stdout??''),stderr:String(value.stderr??'')};
  }
  function invoke(transport,command,timeout) {
    return new Promise((resolve,reject)=>{
      let settled=false;
      const callback='crosssim_bridge_'+(++serial);
      const timer=setTimeout(()=>finish(failure('BRIDGE_TIMEOUT')),timeout);
      function finish(error,value) {
        if(settled)return;
        settled=true;clearTimeout(timer);
        if(transport.mode!=='direct') {
          // Some hosts can deliver a callback after a timeout or twice.
          window[callback]=()=>{};
          setTimeout(()=>delete window[callback],60000);
        }
        if(error)reject(error);else resolve(value);
      }
      function direct(value) {try{finish(null,normalize(value));}catch(error){finish(error);}}
      if(transport.mode!=='direct')window[callback]=(code,stdout,stderr)=>direct({code,stdout,stderr});
      try {
        let result;
        if(transport.mode==='callback3')result=transport.api.exec(command,'{}',callback);
        else if(transport.mode==='callback2')result=transport.api.exec(command,callback);
        else result=transport.api.exec(command);
        if(result && typeof result.then==='function')result.then(value=>{
          if(value!==undefined && value!==null)direct(value);
          else if(transport.mode==='direct')finish(failure('BRIDGE_INVALID_RESULT'));
        },error=>finish(error));
        else if(result!==undefined && result!==null)direct(result);
        else if(transport.mode==='direct')finish(failure('BRIDGE_INVALID_RESULT'));
      } catch(error) {finish(error);}
    });
  }
  async function discover() {
    const candidates=[];
    for(const name of ['ksu','kernelsu']) {
      const api=window[name];
      if(api && typeof api.exec==='function' && !candidates.some(c=>c.api===api))candidates.push({name,api});
    }
    if(!candidates.length)throw failure('BRIDGE_MISSING');
    let lastError;
    for(const candidate of candidates) {
      const modes=candidate.name==='kernelsu'?['direct','callback3','callback2']:['callback3','callback2','direct'];
      for(const mode of modes) {
        const transport={...candidate,mode};
        try {
          const result=await invoke(transport,probe,2000);
          if((result.code===null || result.code===0) && result.stdout.split(/\r?\n/).some(line=>line.trim()===marker)) {
            selected=transport;return transport;
          }
          lastError=result.stderr || 'Probe output not recognized';
        } catch(error) {lastError=error.message;}
      }
    }
    throw Object.assign(failure('BRIDGE_UNSUPPORTED'),{detail:lastError});
  }
  async function ready() {
    if(selected)return selected;
    if(!selecting)selecting=discover().finally(()=>{selecting=null;});
    return selecting;
  }
  return {
    async exec(command) {return invoke(await ready(),command,20000);},
    info:()=>selected?selected.name+'/'+selected.mode:null
  };
})();
