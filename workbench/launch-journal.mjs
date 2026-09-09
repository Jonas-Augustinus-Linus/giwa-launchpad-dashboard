// Separate from portable project drafts: imported drafts never carry execution authority.
export class LaunchJournal {
  constructor(storage,key){this.storage=storage;this.key=key;}
  all(){
    const raw=this.storage.getItem(this.key);if(!raw)return [];
    let entries;try{entries=JSON.parse(raw);}catch{throw Error('실행 기록을 읽지 못했습니다. 원본을 보존하며 새 실행을 중지합니다.');}
    if(!Array.isArray(entries)||entries.length>500||entries.some(e=>!e?.plan?.id||!e.plan.projectId||!['submitting','unknown','pending','confirmed','reverted','rejected'].includes(e.status)))throw Error('실행 기록 형식이 다릅니다. 새 실행을 중지합니다.');
    return entries;
  }
  save(entries){this.storage.setItem(this.key,JSON.stringify(entries));if(this.storage.getItem(this.key)!==JSON.stringify(entries))throw Error('실행 기록 저장을 확인하지 못했습니다.');}
  unresolved(){return this.all().filter(e=>['submitting','unknown','pending'].includes(e.status));}
  begin(plan){
    const entries=this.all();
    if(entries.length>=500)throw Error('실행 기록이 가득 찼습니다. 기록을 백업하세요.');
    if(entries.some(e=>e.plan.id===plan.id)||this.unresolved().length)throw Error('처리 중이거나 결과가 불명확한 실행을 먼저 확인하세요.');
    const entry={plan:structuredClone(plan),status:'submitting',updatedAt:new Date().toISOString(),hash:null};entries.push(entry);this.save(entries);return entry;
  }
  patch(id,next){
    const entries=this.all(),entry=entries.find(e=>e.plan.id===id);if(!entry)throw Error('실행 기록이 없습니다.');
    Object.assign(entry,next,{updatedAt:new Date().toISOString()});this.save(entries);return entry;
  }
}
export async function submitReviewed({plan,wallet,rpc,snapshot,journal,lock,assertCurrent,revalidate}){
  if(typeof lock!=='function')throw Error('이 브라우저에서는 중복 실행 잠금을 사용할 수 없습니다. 최신 브라우저를 사용하세요.');
  return lock(async()=>{
    assertCurrent();await wallet.assert(plan.account,plan.chainId);await revalidate(plan,rpc,snapshot);
    assertCurrent();const provider=await wallet.assert(plan.account,plan.chainId);assertCurrent();
    // Write-ahead record: no wallet prompt until durable storage and cross-tab lock succeed.
    journal.begin(plan);
    let hash;
    try{
      hash=await provider.request({method:'eth_sendTransaction',params:[plan.tx]});
      if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('지갑에서 트랜잭션 해시를 받지 못했습니다.');
    }catch(error){
      const rejected=Number(error.code)===4001;
      journal.patch(plan.id,{status:rejected?'rejected':'unknown'});
      throw Error(rejected?'지갑에서 서명을 취소했습니다.':`전송 결과가 불명확합니다. 지갑 활동에서 해시를 확인하세요. 자동으로 재전송하지 않습니다.`);
    }
    try{return journal.patch(plan.id,{status:'pending',hash});}
    catch{throw Error(`거래가 전송됐지만 기록 저장에 실패했습니다. 이 해시로 확인하세요: ${hash}`);}
  });
}
