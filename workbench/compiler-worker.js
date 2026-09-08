/* The pinned self-hosted solc binary compiles in an isolated worker, never a remote API. */
let ready;
self.onmessage=async({data})=>{
  try {
    if(!ready)ready=(async()=>{
      const [core,response]=await Promise.all([import('./artifact-core.mjs'),fetch('./compiler-input.json')]);
      if(!response.ok)throw new Error('컴파일 소스를 불러오지 못했습니다.');
      const input=await response.json();
      importScripts('./vendor/soljson-0.8.30.js');
      if(!self.Module?.cwrap)throw new Error('컴파일러를 초기화하지 못했습니다.');
      return {core,input,compile:self.Module.cwrap('solidity_compile','string',['string','number','number']),version:self.Module.cwrap('solidity_version','string',[])(),reset:self.Module.cwrap('solidity_reset',null,[])};
    })();
    const {core,input,compile,version,reset}=await ready;
    let output;try{output=JSON.parse(compile(JSON.stringify(input),0,0));}finally{reset();}
    const compiled=core.compilerResult(input,output,version);
    const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
    const sourceHash=await digest(JSON.stringify(input));
    const artifact=core.bindBuild(compiled,data.config,sourceHash,await digest(JSON.stringify({config:data.config,sourceHash})));
    self.postMessage({id:data.id,artifact});
  }catch(error){ready=null;self.postMessage({id:data.id,error:error.message});}
};
