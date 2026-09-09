import {NETWORKS} from './model.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';
import {getAddress,toQuantity} from './eth.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';

export function discoverWallets(target,announce) {
  const seen=new Set();
  const add=(provider,name,id)=>{
    if(!provider||typeof provider.request!=='function'||seen.has(provider))return;
    seen.add(provider);announce({provider,name:String(name||'브라우저 지갑').slice(0,80),id});
  };
  const listener=event=>{const d=event.detail;if(d?.info&&typeof d.info.uuid==='string')add(d.provider,d.info.name,d.info.uuid);};
  target.addEventListener('eip6963:announceProvider',listener);
  target.dispatchEvent(new Event('eip6963:requestProvider'));
  for(const [i,p]of (target.ethereum?.providers||[target.ethereum]).entries())add(p,'브라우저 지갑',`legacy-${i}`);
  return ()=>target.removeEventListener('eip6963:announceProvider',listener);
}
export class WalletSession {
  constructor(changed=()=>{}){this.changed=changed;this.epoch=0;this.provider=null;this.account=null;this.chainId=null;}
  disconnect(){
    if(this.provider?.removeListener)for(const [name,fn]of this.listeners||[])this.provider.removeListener(name,fn);
    this.provider=null;this.account=null;this.chainId=null;this.epoch++;this.changed();
  }
  async connect(provider){
    this.disconnect();const epoch=this.epoch;
    const accounts=await provider.request({method:'eth_requestAccounts'});
    const chain=await provider.request({method:'eth_chainId'});
    if(epoch!==this.epoch)throw Error('지갑 연결이 변경됐습니다.');
    if(!accounts?.[0])throw Error('지갑에서 계정을 선택하세요.');
    this.provider=provider;this.account=getAddress(accounts[0]);this.chainId=Number(BigInt(chain));
    const invalid=()=>{this.epoch++;this.account=null;this.chainId=null;this.changed();};
    this.listeners=[['accountsChanged',invalid],['chainChanged',invalid],['disconnect',()=>this.disconnect()]];
    for(const [name,fn]of this.listeners)provider.on?.(name,fn);
    this.changed();return this.account;
  }
  async switchChain(chain){
    if(!this.provider)throw Error('지갑을 먼저 연결하세요.');
    const n=NETWORKS[chain];if(!n)throw Error('지원하지 않는 체인입니다.');
    const provider=this.provider,chainId=toQuantity(n.chainId);
    try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId}]});}
    catch(error){
      if(Number(error.code)!==4902)throw error;
      await provider.request({method:'wallet_addEthereumChain',params:[{chainId,chainName:n.name,nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:[n.rpc],blockExplorerUrls:[n.explorer]}]});
      await provider.request({method:'wallet_switchEthereumChain',params:[{chainId}]});
    }
    const accounts=await provider.request({method:'eth_accounts'}),actual=await provider.request({method:'eth_chainId'});
    if(provider!==this.provider||Number(BigInt(actual))!==n.chainId||!accounts[0])throw Error('대상 체인과 지갑 계정을 확인하세요.');
    this.account=getAddress(accounts[0]);this.chainId=n.chainId;this.epoch++;this.changed();
  }
  async assert(account,chainId){
    const provider=this.provider,epoch=this.epoch;
    if(!provider||!this.account||getAddress(account)!==this.account)throw Error('지갑 계정이 변경됐습니다. 다시 연결하고 견적을 확인하세요.');
    const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);
    if(provider!==this.provider||epoch!==this.epoch||!accounts[0]||getAddress(accounts[0])!==getAddress(account)||Number(BigInt(chain))!==chainId)throw Error('지갑 계정 또는 체인이 바뀌었습니다. 견적을 다시 확인하세요.');
    return provider;
  }
}
