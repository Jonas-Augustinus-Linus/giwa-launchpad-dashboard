export const NETWORKS = Object.freeze({
  rh: {name: 'Robinhood', chainId: 4663, kind: 'mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com', docs: 'https://docs.robinhood.com/chain/connecting/'},
  giwa: {name: 'GIWA Sepolia', chainId: 91342, kind: 'testnet', rpc: 'https://sepolia-rpc.giwa.io', explorer: 'https://sepolia-explorer.giwa.io', docs: 'https://docs.giwa.io/giwa-chain/en/get-started/connect-to-giwa'},
});
export const MATERIALS = [
  {id:'identity', group:'콘텐츠', title:'이름 · 심볼 · 소개', detail:'같은 이름을 복제할 수 있습니다. 공개 주소가 정체성을 확정합니다.', section:'project'},
  {id:'artwork', group:'콘텐츠', title:'로고 · 이미지 원본', detail:'공개 이미지 URL과 원본을 준비하고 사용 권한을 확인합니다.', section:'project'},
  {id:'distribution', group:'컨트랙트', title:'공급 배분 · 수취 계약', detail:'고정 공급 10억 개, 팀 0%. 자체 경로는 검증한 커브 계약이 전량을 받습니다.', section:'build'},
  {id:'contract', group:'컨트랙트', title:'소스 · ABI · 테스트 결과', detail:'토큰 컴파일과 전체 팩토리·커브·졸업 검증을 구분합니다.', section:'build'},
  {id:'budget', group:'실행 준비', title:'가스 · 생성비 · 유동성 예산', detail:'직접 입력한 예산입니다. 가스 견적이나 플랫폼 확정 수수료가 아닙니다.', section:'launch'},
  {id:'venue', group:'실행 준비', title:'플랫폼 주소 · 수수료 · LP 규칙', detail:'실행 직전에 공식 생성 화면과 검증 소스로 다시 확인합니다.', section:'launch'},
  {id:'rehearsal', group:'실행 준비', title:'리허설 · 결과 검증', detail:'생성부터 매도와 졸업까지 실제 테스트 결과와 리비전을 남깁니다.', section:'launch'},
  {id:'response', group:'시장 반응', title:'관찰 기준 · 중단 기준', detail:'공개 풀·홀더·실제 반응의 출처와 시각을 남깁니다.', section:'response'},
];
const encoder = new TextEncoder();
export function safeUrl(value, optional = true) {
  if (optional && value === '') return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('출처와 이미지 링크는 자격증명이 없는 HTTPS 주소를 사용하세요.');
  return url.href;
}
export function ethWei(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,18})?$/.test(value)) throw new Error('ETH 금액은 양수 또는 0, 소수 18자리 이내로 입력하세요.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}
export function formatEth(wei) {
  const digits = wei.toString().padStart(19, '0');
  return `${digits.slice(0, -18)}.${digits.slice(-18)}`.replace(/\.?0+$/, '');
}
export function budgetTotal(budget) {
  return formatEth(Object.values(budget).reduce((sum, value) => sum + ethWei(value), 0n));
}
function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${label} 형식이나 길이를 확인하세요.`);
  return value;
}
function keys(obj, expected) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(key => !expected.includes(key))) throw new Error('지원하지 않는 프로젝트 필드가 있습니다. 키·지갑 정보는 저장하지 마세요.');
}
export function newProject() {
  return {schemaVersion:1, id:crypto.randomUUID(), name:'', symbol:'', description:'', image:'', website:'', social:'', chain:'rh', route:'pons',
    budget:{gas:'0', creation:'0', liquidity:'0', reserve:'0', devBuy:'0'}, budgetSource:'',
    hypothesis:'', stopRule:'', materials:Object.fromEntries(MATERIALS.map(m => [m.id,{status:'todo', evidence:''}])), observations:[], updatedAt:new Date().toISOString()};
}
export function validateProject(input) {
  keys(input, ['schemaVersion','id','name','symbol','description','image','website','social','chain','route','budget','budgetSource','hypothesis','stopRule','materials','observations','updatedAt']);
  if (input.schemaVersion !== 1 || !/^[a-zA-Z0-9-]{1,64}$/.test(input.id)) throw new Error('프로젝트 버전을 확인하세요.');
  if (!Object.hasOwn(NETWORKS,input.chain) || !['pons','native'].includes(input.route) || (input.chain === 'giwa' && input.route !== 'native')) throw new Error('GIWA는 자체 빌드·리허설 경로를 사용하세요.');
  const p = {...input};
  for (const [field, max] of Object.entries({name:64,symbol:16,description:2000,hypothesis:2000,stopRule:2000})) p[field] = text(input[field],max,field);
  if (encoder.encode(p.name).length > 64 || encoder.encode(p.symbol).length > 16) throw new Error('이름은 UTF-8 64바이트, 심볼은 16바이트 이내여야 합니다.');
  for (const field of ['image','website','social','budgetSource']) p[field] = safeUrl(text(input[field],2000,field));
  keys(p.budget, ['gas','creation','liquidity','reserve','devBuy']);
  for (const field of ['gas','creation','liquidity','reserve','devBuy']) ethWei(p.budget[field]);
  keys(p.materials, MATERIALS.map(m=>m.id));
  for (const m of MATERIALS) {
    const entry = p.materials[m.id]; keys(entry,['status','evidence']);
    if (!['todo','working','ready'].includes(entry.status)) throw new Error('준비물 상태를 확인하세요.');
    safeUrl(text(entry.evidence,2000,'준비물 근거'));
    if (entry.status === 'ready' && !entry.evidence) throw new Error('준비 완료에는 검토 근거 링크가 필요합니다.');
  }
  if (!Array.isArray(p.observations) || p.observations.length > 200) throw new Error('관찰 기록은 프로젝트당 최대 200개입니다.');
  for (const entry of p.observations) {
    keys(entry,['observedAt','recordedAt','kind','note','source']);
    if (!['observed','reported','hypothesis'].includes(entry.kind)) throw new Error('관찰 분류를 확인하세요.');
    for (const k of ['observedAt','recordedAt']) if (typeof entry[k] !== 'string' || !Number.isFinite(Date.parse(entry[k]))) throw new Error('관찰 시각을 확인하세요.');
    if (Date.parse(entry.observedAt) > Date.now() + 60_000) throw new Error('관찰 시각은 미래일 수 없습니다.');
    text(entry.note,2000,'관찰 내용');
    if (!entry.note.trim()) throw new Error('관찰 내용을 입력하세요.');
    safeUrl(entry.source,false);
  }
  if (!Number.isFinite(Date.parse(p.updatedAt))) throw new Error('저장 시각을 확인하세요.');
  return structuredClone(p);
}
export function buildConfig(p) {
  return {name:p.name.trim(), symbol:p.symbol.trim(), chain:p.chain};
}
export function validateBuild(input) {
  keys(input,['name','symbol','chain']);
  if (!Object.hasOwn(NETWORKS,input.chain)) throw new Error('지원하지 않는 체인입니다.');
  for (const [k,max] of [['name',64],['symbol',16]]) {
    text(input[k],max,k);
    if (!input[k].trim() || input[k] !== input[k].trim() || encoder.encode(input[k]).length > max) throw new Error(`${k}: 공백과 UTF-8 길이를 확인하세요.`);
  }
  return {name:input.name,symbol:input.symbol,chain:input.chain};
}
export function nextActions(p, compiled) {
  const actions = [];
  if (!p.name.trim() || !p.symbol.trim() || !p.description.trim()) actions.push({label:'이름·심볼·소개 입력',section:'project'});
  if (!p.image) actions.push({label:'이미지 원본 URL 준비',section:'project'});
  if (!compiled) actions.push({label:'토큰 소스 컴파일',section:'build'});
  if (!p.budgetSource || budgetTotal(p.budget) === '0') actions.push({label:'예산과 산정 근거 입력',section:'launch'});
  if (!p.hypothesis || !p.stopRule) actions.push({label:'반응 가설과 중단 기준 입력',section:'response'});
  return actions;
}
