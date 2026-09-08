import {compileInBrowser} from './runtime.mjs';
import {observeNetwork} from './network.mjs';
import {NETWORKS,MATERIALS,newProject,validateProject,buildConfig,validateBuild,budgetTotal,nextActions} from './model.mjs';

const $ = id => document.getElementById(id);
const STORAGE = location.protocol === 'https:' ? `giwa-rh-workbench-v1:${new URL('.',location.href).pathname}` : 'giwa-rh-workbench-v1';
let projects = [], current, artifact = null, building = false;
let storageHealthy = true;
const node = (tag, content, cls) => {const e=document.createElement(tag);if(content!==undefined)e.textContent=content;if(cls)e.className=cls;return e;};
function notice(message,error=false) {const e=$('notice');e.textContent=message;e.classList.toggle('error',error);e.hidden=false;}
function safe(action) {return async event=>{try{await action(event);}catch(error){notice(error.message,true);}};}
function external(label,url) {const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function download(name,content,type='application/json') {
  const blob = new Blob([typeof content==='string'?content:JSON.stringify(content,null,2)],{type});
  const url=URL.createObjectURL(blob), a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function persist() {
  if (!storageHealthy) { $('save-state').textContent='저장 중지 · 원본 내보내기 필요'; return; }
  try {localStorage.setItem(STORAGE,JSON.stringify({activeId:current.id,projects}));$('save-state').textContent=`로컬 저장 · ${new Date().toLocaleTimeString('ko-KR')}`;}
  catch {notice('브라우저 저장 공간에 기록하지 못했습니다. 프로젝트 내보내기로 백업하세요.',true);$('save-state').textContent='저장 실패';}
}
function selectProjects() {
  $('projects').replaceChildren(...projects.map(p=>{const option=node('option',p.name||'이름 없는 프로젝트');option.value=p.id;return option;}));
  $('projects').value=current.id;
}
function artifactCurrent() {return artifact && JSON.stringify(artifact.config)===JSON.stringify(buildConfig(current));}
function update(next) {
  next.updatedAt=new Date().toISOString();next=validateProject(next);
  projects=projects.map(p=>p.id===current.id?next:p);current=next;
  if (!artifactCurrent()) artifact=null;
  persist();selectProjects();renderSummary();renderArtifact();
}
function bindForm(id,apply) {
  const form=$(id);form.addEventListener('submit',event=>event.preventDefault());
  let pending;
  const save=()=>{const next=structuredClone(current);apply(next,new FormData(form));update(next);renderRoute();};
  form.addEventListener('change',safe(()=>{clearTimeout(pending);save();}));
  form.addEventListener('input',()=>{
    clearTimeout(pending);const projectId=current.id;$('save-state').textContent='입력 중 · 저장 대기';
    pending=setTimeout(()=>{if(current.id!==projectId)return;try{save();}catch{$('save-state').textContent='입력 확인 필요 · 미저장';}},450);
  });
}
function flushForms() {
  const next=structuredClone(current);
  const basic=new FormData($('project-form'));
  for(const [key,value] of basic)next[key]=value;
  if(next.chain==='giwa')next.route='native';
  const budget=new FormData($('budget-form'));
  for(const [key,value]of budget){if(key==='budgetSource')next[key]=value;else next.budget[key]=value;}
  for(const [key,value]of new FormData($('thesis-form')))next[key]=value;
  update(next);
}
function renderSummary() {
  $('active-name').textContent=current.name||'새 프로젝트';
  $('active-route').textContent=`${NETWORKS[current.chain].name} / ${current.route==='pons'?'기존 플랫폼 연결':'자체 컨트랙트 빌드'}`;
  $('ready-count').textContent=`${Object.values(current.materials).filter(x=>x.status==='ready').length} / ${MATERIALS.length}`;
  $('build-state').textContent=artifactCurrent()?'컴파일 완료':'미빌드';
  $('budget-total').textContent=`${budgetTotal(current.budget)} ETH`;
  const actions=nextActions(current,artifactCurrent());
  const lead=node('span',actions.length?'다음 작업':'패키지 검토 후 실행 연결이 필요합니다.','micro');
  $('next-actions').replaceChildren(lead,...actions.map(action=>{const a=node('a',`${action.label} →`);a.href=`#${action.section}`;return a;}));
}
function renderMaterials() {
  $('material-list').replaceChildren(...MATERIALS.map(m=>{
    const entry=current.materials[m.id], card=node('article',undefined,`material ${entry.status}`);
    const copy=node('div');copy.append(node('span',m.group,'micro'),node('h3',m.title),node('p',m.detail,'muted'));
    const select=node('select');select.setAttribute('aria-label',`${m.title} 상태`);
    for(const [value,label]of [['todo','준비 전'],['working','진행 중'],['ready','준비 완료']]) {const o=node('option',label);o.value=value;select.append(o);}
    select.value=entry.status;
    const label=node('label','검토 근거 URL');const input=node('input');input.type='url';input.placeholder='https://…';input.value=entry.evidence;label.append(input);
    const save=safe(()=>{const next=structuredClone(current);next.materials[m.id]={status:select.value,evidence:input.value};try{update(next);card.className=`material ${select.value}`;}catch(error){select.value=current.materials[m.id].status;throw error;}});
    select.addEventListener('change',save);input.addEventListener('change',save);
    card.append(copy,select,label);return card;
  }));
}
function facts(values) {const dl=node('dl');for(const [key,value]of values){const row=node('div');row.append(node('dt',key),node('dd',value));dl.append(row);}return dl;}
function renderArtifact() {
  const available=Boolean(artifactCurrent());
  for(const id of ['download-source','download-abi','download-artifact'])$(id).disabled=!available;
  $('compile').disabled=building;
  $('compile').textContent=building?'컴파일 중…':'토큰 컴파일';
  $('artifact-status').textContent=available?'실제 컴파일 완료':'대기 중';
  $('artifact-facts').replaceChildren();
  if(!available){$('artifact-summary').textContent='컴파일 후 소스·ABI·바이트코드와 재현용 compiler input을 받을 수 있습니다.';return;}
  $('artifact-summary').textContent='LaunchToken 컴파일 완료. 커브 주소·배포 트랜잭션은 아직 없습니다.';
  $('artifact-facts').replaceWith(Object.assign(facts([
    ['컴파일러',artifact.compiler],['생성 바이트코드',`${(artifact.bytecode.length-2)/2} bytes`],
    ['빌드 SHA-256',artifact.buildId],['컴파일 시각',new Date(artifact.compiledAt).toLocaleString('ko-KR')],
    ['수취 커브 주소','미지정 · 전체 론칭 전 필요'],
  ]),{id:'artifact-facts'}));
}
function renderRoute() {
  const n=NETWORKS[current.chain];
  const chainField=$('project-form').elements.chain, routeField=$('project-form').elements.route;
  chainField.value=current.chain;routeField.value=current.route;routeField.options[0].disabled=current.chain==='giwa';
  $('network-title').textContent=`${n.name} · ${n.chainId}`;
  $('network-links').replaceChildren(external('네트워크 공식 문서 ↗',n.docs),external('익스플로러 ↗',n.explorer));
  $('execution-actions').replaceChildren();
  if(current.route==='pons') {
    $('execution-label').textContent='PONS / EXTERNAL LAUNCH';$('execution-title').textContent='준비한 내용을 Pons에서 확인하기';
    $('execution-detail').textContent='이름·심볼·소개·링크를 복사해 공식 생성 화면에 입력합니다. Pons는 자체 토큰·풀을 생성하며 이 페이지의 바이트코드를 가져가는 경로가 아닙니다. 파라미터·수수료를 그곳에서 다시 확인하고 본인 지갑으로 실행합니다.';
    const copy=node('button','입력 내용 복사','secondary');copy.addEventListener('click',safe(async()=>{flushForms();await navigator.clipboard.writeText(handoff());notice('입력 내용을 복사했습니다. Pons 화면에서 다시 검토하세요.');}));
    const link=external('Pons 생성 화면 열기 ↗','https://www.ponsfamily.com/launchpad/create');link.className='primary';
    $('execution-actions').append(copy,link,external('Pons 문서 ↗','https://docs.ponsfamily.com/'));
  } else {
    $('execution-label').textContent='NATIVE / CONTRACT BUILD';$('execution-title').textContent=current.chain==='giwa'?'GIWA Sepolia 리허설 패키지':'자체 런치패드 구현 패키지';
    $('execution-detail').textContent='토큰 소스와 재현용 빌드를 준비합니다. 다음은 팩토리·커브·영구 잠금 구현, 실제 EVM 리허설, 검증한 배포 대상과 지갑의 연결입니다. GIWA Sepolia의 테스트 결과는 시장 반응으로 집계하지 않습니다.';
    const a=node('a','빌드 산출물로 이동 ↑','secondary');a.href='#build';$('execution-actions').append(a);
  }
}
function renderObservations() {
  if(!current.observations.length){$('observation-list').replaceChildren(node('p','아직 관찰 기록이 없습니다. 직접 관찰·외부 보고·가설을 구분해 기록하세요.','muted'));return;}
  const kinds={observed:'직접 관찰 · 사용자 기록',reported:'외부 보고 · 미검증',hypothesis:'가설'};
  $('observation-list').replaceChildren(...[...current.observations].reverse().map(entry=>{
    const card=node('article',undefined,'observation');card.append(node('span',`${kinds[entry.kind]} / 관찰 ${new Date(entry.observedAt).toLocaleString('ko-KR')}`,'micro'),node('p',entry.note),external('원문 확인 ↗',entry.source),node('p',`기록 ${new Date(entry.recordedAt).toLocaleString('ko-KR')}`,'muted'));return card;
  }));
}
function renderProject() {
  for(const [key,value]of Object.entries(current))if($('project-form').elements.namedItem(key))$('project-form').elements.namedItem(key).value=value;
  for(const [key,value]of Object.entries(current.budget))$('budget-form').elements.namedItem(key).value=value;
  $('budget-form').elements.budgetSource.value=current.budgetSource;
  for(const key of ['hypothesis','stopRule'])$('thesis-form').elements[key].value=current[key];
  $('network-result').textContent='아직 조회하지 않았습니다.';
  const time=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  $('observation-form').elements.observedAt.value=time;
  selectProjects();renderSummary();renderMaterials();renderArtifact();renderRoute();renderObservations();
}
function handoff() {
  return [`이름: ${current.name}`,`심볼: ${current.symbol}`,`소개: ${current.description}`,`이미지: ${current.image}`,`사이트: ${current.website}`,`소셜: ${current.social}`,`체인: ${NETWORKS[current.chain].name}`,`직접 입력 예산: ${budgetTotal(current.budget)} ETH`,`플랫폼 설정과 수수료는 생성 화면에서 재확인. 이 파일은 거래 요청이나 서명 승인이 아닙니다.`].join('\n');
}
try {
  const raw=localStorage.getItem(STORAGE);
  if(raw){const stored=JSON.parse(raw);if(!Array.isArray(stored.projects)||stored.projects.length>20)throw new Error();projects=stored.projects.map(validateProject);current=projects.find(p=>p.id===stored.activeId);}
} catch {storageHealthy=false;notice('기존 저장 내용을 읽지 못했습니다. 원본을 덮어쓰지 않습니다. 상단 내보내기로 저장 원본을 먼저 백업하세요.',true);}
if(!projects.length){current=newProject();projects=[current];}else if(!current)current=projects[0];

bindForm('project-form',(next,data)=>{for(const [key,value]of data)next[key]=value;if(next.chain==='giwa')next.route='native';if(next.chain!==current.chain)$('network-result').textContent='체인이 변경되었습니다. 다시 조회하세요.';});
bindForm('budget-form',(next,data)=>{for(const [key,value]of data){if(key==='budgetSource')next[key]=value;else next.budget[key]=value;}});
bindForm('thesis-form',(next,data)=>{for(const [key,value]of data)next[key]=value;});
$('projects').addEventListener('change',safe(event=>{const selected=event.target.value;flushForms();current=projects.find(p=>p.id===selected);artifact=null;renderProject();persist();}));
$('new-project').addEventListener('click',safe(()=>{flushForms();if(projects.length>=20)throw new Error('프로젝트는 최대 20개입니다.');current=newProject();projects.push(current);artifact=null;renderProject();persist();notice('새 프로젝트를 만들었습니다.');}));
$('delete-project').addEventListener('click',safe(()=>{
  if(!confirm('현재 프로젝트의 로컬 초안과 관찰 기록을 삭제할까요? 필요한 내용은 먼저 내보내세요.'))return;
  projects=projects.filter(p=>p.id!==current.id);if(!projects.length)projects=[newProject()];current=projects[0];artifact=null;renderProject();persist();notice('현재 프로젝트를 삭제했습니다.');
}));
$('export-project').addEventListener('click',safe(()=>{
  if(!storageHealthy){download('workbench-storage-recovery.json',localStorage.getItem(STORAGE)||'{}');return;}
  flushForms();download('launch-project.json',current);notice('프로젝트 백업을 내려받았습니다.');
}));
$('import-project').addEventListener('change',safe(async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>2_000_000)throw new Error('파일은 2MB 이내여야 합니다.');const imported=validateProject(JSON.parse(await file.text()));
    flushForms();if(projects.length>=20)throw new Error('프로젝트는 최대 20개입니다.');
    imported.id=crypto.randomUUID();current=imported;projects.push(current);artifact=null;renderProject();persist();notice('별도 프로젝트로 가져왔습니다. 빌드는 다시 실행하세요.');
  }finally{event.target.value='';}
}));
$('compile').addEventListener('click',safe(async()=>{
  flushForms();const config=validateBuild(buildConfig(current)), projectId=current.id;building=true;artifact=null;renderArtifact();renderSummary();
  try{const result=await compileInBrowser(config);
    if(current.id!==projectId||JSON.stringify(buildConfig(current))!==JSON.stringify(config))throw new Error('빌드 중 프로젝트가 변경되었습니다. 현재 입력으로 다시 빌드하세요.');
    artifact=result;notice('실제 토큰 컴파일이 완료됐습니다. 소스·ABI·빌드 JSON을 받을 수 있습니다.');
  }finally{building=false;renderArtifact();renderSummary();}
}));
$('download-source').addEventListener('click',safe(()=>{flushForms();if(!artifactCurrent())throw new Error('현재 입력으로 다시 빌드하세요.');download('LaunchToken.sol',artifact.input.sources['contracts/v1/LaunchToken.sol'].content,'text/plain');}));
$('download-abi').addEventListener('click',safe(()=>{flushForms();if(!artifactCurrent())throw new Error('현재 입력으로 다시 빌드하세요.');download('LaunchToken.abi.json',artifact.abi);}));
$('download-artifact').addEventListener('click',safe(()=>{flushForms();if(!artifactCurrent())throw new Error('현재 입력으로 다시 빌드하세요.');download('LaunchToken.build.json',artifact);}));
$('export-kit').addEventListener('click',safe(()=>{
  flushForms();if(!artifactCurrent())throw new Error('패키지를 만들려면 현재 이름·심볼로 토큰을 먼저 컴파일하세요.');
  download('launch-kit.json',{schemaVersion:1,exportedAt:new Date().toISOString(),project:current,build:artifact,
    files:{'launch-metadata.json':{name:current.name,symbol:current.symbol,description:current.description,image:current.image,external_url:current.website,social:current.social},'handoff.txt':handoff(),'compiler-input.json':artifact.input},
    nextActions:nextActions(current,true),remainingLaunchWork:artifact.remaining,execution:{status:'not_executed',transactionHash:null,contractAddress:null,signingAuthorized:false},
    boundary:'Token component only. Pons creates its own token and pool. Checklist completion is user-reported; there is no automatic launch authorization.'});
  notice('프로젝트·빌드·메타데이터·예산·관찰 기록을 launch-kit.json으로 묶었습니다.');
}));
$('refresh-network').addEventListener('click',safe(async()=>{
  flushForms();const chain=current.chain,projectId=current.id;$('refresh-network').disabled=true;$('network-result').textContent='공식 RPC의 체인 ID와 현재 블록·가스를 확인하는 중…';
  try{const data=await observeNetwork(chain).catch(error=>({status:'unknown',error:error.message}));if(current.chain!==chain||current.id!==projectId)return;
    if(data.status!=='observed'){$('network-result').textContent=`UNKNOWN · ${data.error||'조회 실패'} · ${new Date().toLocaleString('ko-KR')}`;return;}
    $('network-result').replaceChildren(facts([['네트워크',`${data.chainId} / ${data.kind}`],['블록',data.block],['가스 가격',`${data.gasPriceWei} wei`],['실제 관찰 시각',new Date(data.observedAt).toLocaleString('ko-KR')]]));
  }finally{$('refresh-network').disabled=false;}
}));
$('observation-form').addEventListener('submit',safe(event=>{
  event.preventDefault();flushForms();const data=new FormData(event.target),next=structuredClone(current);
  next.observations.push({observedAt:new Date(data.get('observedAt')).toISOString(),recordedAt:new Date().toISOString(),kind:data.get('kind'),source:data.get('source'),note:data.get('note')});
  update(next);renderObservations();event.target.elements.note.value='';notice('관찰 기록을 저장했습니다.');
}));
renderProject();persist();
