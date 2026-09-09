import {NETWORKS,formatEth} from './model.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';
import {discoverWallets,WalletSession} from './wallet.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';
import {publicRpc,prepareLaunch,prepareGraduation,readPonsLaunch,revalidate,reconcile,launchFingerprint,assertChain} from './launch-engine.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';
import {LaunchJournal,submitReviewed} from './launch-journal.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';

const el=id=>document.getElementById(id),node=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
const eth=value=>`${formatEth(BigInt(value))} ETH`;
function facts(target,rows){target.replaceChildren(...rows.map(([key,value])=>{const row=node('div','');row.append(node('dt',key),node('dd',String(value)));return row;}));}
function link(text,url){const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=node('a','');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function initLaunchUI({getProject,flush,getArtifact,notice}){
  let plan=null,busy=false,revision=0,snapshotPromise;
  const frameAllowed=window.top===window.self;
  const providers=new Map(),key=`giwa-rh-launch-history-v1:${new URL('.',location.href).pathname}`;
  const journal=new LaunchJournal(localStorage,key);
  const snapshot=()=>snapshotPromise??=(async()=>{const r=await fetch(new URL('./pons-v2.json?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595',import.meta.url));if(!r.ok)throw Error('Pons 검증 자료를 불러오지 못했습니다.');return r.json();})();
  const invalidate=()=>{revision++;plan=null;el('launch-confirm').checked=false;el('launch-send').disabled=true;el('launch-review').hidden=true;};
  const wallet=new WalletSession(()=>{invalidate();renderWallet();});
  const safe=fn=>async event=>{try{await fn(event);}catch(error){notice(error.message||'지갑 요청에 실패했습니다.',true);}finally{renderButtons();}};
  const buy=()=>getProject().budget.devBuy,slippage=()=>Number(el('launch-slippage').value);
  function renderButtons(){
    el('wallet-connect').disabled=busy||!providers.size||!frameAllowed;
    el('wallet-switch').disabled=busy||!wallet.provider;
    el('wallet-disconnect').disabled=busy||!wallet.provider;
    el('wallet-balance-refresh').disabled=busy||!wallet.account;
    el('launch-prepare').disabled=busy||!wallet.account||!frameAllowed;
    let blocked=true;try{blocked=journal.unresolved().length>0;}catch{}
    el('launch-send').disabled=!frameAllowed||busy||!plan||!el('launch-confirm').checked||blocked;
  }
  function renderWallet(){
    const n=NETWORKS[getProject().chain];
    el('wallet-status').textContent=wallet.account?`${wallet.account} · chain ${wallet.chainId}${wallet.chainId!==n.chainId?' · 대상 체인으로 전환 필요':''}`:'연결 전 · 연결만으로 거래가 실행되지 않습니다.';
    el('wallet-balance').textContent='잔액 미조회';renderButtons();
  }
  async function balance(){
    flush();const p=getProject(),account=wallet.account,epoch=wallet.epoch;
    await wallet.assert(account,NETWORKS[p.chain].chainId);
    const rpc=publicRpc(p.chain);await assertChain(rpc,NETWORKS[p.chain].chainId);
    const amount=await rpc('eth_getBalance',[account,'pending']);
    if(epoch!==wallet.epoch||p.chain!==getProject().chain)return;
    el('wallet-balance').textContent=`${eth(amount)} · ${new Date().toLocaleTimeString('ko-KR')}${p.chain==='giwa'?' · 테스트 ETH':''}`;
  }
  function renderHistory(){
    const holder=el('launch-history');holder.replaceChildren();
    let entries;try{entries=journal.all();}catch(error){holder.append(node('p',error.message));renderButtons();return;}
    const statuses={submitting:'전송 결과 확인 필요',unknown:'결과 불명확 · 재전송 중지',pending:'영수증 대기',confirmed:'생성 확인',reverted:'실패 영수증 확인',rejected:'서명 취소'};
    for(const entry of [...entries].reverse()){
      const card=node('article','');card.className='panel receipt';const network=NETWORKS[entry.plan.chain];
      card.append(node('h3',`${entry.plan.name} / ${entry.plan.symbol}`),node('p',`${network.name} · ${entry.status==='confirmed'&&entry.plan.kind==='graduate'?'LP 생성·잠금 확인':statuses[entry.status]}`));
      if(entry.hash)card.append(link('트랜잭션 확인 ↗',`${network.explorer}/tx/${entry.hash}`));
      if(entry.status==='confirmed'&&entry.token){
        card.append(link('토큰 주소 ↗',`${network.explorer}/address/${entry.token}`));
        if(entry.curve){
          card.append(link('거래 커브 ↗',`${network.explorer}/address/${entry.curve}`));
          const lp=node('p','LP 상태는 조회 후 표시합니다.'),refresh=node('button','커브·LP 상태 확인');refresh.className='secondary';
          const finish=node('button','LP 마무리 비용 확인');finish.className='primary';finish.hidden=true;
          refresh.addEventListener('click',safe(async()=>{
            refresh.disabled=true;try{const state=await readPonsLaunch(publicRpc('rh'),await snapshot(),entry.token);
              lp.textContent=state.phase===0?`커브 거래 중 · 모인 ${eth(state.reserveWei)} / 졸업 ${eth(state.graduationWei)}`:state.phase===1?`커브 졸업 · ${eth(state.reserveWei)}로 LP 생성 마무리 필요`:state.phase===2&&state.locked?`LP 생성·영구 잠금 확인 · 포지션 #${state.positionId}`:'현재 상태를 확인하지 못했습니다.';
              finish.hidden=state.phase!==1;
            }finally{refresh.disabled=false;}
          }));
          finish.addEventListener('click',safe(async()=>{
            invalidate();flush();if(journal.unresolved().length)throw Error('진행 중인 거래를 먼저 확인하세요.');
            const p=getProject(),account=wallet.account,epoch=wallet.epoch,currentRevision=revision;
            await wallet.assert(account,4663);busy=true;renderButtons();
            try{const prepared=await prepareGraduation({original:entry.plan,project:p,account,snapshot:await snapshot(),rpc:publicRpc('rh'),initialBuy:buy(),slippageBps:slippage()});
              if(wallet.epoch!==epoch||revision!==currentRevision)throw Error('입력 또는 지갑이 변경됐습니다. 다시 확인하세요.');
              plan=prepared;facts(el('launch-review-facts'),[['실행','Uniswap V4 LP 생성 마무리'],['토큰',plan.expected.token],['서명 지갑',account],['공급 배분',plan.details.distribution],['이미 모인 ETH',eth(plan.details.reserveWei)],['추가 LP 예치','0 ETH'],['이번 거래 가스 예산',eth(plan.details.totalWei)],['실행 대상',plan.tx.to]]);
              el('launch-review').hidden=false;el('launch-send').textContent='지갑에서 LP 마무리 검토';el('launch-progress').textContent='LP 마무리 시뮬레이션 통과. 가스비와 영구 잠금을 검토하세요.';
            }finally{busy=false;}
          }));card.append(lp,refresh,finish);
        }
        card.append(node('p',entry.plan.kind==='graduate'?'LP 마무리 영수증 확인. 아래에서 현재 LP 잠금 상태를 조회할 수 있습니다.':entry.curve?'Pons 커브 생성 확인. LP 졸업 여부는 별도로 확인하세요.':'토큰 생성 확인. 거래 풀과 LP는 별도로 필요합니다.'));
      }
      const hashInput=node('input','');hashInput.placeholder='지갑 활동의 트랜잭션 해시 0x…';hashInput.setAttribute('aria-label',`${entry.plan.name} 트랜잭션 해시`);hashInput.value=entry.hash||'';
      const check=node('button','영수증 다시 확인');check.className='secondary';check.addEventListener('click',safe(async()=>{
        check.disabled=true;try{const result=await reconcile(entry.plan,hashInput.value.trim(),publicRpc(entry.plan.chain),await snapshot());journal.patch(entry.plan.id,result);renderHistory();notice(result.status==='confirmed'?'온체인 생성 영수증과 결과를 확인했습니다.':'현재 영수증 상태를 기록했습니다.');}finally{check.disabled=false;}
      }));
      if(entry.status!=='rejected')card.append(hashInput,check);
      const backup=node('button','실행 기록 내보내기');backup.className='secondary';backup.addEventListener('click',()=>download('launch-receipt.json',entry));card.append(backup);holder.append(card);
    }
    if(!entries.length)holder.append(node('p','아직 지갑으로 실행한 기록이 없습니다.'));
    renderButtons();
  }
  discoverWallets(window,entry=>{
    if(providers.has(entry.id))return;providers.set(entry.id,entry);
    const option=node('option',entry.name);option.value=entry.id;el('wallet-provider').append(option);
    el('wallet-install').hidden=true;renderButtons();
  });
  el('wallet-connect').addEventListener('click',safe(async()=>{
    busy=true;renderButtons();try{await wallet.connect(providers.get(el('wallet-provider').value).provider);if(wallet.chainId===NETWORKS[getProject().chain].chainId)await balance();}finally{busy=false;}
  }));
  el('wallet-provider').addEventListener('change',()=>wallet.disconnect());
  el('wallet-disconnect').addEventListener('click',()=>{wallet.disconnect();notice('이 페이지의 지갑 연결을 해제했습니다. 지갑 자체의 사이트 권한은 지갑 설정에서 관리합니다.');});
  el('wallet-switch').addEventListener('click',safe(async()=>{busy=true;renderButtons();try{await wallet.switchChain(getProject().chain);await balance();}finally{busy=false;}}));
  el('wallet-balance-refresh').addEventListener('click',safe(balance));
  el('launch-slippage').addEventListener('change',invalidate);
  for(const id of ['project-form','budget-form'])for(const event of ['input','change'])el(id).addEventListener(event,invalidate);
  el('launch-confirm').addEventListener('change',renderButtons);
  el('launch-prepare').addEventListener('click',safe(async()=>{
    invalidate();flush();
    if(journal.unresolved().length)throw Error('이 브라우저에 결과를 확인해야 하는 실행이 있습니다. 아래 영수증을 먼저 확인하세요.');
    const p=getProject(),account=wallet.account,currentRevision=revision;
    await wallet.assert(account,NETWORKS[p.chain].chainId);const epoch=wallet.epoch;
    busy=true;renderButtons();el('launch-progress').textContent='코드·조건·잔액 확인 및 실제 RPC 시뮬레이션 중…';
    try{
      const prepared=await prepareLaunch({project:p,artifact:getArtifact(),account,initialBuy:buy(),slippageBps:slippage(),snapshot:p.route==='pons'?await snapshot():null,rpc:publicRpc(p.chain)});
      if(epoch!==wallet.epoch||revision!==currentRevision||prepared.fingerprint!==launchFingerprint(getProject(),buy(),slippage()))throw Error('견적 중 입력 또는 지갑이 바뀌었습니다. 다시 확인하세요.');
      plan=prepared;const d=plan.details;
      const rows=[['네트워크',`${NETWORKS[p.chain].name} / ${plan.chainId}${p.chain==='giwa'?' · 테스트넷':''}`],['서명 지갑 / 토큰 수취',plan.account],['실행 대상',plan.tx.to||'새 ERC-20 컨트랙트 생성'],['예상 토큰 주소',plan.expected.token],['공급 배분',d.distribution],['생성비',eth(d.creationWei)],['초기 매수',eth(d.initialBuyWei)],['가스 예산 (20% 여유)',eth(d.gasBudgetWei)],['이번 거래 총 준비액',eth(d.totalWei)],['지갑 ETH 잔액',eth(d.balanceWei)]];
      if(p.route==='pons')rows.push(['커브 / 졸업 후 거래 수수료',`${Number(d.curveFeeBps)/100}% / ${Number(d.hookFeeBps)/100}%`],['추가 크리에이터 세금 / 바이백','0% / 사용 안 함'],['크리에이터 수수료 몫',`${100-Number(d.protocolShareBps)/100}% · 연결 지갑`],['예상 초기 매수 수량',formatEth(BigInt(d.expectedTokens))],['최소 받을 수량',formatEth(BigInt(d.minimumTokens))],['졸업에 모여야 하는 ETH',eth(d.graduationWei)],['실제 LP 투입 시점','커브 졸업 후 풀 생성·영구 잠금. 이번 ETH는 초기 매수이며 LP 직접 예치가 아닙니다.'],['초기 일반 매수 제한',`${d.snipeSeconds}초 · 시작 세율 ${Number(d.snipeBps)/100}% (생성 지갑의 초기 매수 제외)`]);
      rows.push(['견적 유효 시간','2분 · 서명 직전 재조회'],['가스 정산','실제 사용 가스는 지갑과 영수증에서 확인합니다.']);
      facts(el('launch-review-facts'),rows);el('launch-review').hidden=false;el('launch-progress').textContent='시뮬레이션 통과. 금액과 공개될 내용을 검토하세요.';
      el('launch-send').textContent=p.chain==='giwa'?'지갑에서 테스트 배포 검토':'지갑에서 실제 론칭 검토';
    }catch(error){el('launch-progress').textContent='견적을 완료하지 못했습니다.';throw error;}finally{busy=false;}
  }));
  el('launch-send').addEventListener('click',safe(async()=>{
    const reviewed=plan;if(!reviewed||!el('launch-confirm').checked)throw Error('현재 실행 내용을 먼저 검토하세요.');
    const assertCurrent=()=>{if(!frameAllowed)throw Error('지갑 실행은 사이트를 직접 연 탭에서 진행하세요.');if(plan!==reviewed||!el('launch-confirm').checked||reviewed.fingerprint!==launchFingerprint(getProject(),buy(),slippage())||Date.now()>reviewed.expiresAt)throw Error('검토한 내용이 변경되거나 만료됐습니다. 새 견적이 필요합니다.');};
    busy=true;renderButtons();
    try{
      const entry=await submitReviewed({plan:reviewed,wallet,rpc:publicRpc(reviewed.chain),snapshot:reviewed.details.route==='pons'?await snapshot():null,journal,assertCurrent,revalidate,lock:navigator.locks?(fn)=>navigator.locks.request(key,{mode:'exclusive',ifAvailable:true},lock=>{if(!lock)throw Error('다른 탭에서 실행을 검토 중입니다.');return fn();}):null});
      notice('지갑이 트랜잭션 해시를 반환했습니다. 영수증을 확인하는 중입니다.');
      const result=await reconcile(reviewed,entry.hash,publicRpc(reviewed.chain),await snapshot());journal.patch(reviewed.id,result);
      notice(result.status==='confirmed'?'온체인 생성 결과를 확인했습니다.':'거래가 접수됐습니다. 아래에서 영수증을 다시 확인하세요.');
    }finally{busy=false;invalidate();renderHistory();}
  }));
  el('download-pons-sources').addEventListener('click',safe(async()=>{const r=await fetch(new URL('./pons-v2-sources.json?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595',import.meta.url));if(!r.ok)throw Error('검증 소스를 불러오지 못했습니다.');download('pons-v2-verified-sources.json',await r.json());notice('검증된 Pons 배포본 소스·ABI·컴파일 입력을 내려받았습니다.');}));
  window.addEventListener('storage',event=>{if(event.key===key){invalidate();renderHistory();}});
  setInterval(()=>{if(plan&&Date.now()>plan.expiresAt){invalidate();el('launch-progress').textContent='견적이 만료됐습니다. 새 견적을 확인하세요.';}},1000);
  renderWallet();renderHistory();if(!frameAllowed)el('launch-progress').textContent='지갑 실행은 사이트를 직접 연 탭에서 진행하세요.';
  return {refresh(){
    if(plan&&plan.fingerprint!==launchFingerprint(getProject(),buy(),slippage()))invalidate();
    const p=getProject();el('launch-route-note').textContent=p.route==='pons'?'Pons V2: 생성비 + 선택한 초기 매수 ETH + 가스. 초기에 별도 LP 예치는 없으며, 커브에 모인 ETH가 졸업 후 LP로 이어집니다.':'직접 ERC-20 배포: 가스만 사용하며 10억 토큰 전량을 연결 지갑에 보냅니다. 거래 풀과 LP는 별도로 만들어야 합니다.';
    renderButtons();
  },invalidate};
}
