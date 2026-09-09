import {NETWORKS,validateProject,buildConfig,ethWei} from './model.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';
import {Interface,ContractFactory,getAddress,getCreateAddress,keccak256,toQuantity,ZeroAddress,hexlify,randomBytes} from './eth.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';

const READS=new Set(['eth_chainId','eth_blockNumber','eth_getBalance','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber']);
// Share a paced read queue across wallet balance, quote and receipt clients. Respect
// provider rate limits; this queue cannot carry transaction broadcasts.
let readQueue=Promise.resolve(),lastReadAt=0;
const readCooldown=new Map();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function publicRpc(chain,fetcher=fetch){
  const n=NETWORKS[chain];if(!n)throw Error('지원하지 않는 체인입니다.');
  return async(method,params=[])=>{
    if(!READS.has(method))throw Error('공개 RPC에 허용되지 않은 메서드입니다.');
    const operation=readQueue.then(async()=>{
      for(let attempt=0;attempt<3;attempt++){
        const cooldown=(readCooldown.get(n.rpc)||0)-Date.now();
        if(cooldown>30000)throw Error('RPC가 긴 대기를 요청했습니다. 잠시 후 새 견적을 확인하세요.');
        if(cooldown>0)await pause(cooldown);
        await pause(Math.max(0,300-(Date.now()-lastReadAt)));lastReadAt=Date.now();
        const response=await fetcher(n.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(25000)});
        if(response.status===429){
          const header=response.headers?.get('Retry-After');
          const wait=header&&/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:header?Math.max(0,Date.parse(header)-Date.now()):0;
          const delay=Math.max(Number.isFinite(wait)?wait:0,1000*2**attempt);
          readCooldown.set(n.rpc,Date.now()+delay);
          if(attempt===2)throw Error('RPC 요청 한도에 도달했습니다. 잠시 후 조건을 다시 확인하세요.');
          // Do not wait past a quote's useful lifetime, or retry earlier than requested.
          if(wait>30000)throw Error('RPC가 긴 대기를 요청했습니다. 잠시 후 새 견적을 확인하세요.');
          await pause(delay);continue;
        }
        if(!response.ok)throw Error(`RPC 응답 실패 (${response.status})`);
        const data=await response.json();if(data.error)throw Error(`RPC ${method}: ${String(data.error.message||'호출 실패').slice(0,350)}`);
        if(!Object.hasOwn(data,'result'))throw Error('RPC 결과가 없습니다.');return data.result;
      }
    });
    readQueue=operation.catch(()=>{});return operation;
  };
}

const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
export function launchFingerprint(project,initialBuy,slippageBps){const p=validateProject(project);return json({id:p.id,name:p.name,symbol:p.symbol,chain:p.chain,route:p.route,description:p.description,image:p.image,website:p.website,social:p.social,initialBuy,slippageBps});}
export async function assertChain(rpc,chainId){if(BigInt(await rpc('eth_chainId'))!==BigInt(chainId))throw Error('RPC 체인 ID가 다릅니다. 실행을 중지했습니다.');}
async function contractRead(rpc,contract,name,args=[],block='latest'){
  const abi=new Interface(contract.abi);return abi.decodeFunctionResult(name,await rpc('eth_call',[{to:contract.address,data:abi.encodeFunctionData(name,args)},block]));
}
export async function verifyPons(rpc,snapshot,block){
  if(snapshot.chainId!==4663)throw Error('Pons 체인 설정 오류');
  const entries=Object.entries(snapshot.contracts);
  await Promise.all(entries.map(async([name,c])=>{
    const code=await rpc('eth_getCode',[c.address,block]);if(code==='0x'||keccak256(code)!==c.codeHash)throw Error(`Pons ${name} 코드가 검증한 버전과 다릅니다.`);
  }));
  const c=snapshot.contracts;
  await Promise.all(entries.filter(([k])=>!['factory','router'].includes(k)).map(async([name,entry])=>{
    if(!same((await contractRead(rpc,c.factory,name,[],block))[0],entry.address))throw Error(`Pons ${name} 연결이 변경됐습니다.`);
  }));
  if(!same((await contractRead(rpc,c.factory,'launchForwarder',[],block))[0],c.router.address)||!same((await contractRead(rpc,c.router,'factory',[],block))[0],c.factory.address))throw Error('Pons 라우터 연결이 변경됐습니다.');
}
export async function prepareLaunch({project,artifact,account,initialBuy='0',slippageBps=100,snapshot,rpc,salt=hexlify(randomBytes(32))}){
  project=validateProject(project);account=getAddress(account);
  if(!project.name.trim()||!project.symbol.trim())throw Error('이름과 심볼을 입력하세요.');
  const chainId=NETWORKS[project.chain].chainId;
  const buy=ethWei(initialBuy);
  if(!Number.isInteger(slippageBps)||slippageBps<10||slippageBps>500)throw Error('슬리피지는 0.1%~5% 범위입니다.');
  await assertChain(rpc,chainId);
  const [block,nonce,balanceHex,priceHex]=await Promise.all([rpc('eth_blockNumber'),rpc('eth_getTransactionCount',[account,'pending']),rpc('eth_getBalance',[account,'pending']),rpc('eth_gasPrice')]);
  const balance=BigInt(balanceHex),gasPrice=(BigInt(priceHex)*12n+9n)/10n;
  if(gasPrice<=0n)throw Error('가스 가격을 확인하지 못했습니다.');
  let tx,details,expected;
  if(project.route==='native'){
    if(buy!==0n)throw Error('직접 토큰 배포에는 초기 매수 ETH를 보내지 않습니다. 0으로 설정하세요.');
    if(!artifact||json(artifact.config)!==json(buildConfig(project)))throw Error('현재 이름·심볼로 먼저 컴파일하세요.');
    if(await sha(JSON.stringify(artifact.input))!==artifact.sourceHash)throw Error('빌드 소스 해시가 다릅니다.');
    const factory=new ContractFactory(artifact.abi,artifact.bytecode);
    const deploy=await factory.getDeployTransaction(project.name.trim(),project.symbol.trim(),account);
    tx={from:account,data:deploy.data,value:'0x0'};
    expected={token:getCreateAddress({from:account,nonce:BigInt(nonce)}),runtimeHash:keccak256(artifact.runtimeBytecode),supply:'1000000000000000000000000000',recipient:account};
    details={route:'native',creationWei:'0',initialBuyWei:'0',supply:expected.supply,distribution:'전체 10억 토큰 → 연결 지갑. 거래 풀과 LP는 생성하지 않습니다.'};
  }else{
    if(chainId!==4663)throw Error('Pons V2는 Robinhood에서만 연결됩니다.');
    for(const [key,max]of [['image',512],['website',256],['social',256],['description',2048]])if(new TextEncoder().encode(project[key]).length>max)throw Error(`Pons ${key}: UTF-8 ${max}바이트 이내로 입력하세요.`);
    await verifyPons(rpc,snapshot,block);
    const c=snapshot.contracts,abi=new Interface(c.factory.abi),routerAbi=new Interface(c.router.abi);
    const [[allowed],[fee],[config],[economics],[policy],[snipeSeconds],[snipeBps]]=await Promise.all([
      contractRead(rpc,c.factory,'canLaunch',[account],block),contractRead(rpc,c.factory,'launchFee',[],block),contractRead(rpc,c.factory,'getLaunchConfig',[0],block),contractRead(rpc,c.factory,'previewLaunchEconomics',[0,ZeroAddress],block),contractRead(rpc,c.memeHook,'currentFeePolicy',[],block),contractRead(rpc,c.factory,'snipeTaxSeconds',[],block),contractRead(rpc,c.factory,'snipeTaxStartBps',[],block)]);
    if(!allowed||!config.enabled)throw Error('Pons에서 현재 이 지갑의 생성을 허용하지 않습니다.');
    if(/^0x0+$/.test(economics))throw Error('Pons 경제 조건을 확인하지 못했습니다.');
    if(balance<fee+buy)throw Error('생성비와 초기 매수에 필요한 ETH가 부족합니다.');
    const params={name:project.name.trim(),symbol:project.symbol.trim(),logo:project.image,description:project.description,socials:{twitter:project.social,telegram:'',discord:'',website:project.website,farcaster:''},creatorFeeRecipient:account,creatorTaxBps:0,buybackEnabled:false,expectedEconomics:economics,salt};
    const launchFunction=abi.fragments.find(f=>f.type==='function'&&f.name==='launchToken'&&f.inputs.length===3);
    const make=min=>buy>0n?{from:account,to:c.router.address,data:routerAbi.encodeFunctionData('launchAndBuy',[params,0,ZeroAddress,buy,min,account,[]]),value:toQuantity(fee+buy)}:{from:account,to:c.factory.address,data:abi.encodeFunctionData(launchFunction,[params,0,ZeroAddress]),value:toQuantity(fee)};
    const trial=make(buy>0n?1n:0n);
    const decoded=(buy>0n?routerAbi:abi).decodeFunctionResult(buy>0n?'launchAndBuy':launchFunction,await rpc('eth_call',[trial,block]));
    const minimum=buy>0n?decoded[2]*BigInt(10000-slippageBps)/10000n:0n;
    if(buy>0n&&minimum<=0n)throw Error('초기 매수 최소 수량이 0입니다. 금액을 확인하세요.');
    tx=make(minimum);
    expected={token:getAddress(decoded[0]),curve:getAddress(decoded[1]),minimumTokens:minimum.toString(),economics,salt,supply:config.supply.toString()};
    details={route:'pons',creationWei:fee.toString(),initialBuyWei:buy.toString(),supply:config.supply.toString(),curveFeeBps:config.curveFeeBps.toString(),creatorTaxBps:'0',buybackEnabled:false,hookFeeBps:policy.hookFeeBps.toString(),protocolShareBps:policy.protocolFeeShareBps.toString(),snipeSeconds:snipeSeconds.toString(),snipeBps:snipeBps.toString(),graduationWei:config.graduationThreshold.toString(),phantomWei:config.phantomQuote.toString(),expectedTokens:buy>0n?decoded[2].toString():'0',minimumTokens:minimum.toString(),distribution:'전체 공급 → Pons 커브. 초기 매수분 → 연결 지갑. 졸업 후 LP 영구 잠금.',economics};
  }
  const estimate=BigInt(await rpc('eth_estimateGas',[tx]));
  const gas=(estimate*12n+9n)/10n;
  const gasBudget=gas*gasPrice,total=BigInt(tx.value)+gasBudget;
  if(balance<total)throw Error('생성비·초기 매수·가스 여유분을 합친 ETH가 부족합니다.');
  tx={...tx,chainId:toQuantity(chainId),nonce,gas:toQuantity(gas),gasPrice:toQuantity(gasPrice)};
  await assertChain(rpc,chainId);
  const createdAt=Date.now();return {schemaVersion:1,id:crypto.randomUUID(),projectId:project.id,name:project.name,symbol:project.symbol,chain:project.chain,chainId,account,fingerprint:launchFingerprint(project,initialBuy,slippageBps),createdAt,expiresAt:createdAt+120000,block,tx,expected,details:{...details,balanceWei:balance.toString(),gasBudgetWei:gasBudget.toString(),totalWei:total.toString()},status:'review'};
}
export async function revalidate(plan,rpc,snapshot){
  if(Date.now()>plan.expiresAt)throw Error('견적이 만료됐습니다. 다시 확인하세요.');
  await assertChain(rpc,plan.chainId);
  const [balance,nonce,price]=await Promise.all([rpc('eth_getBalance',[plan.account,'pending']),rpc('eth_getTransactionCount',[plan.account,'pending']),rpc('eth_gasPrice')]);
  if(BigInt(nonce)!==BigInt(plan.tx.nonce))throw Error('지갑에서 다른 거래가 진행됐습니다. 견적을 다시 확인하세요.');
  if(BigInt(balance)<BigInt(plan.details.totalWei)||BigInt(price)>BigInt(plan.tx.gasPrice))throw Error('잔액 또는 가스 가격이 바뀌었습니다. 견적을 다시 확인하세요.');
  if(plan.details.route==='pons'){
    const block=await rpc('eth_blockNumber');await verifyPons(rpc,snapshot,block);
    if(plan.kind==='graduate'){const state=await readPonsLaunch(rpc,snapshot,plan.expected.token);if(state.phase!==1)throw Error('LP 상태가 변경됐습니다. 다시 확인하세요.');}
    else {const [[fee],[economics]]=await Promise.all([contractRead(rpc,snapshot.contracts.factory,'launchFee',[],block),contractRead(rpc,snapshot.contracts.factory,'previewLaunchEconomics',[0,ZeroAddress],block)]);
    if(fee.toString()!==plan.details.creationWei||economics!==plan.expected.economics)throw Error('Pons 조건이 바뀌었습니다. 새 견적을 검토하세요.');}
  }
  const {gas,gasPrice,nonce:_,chainId:__,...call}=plan.tx;
  await rpc('eth_call',[call,'pending']);
  if(BigInt(await rpc('eth_estimateGas',[call]))>BigInt(gas))throw Error('필요 가스가 늘었습니다. 다시 확인하세요.');
}
export async function reconcile(plan,hash,rpc,snapshot){
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('트랜잭션 해시를 확인하세요.');
  await assertChain(rpc,plan.chainId);
  const [tx,receipt]=await Promise.all([rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash])]);
  if(!tx)return {status:'unknown',hash};
  if(!same(tx.from,plan.account)||!same(tx.to||'0x',plan.tx.to||'0x')||!same(tx.input??tx.data,plan.tx.data)||BigInt(tx.value)!==BigInt(plan.tx.value)||BigInt(tx.nonce)!==BigInt(plan.tx.nonce)|| (tx.chainId!==undefined&&BigInt(tx.chainId)!==BigInt(plan.chainId)))throw Error('트랜잭션이 검토한 실행 내용과 다릅니다.');
  if(!receipt)return {status:'pending',hash};
  if(!same(receipt.transactionHash,hash)||!same(receipt.from,plan.account))throw Error('영수증의 송신 정보가 다릅니다.');
  const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
  if(!block||!same(block.hash,receipt.blockHash))return {status:'unknown',hash};
  if(BigInt(receipt.status)===0n)return {status:'reverted',hash,blockNumber:receipt.blockNumber};
  if(BigInt(receipt.status)!==1n)throw Error('영수증 결과가 불명확합니다.');
  if(plan.details.route==='native'){
    if(!same(receipt.contractAddress,plan.expected.token))throw Error('배포 주소가 예상과 다릅니다.');
    const code=await rpc('eth_getCode',[plan.expected.token,receipt.blockNumber]);if(keccak256(code)!==plan.expected.runtimeHash)throw Error('배포 코드가 빌드와 다릅니다.');
    const token={address:plan.expected.token,abi:['function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)','function name() view returns(string)','function symbol() view returns(string)']};
    const [[supply],[balance],[name],[symbol]]=await Promise.all([contractRead(rpc,token,'totalSupply',[],receipt.blockNumber),contractRead(rpc,token,'balanceOf',[plan.account],receipt.blockNumber),contractRead(rpc,token,'name',[],receipt.blockNumber),contractRead(rpc,token,'symbol',[],receipt.blockNumber)]);
    if(supply.toString()!==plan.expected.supply||balance!==supply||name!==plan.name.trim()||symbol!==plan.symbol.trim())throw Error('토큰 공급 또는 수취 지갑 검증이 실패했습니다.');
  }else{
    const abi=new Interface(snapshot.contracts.factory.abi);
    const events=receipt.logs.filter(l=>same(l.address,snapshot.contracts.factory.address)).flatMap(l=>{try{const d=abi.parseLog(l);return d?.name===(plan.kind==='graduate'?'PoolGraduated':'TokenLaunched')?[d]:[];}catch{return [];}});
    if(events.length!==1||!same(events[0].args.token,plan.expected.token)||(plan.kind!=='graduate'&&(!same(events[0].args.curve,plan.expected.curve)||!same(events[0].args.deployer,plan.account))))throw Error('Pons 생성 이벤트를 검증하지 못했습니다.');
    const [record]=await contractRead(rpc,snapshot.contracts.factory,'getLaunchedToken',[plan.expected.token],receipt.blockNumber);
    if(!record.exists||!same(record.deployer,plan.account)||!same(record.curve,plan.expected.curve)||!same(record.creatorFeeRecipient,plan.account)||!same(record.pairToken,ZeroAddress))throw Error('Pons 론칭 등록 내용이 다릅니다.');
    if(plan.kind==='graduate'){const [locked]=await contractRead(rpc,snapshot.contracts.locker,'isLocked',[plan.expected.token],receipt.blockNumber);if(record.phase!==2n||!locked)throw Error('LP 생성과 잠금을 검증하지 못했습니다.');}
  }
  return {status:'confirmed',hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,token:plan.expected.token,curve:plan.expected.curve||null,confirmedAt:new Date().toISOString()};
}

export async function readPonsLaunch(rpc,snapshot,token){
  token=getAddress(token);await assertChain(rpc,4663);const block=await rpc('eth_blockNumber');
  const [record]=await contractRead(rpc,snapshot.contracts.factory,'getLaunchedToken',[token],block);
  if(!record.exists||!same(record.pairToken,ZeroAddress))throw Error('지원하는 Pons ETH 론칭이 아닙니다.');
  let reserve=record.sweptQuote,positionId=0n,locked=false;
  if(record.phase===0n)[reserve]=await contractRead(rpc,{address:record.curve,abi:['function realQuoteReserve() view returns(uint256)']},'realQuoteReserve',[],block);
  if(record.phase===2n){[locked]=await contractRead(rpc,snapshot.contracts.locker,'isLocked',[token],block);[positionId]=await contractRead(rpc,snapshot.contracts.locker,'lockedPositions',[token],block);}
  return {phase:Number(record.phase),token,curve:record.curve,deployer:record.deployer,reserveWei:reserve.toString(),graduationWei:record.graduationThreshold.toString(),positionId:positionId.toString(),locked,block};
}
export async function prepareGraduation({original,project,account,snapshot,rpc,initialBuy='0',slippageBps=100}){
  account=getAddress(account);validateProject(project);
  if(project.id!==original.projectId||project.chain!=='rh'||!same(account,original.account))throw Error('원래 프로젝트와 생성 지갑을 선택하세요.');
  await assertChain(rpc,4663);const block=await rpc('eth_blockNumber');await verifyPons(rpc,snapshot,block);
  const state=await readPonsLaunch(rpc,snapshot,original.expected.token);
  if(state.phase!==1||!same(state.deployer,account))throw Error('이 토큰은 LP 마무리 대기 상태가 아닙니다.');
  const factory=snapshot.contracts.factory,abi=new Interface(factory.abi);
  const tx={from:account,to:factory.address,data:abi.encodeFunctionData('createGraduatedPool',[state.token]),value:'0x0'};
  await rpc('eth_call',[tx,'latest']);
  const [estimate,price,balance,nonce]=await Promise.all([rpc('eth_estimateGas',[tx]),rpc('eth_gasPrice'),rpc('eth_getBalance',[account,'pending']),rpc('eth_getTransactionCount',[account,'pending'])]);
  const gas=(BigInt(estimate)*12n+9n)/10n,gasPrice=(BigInt(price)*12n+9n)/10n,total=gas*gasPrice;
  if(BigInt(balance)<total||gasPrice<=0n)throw Error('LP 마무리 가스에 필요한 ETH가 부족합니다.');
  const createdAt=Date.now();return {schemaVersion:1,id:crypto.randomUUID(),kind:'graduate',projectId:project.id,name:original.name,symbol:original.symbol,chain:'rh',chainId:4663,account,createdAt,expiresAt:createdAt+120000,block,fingerprint:launchFingerprint(project,initialBuy,slippageBps),tx:{...tx,chainId:'0x1237',nonce,gas:toQuantity(gas),gasPrice:toQuantity(gasPrice)},expected:{token:state.token,curve:state.curve},details:{route:'pons',creationWei:'0',initialBuyWei:'0',gasBudgetWei:total.toString(),totalWei:total.toString(),balanceWei:BigInt(balance).toString(),reserveWei:state.reserveWei,distribution:'이미 커브에 모인 토큰·ETH로 Uniswap V4 풀 생성 후 영구 잠금. 추가 ETH 예치 없음.'}};
}
