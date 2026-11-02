import {validateExperience} from '../src/experience.mjs';
import {decodeBackupMedia,storeMedia} from '../src/experience-media.mjs';

// This bundle is generated from our own maze source at build time. Its PNGs
// already satisfy the upload budget; do not re-encode every corridor in canvas.
export async function loadMazeTemplate(onProgress=()=>{}) {
  const response=await fetch(new URL('./studio/quiet-vault.experience.json',location.href),{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('The maze template could not load. Please try again.');
  const input=await response.json(),design=validateExperience(input.design),assets=[];
  if(input.format!=='scene-studio-experience-backup')throw Error('The maze template is invalid.');
  for(const asset of design.assets){
    const blob=decodeBackupMedia(input.files?.[asset.source]);
    if(asset.kind!=='image'||blob.type!=='image/png'||blob.size>200000)throw Error('The maze artwork is invalid.');
    const source=await storeMedia(blob);assets.push({...asset,source});
    onProgress(`Preparing maze artwork · ${assets.length} of ${design.assets.length}`);
  }
  return validateExperience({...design,assets});
}
