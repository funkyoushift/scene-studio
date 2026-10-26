import {mkdir,readFile,writeFile} from "node:fs/promises";
import {validateScene,twitchContent} from "../src/scene.mjs";
await mkdir(new URL('../designs/',import.meta.url),{recursive:true});
const base={shape:"card",width:27,height:20,y:67,image:"",url:"",detail:"",icon:"spark"};
const party=validateScene({version:1,name:"FunkYouRev — The Unnecessary Party Department",objects:[
 { ...base,id:"rev-emergency-ducks",title:"Release the ducks",caption:"",action:"party",preset:"ducks",x:5,color:"#facc15"},
 { ...base,id:"rev-emergency-disco",title:"Emergency disco",caption:"",action:"party",preset:"disco",x:36.5,color:"#e879f9"},
 { ...base,id:"rev-confetti-cannon",title:"Confetti cannon",caption:"",action:"party",preset:"confetti",x:68,color:"#38bdf8"},
 { ...base,id:"rev-party-instructions",title:"How this works",caption:"A very unserious control room",action:"reveal",x:31,y:88,width:38,height:10,shape:"pill",color:"#c4b5fd",icon:"info",detail:"Pick your ridiculous moment. Scene Studio posts a preset message in chat and sends a silent celebration to viewers with the extension open. No Bits or payment. Link your Twitch identity when asked and wait 20 seconds between clicks. Channel bans and timeouts apply. The streamer can disconnect optional chat at any time."},
]});
twitchContent(party);
await writeFile(new URL('../designs/funkyourev-party.json',import.meta.url),JSON.stringify(party,null,2));
const products=[
 {name:"funkyoumug",price:"$12.60",slug:"mug",product:"5469633",detail:"Ceramic mug. Dishwasher and microwave safe. Listed selection: 15 oz."},
 {name:"heavy funkyoushift",price:"$26.15",slug:"shirt",product:"5469636",detail:"Garment-dyed heavyweight tee. 100% ring-spun cotton, relaxed fit."},
 {name:"Unisex Heavy Blend Hoodie",price:"$36.55",slug:"hoodie",product:"5469637",detail:"Soft fleece hoodie with a front pouch pocket and double-lined hood. Cotton/polyester blend; composition varies by color."},
];
const objects=[{...base,id:"shift-store-header",action:"reveal",icon:"gift",shape:"pill",x:5,y:7,width:61,height:16,color:"#fb923c",title:"FunkYouSHiFT merch",caption:"Wear the chaos. Bring it home.",detail:"A storefront preview featuring real products from FunkYouSHiFT’s Streamlabs merch store. Choose a product to visit its actual listing. Checkout links are not yet approved for publishing in this Twitch extension."}];
for(const [i,p] of products.entries()) {
 const png=await readFile(new URL(`../assets/merch/${p.slug}.png`,import.meta.url));
 objects.push({...base,id:`shift-store-${p.slug}`,action:"link",icon:"gift",shape:"showcase",x:5+i*30.5,y:31,width:29,height:53,color:"#fb923c",title:p.name,caption:`${p.price} · View on Streamlabs ↗`,image:`data:image/png;base64,${png.toString('base64')}`,url:`https://streamlabs.com/FunkYouSHiFT/merch/${p.product}`,detail:p.detail});
}
objects.push({...base,id:"shift-store-notice",action:"reveal",icon:"info",shape:"pill",x:22,y:88,width:56,height:10,color:"#fb923c",title:"The official Streamlabs store",caption:"Preview · choose a product to visit its listing",detail:"Storefront preview using the actual Streamlabs listings checked October 25, 2026. Displayed prices may change or vary by size. Check the store for shipping, tax and final totals. This design is not approved for publishing as a Twitch shopping extension."});
const store=validateScene({version:1,name:"FunkYouSHiFT — Streamlabs merch storefront preview",objects});
await writeFile(new URL('../designs/funkyoushift-merch-preview.json',import.meta.url),JSON.stringify(store,null,2));
console.log('Created independent party and merch-preview designs. Party fits Twitch configuration. Store links remain local-preview only.');
