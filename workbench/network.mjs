import {NETWORKS} from './model.mjs';

export async function observeNetwork(key, fetcher = fetch) {
  if (!Object.hasOwn(NETWORKS,key)) throw new Error('지원하지 않는 네트워크입니다.');
  const network = NETWORKS[key];
  const call = async (method, id) => {
    const res = await fetcher(network.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params:[]}),signal:AbortSignal.timeout(6000),redirect:'error'});
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const body = await res.json();
    if (body.error || body.id !== id || body.jsonrpc !== '2.0' || !/^0x[0-9a-f]+$/i.test(body.result)) throw new Error('RPC 응답을 검증하지 못했습니다.');
    return BigInt(body.result);
  };
  // Check identity before reading any telemetry. No caller-controlled URL or method.
  if (await call('eth_chainId',1) !== BigInt(network.chainId)) throw new Error('체인 ID 불일치');
  const [block,gas] = await Promise.all([call('eth_blockNumber',2),call('eth_gasPrice',3)]);
  return {status:'observed',network:key,chainId:network.chainId,kind:network.kind,block:block.toString(),gasPriceWei:gas.toString(),source:network.rpc,observedAt:new Date().toISOString(),research_only:true,strategy_consumption_allowed:false,order_input:false};
}
