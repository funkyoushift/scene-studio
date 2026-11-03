import {validateScene} from '../src/scene.mjs';
import {validateAutomations} from '../src/automations.mjs';

export function workspaceKeys(channelId) {
  if(channelId!==null && !/^[1-9][0-9]{0,19}$/.test(channelId))throw Error('Invalid channel identity.');
  const SLUG=`studio-${channelId||'explore'}`;
  const SAVE=`scene-studio-workspace-v1:${SLUG}`;
  return {SLUG,SAVE,BACKUP:SAVE+'-previous'};
}
export function publishedWorkspace(scene,automation) {
  return {scene:validateScene(scene.scene),automation:validateAutomations(automation.design),hidden:[],sceneRevision:scene.revision,automationRevision:automation.revision};
}
export function publicationScene(workspace) {
  return validateScene({...workspace.scene,objects:workspace.scene.objects.filter(o=>!workspace.hidden?.includes(o.id))});
}
export function expectedRevision(workspace,kind) {
  const revision=workspace[kind+'Revision'];
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('This draft has no saved revision. Export it, then load the published workspace before importing your changes.');
  return revision;
}
export function applySceneReceipt(current,submitted,result) {
  const unchanged=JSON.stringify(current.scene)===JSON.stringify(submitted.scene)&&JSON.stringify(current.hidden)===JSON.stringify(submitted.hidden);
  // Keep hidden objects editable after publishing. Only visible objects appear
  // in the receipt; merge their hosted media back without deleting the others.
  const scene=unchanged ? {...result.scene,objects:current.scene.objects.map(o=>result.scene.objects.find(saved=>saved.id===o.id)||o)} : current.scene;
  return {...current,scene,sceneRevision:result.revision};
}

// Recovery is a replacement, not a merge. Never discard edits made while the
// published workspace was loading, and require a successful backup first.
export function recoverPublishedDraft(started,current,published,saveBackup) {
  if(JSON.stringify(started)!==JSON.stringify(current))return {replaced:false,workspace:current};
  const replacement=structuredClone(published);
  saveBackup(JSON.stringify(current));
  return {replaced:true,workspace:replacement};
}
