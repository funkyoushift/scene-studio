import React,{useRef,useEffect,useState} from 'react';
import Scene from './Scene.jsx';
import AutomationViewer from './AutomationViewer.jsx';
import CardGame from './CardPlayer.jsx';
import {watchTwitchScene,channelProfile,sendParty} from './twitch.mjs';
const helper=window.Twitch?.ext;
function Viewer() {
  const [scene, setScene] = useState(null),
    [creator, setCreator] = useState(null),
    [status, setStatus] = useState("Waiting for the channel’s scene…"),
    [sharedEvent,setSharedEvent]=useState(null),
    [automationAuth,setAutomationAuth]=useState(null);
  const partyAuth=useRef(null);
  useEffect(() => {
    document.body.classList.add("viewer");
    if (!helper) {
      setStatus("Open this viewer through Twitch to load the channel’s scene.");
      return;
    }
    let active = true;
    helper.onAuthorized((auth) => {
      if (!active) return;
      partyAuth.current=auth;
      setAutomationAuth(auth);
      setCreator(previous => previous?.id === auth.channelId ? previous : null);
      channelProfile(auth)
        .then((profile) => {
          if (active && partyAuth.current === auth && profile.id === auth.channelId) setCreator(profile);
        })
        .catch(() => {if(active && partyAuth.current === auth) setStatus("The channel’s creator could not be confirmed. Refresh to try again.");});
    });
    const stop = watchTwitchScene(helper, setScene, setStatus,setSharedEvent,()=>partyAuth.current);
    return () => {
      active = false;
      stop();
    };
  }, []);
  return <><CardGame auth={automationAuth} helper={helper}/><AutomationViewer helper={helper} auth={automationAuth} creator={creator} brandImage={scene?.objects.find(o=>o.image && o.imageFit==='icon')?.image} />{scene && (creator || (scene.objects.length === 0 && !scene.experience)) ? (
    <>
      <Scene scene={scene} sharedEvent={sharedEvent} beforeParty={()=>{
        if(!helper.viewer.isLinked) {helper.actions.requestIdShare();throw new Error("Link your identity, then click again to celebrate and post in chat.");}
        if(!helper.features?.isChatEnabled) throw new Error("The streamer has not enabled extension chat.");
      }} onParty={object=>sendParty(partyAuth.current,object)} />
      {creator && (scene.objects.length > 0 || scene.experience) && (
        <span className="creator-credit">Objects by {creator.login}</span>
      )}
    </>
  ) : (
    <div className="viewer-status">{status || "Confirming the creator of these objects…"}</div>
  )}</>;
}


export default Viewer;
