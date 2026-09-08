import {validateBuild} from './model.mjs';

export function compileInBrowser(config) {
  config=validateBuild(config);
  if(typeof Worker!=='function'||!globalThis.crypto?.subtle)throw new Error('HTTPS와 Web Worker를 지원하는 브라우저에서 열어주세요.');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./compiler-worker.js',import.meta.url));
    const id=crypto.randomUUID();
    const finish=(error,result)=>{clearTimeout(timeout);worker.terminate();if(error)reject(error);else resolve(result);};
    const timeout=setTimeout(()=>finish(new Error('컴파일 시간이 초과됐습니다. 연결을 확인하고 다시 시도하세요.')),90000);
    worker.onmessage=({data})=>{if(data.id===id)finish(data.error?new Error(data.error):null,data.artifact);};
    worker.onerror=()=>finish(new Error('브라우저 컴파일러를 실행하지 못했습니다. 페이지를 새로고침하고 다시 시도하세요.'));
    worker.postMessage({id,config});
  });
}
