import React,{useState,useRef} from 'react';
import {runtime} from './runtime.mjs';
import {publicationScene,publishedWorkspace,expectedRevision,applySceneReceipt} from './workspace.mjs';
import {loadPublishedScene,publishStudioScene,startStudioSignIn} from '../src/studio-client.mjs';
import {publishImages} from '../src/images.mjs';
import {getAutomationConfig,publishAutomationImages,saveAutomationConfig} from '../src/automation-twitch.mjs';

export default function PublishPanel({workspace,setWorkspace,onPublished,onPreview}) {
  const {auth,snapshot,automationSnapshot,base,BACKUP}=runtime;
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[review,setReview]=useState(null),[owned,setOwned]=useState(automationSnapshot.ownedMerch===true);
  const lock=useRef(false),[uncertain,setUncertain]=useState(false);
  async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e.message);}finally{lock.current=false;setBusy(false);}}
  async function refresh(replace=false){
    const [scene,moments]=await Promise.all([loadPublishedScene(auth),getAutomationConfig(auth)]);
    Object.assign(snapshot,scene,{capturedAt:new Date().toISOString()});Object.assign(automationSnapshot,moments);Object.assign(base,publishedWorkspace(scene,moments));
    if(replace){localStorage.setItem(BACKUP,JSON.stringify(workspace));setWorkspace(structuredClone(base));setOwned(moments.ownedMerch);}
    setUncertain(false);setReview(null);onPublished();setMessage(replace?'Published scene and moments loaded into your draft. The previous draft is backed up.':'Published view refreshed. Your draft is unchanged.');
  }
  async function publish(){
    const copy=structuredClone(review.workspace),kind=review.kind;
    // A revision conflict or interrupted request requires a read before any retry.
    try{
      if(kind==='scene'){
        const revision=expectedRevision(copy,'scene');
        const prepared=await publishImages(publicationScene(copy),auth);
        const result=await publishStudioScene(auth,prepared,revision);
        Object.assign(snapshot,result,{capturedAt:new Date().toISOString()});
        base.scene=result.scene;base.sceneRevision=result.revision;
        setWorkspace(current=>applySceneReceipt(current,copy,result));
        setMessage(`Scene published · revision ${result.revision}. Connected viewers receive it within about 10 seconds. Moments were not changed.`);
      }else{
        const revision=expectedRevision(copy,'automation');
        const prepared=await publishAutomationImages(copy.automation,auth,owned);
        const result=await saveAutomationConfig(auth,prepared,revision,owned);
        Object.assign(automationSnapshot,result);base.automation=result.design;base.automationRevision=result.revision;
        setWorkspace(current=>({...current,automation:JSON.stringify(current.automation)===JSON.stringify(copy.automation)?result.design:current.automation,automationRevision:result.revision}));
        setMessage(`Moments published · revision ${result.revision}. Enabled rules are now saved for your channel. The scene was not changed.`);
      }
      setReview(null);onPublished();
    }catch(e){setUncertain(true);throw Error(`${e.message} Refresh the published view to check what was saved. Your draft is preserved.`);}
  }
  return <section className="publish-panel panel" aria-label="Publish to your channel">
    <div className="section-head"><div><h2>{auth?'Ready for your viewers?':'Make it yours'}</h2><p>{auth?`Publishing to @${auth.profile.login}. Scene revision ${snapshot.revision} · Moments revision ${automationSnapshot.revision}.`:'Explore all 47 templates, then sign in to build and publish for your channel.'}</p></div><button onClick={onPreview}>Preview scene</button></div>
    {auth?<><p>Scene publishes the layout, buttons and game. Moments publishes popups, timers and event rules. Each has its own review and save.</p><div className="test-buttons"><button disabled={busy||uncertain} onClick={()=>{setMessage('');setReview({kind:'scene',workspace:structuredClone(workspace)});}}>Review scene to publish</button><button disabled={busy||uncertain} onClick={()=>{setMessage('');setReview({kind:'automation',workspace:structuredClone(workspace)});}}>Review moments to publish</button><button disabled={busy} onClick={()=>run(()=>refresh())}>Refresh published view</button></div><details><summary>Replace this draft with the published version</summary><p>Your current draft will be backed up first. Use this after another editor has published changes.</p><button disabled={busy} onClick={()=>run(()=>refresh(true))}>Back up draft & load published</button></details></>:<button onClick={()=>run(()=>startStudioSignIn())}>Sign in with Twitch</button>}
    {message&&<p className="callout" role="status">{message}</p>}
    {review&&<div className="confirm-backdrop"><section role="dialog" aria-modal="true" aria-label="Review publication" className="panel"><h2>Publish {review.kind==='scene'?'scene':'moments'} to @{auth.profile.login}?</h2>{review.kind==='scene'?<><p>{review.workspace.scene.name} · {publicationScene(review.workspace).objects.length} visible objects · {review.workspace.scene.experience?'1 game or story':'No game or story'}.</p><p>{review.workspace.hidden?.length||0} hidden objects will be left out of the published scene.</p></>:<><p>{review.workspace.automation.rules.filter(r=>r.enabled).length} enabled rules · {review.workspace.automation.carousels.length} carousels. Saving replaces your channel’s current moment settings.</p><label><input type="checkbox" checked={owned} onChange={e=>setOwned(e.target.checked)}/> Linked carousels promote my own branded merchandise.</label></>}<p>This changes what connected viewers can see. Uploaded media will be hosted for your channel.</p><div className="test-buttons"><button className="primary" disabled={busy||uncertain} onClick={()=>run(publish)}>{busy?'Publishing…':'Publish now'}</button><button disabled={busy} onClick={()=>setReview(null)}>Keep editing</button></div>{message&&<p role="alert">{message}</p>}</section></div>}
  </section>;
}
