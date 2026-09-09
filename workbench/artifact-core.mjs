import {validateBuild,NETWORKS} from './model.mjs?v=7a5d7ea03bd2048f30da301553c7111801224d2d88a020053696e35d93938595';

export function compilerResult(input,output,version) {
  if(!version.startsWith('0.8.30+commit.73712a01.'))throw new Error('Compiler version mismatch');
  const failures=(output.errors??[]).filter(e=>e.severity==='error');
  if(failures.length)throw new Error(failures.map(e=>e.formattedMessage).join('\n'));
  const c=output.contracts?.['contracts/v1/LaunchToken.sol']?.LaunchToken;
  if(!c?.evm?.bytecode?.object || Object.keys(c.evm.deployedBytecode.immutableReferences).length)throw new Error('Invalid token artifact');
  return {compiler:version,openzeppelin:'5.4.0',input,abi:c.abi,bytecode:`0x${c.evm.bytecode.object}`,runtimeBytecode:`0x${c.evm.deployedBytecode.object}`,metadata:JSON.parse(c.metadata),warnings:(output.errors??[]).map(e=>e.formattedMessage)};
}
export function bindBuild(artifact,config,sourceHash,buildId) {
  config=validateBuild(config);
  return {...artifact,sourceHash,config,chainId:NETWORKS[config.chain].chainId,buildId,
    status:'compiled_token_component',compiledAt:new Date().toISOString(),constructor:{name_:config.name,symbol_:config.symbol,curve_:null},
    remaining:['Verified distribution contract address','Factory, curve, graduation target and permanent LP implementation','End-to-end rehearsal and reviewed deployment','Human wallet review and signature'],
    deploymentAuthorized:false,transactionSigningAuthorized:false};
}
