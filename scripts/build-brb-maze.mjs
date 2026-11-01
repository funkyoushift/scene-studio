// Authoring tool only. Output is ordinary v1 experience data + PNG images;
// no code is uploaded to or added to the installed Twitch player.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import {validateExperience} from '../src/experience.mjs';

export const DIRECTIONS=[[0,-1],[1,0],[0,1],[-1,0]];
const opposite=d=>(d+2)%4;
function random(seed){let n=seed>>>0;return()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return(n>>>0)/4294967296;};}
export function createMaze(size,seed){
  const rng=random(seed),cells=Array.from({length:size*size},()=>[null,null,null,null]),seen=new Set([0]),stack=[0];
  while(stack.length){
    const current=stack.at(-1),x=current%size,y=Math.floor(current/size);
    const choices=DIRECTIONS.map(([dx,dy],direction)=>({x:x+dx,y:y+dy,direction})).filter(p=>p.x>=0&&p.x<size&&p.y>=0&&p.y<size&&!seen.has(p.y*size+p.x));
    if(!choices.length){stack.pop();continue;}
    const selected=choices[Math.floor(rng()*choices.length)],next=selected.y*size+selected.x;
    cells[current][selected.direction]=next;cells[next][opposite(selected.direction)]=current;seen.add(next);stack.push(next);
  }
  const distances=start=>{const distance=new Map([[start,0]]),queue=[start];for(const node of queue)for(const next of cells[node])if(next!==null&&!distance.has(next)){distance.set(next,distance.get(node)+1);queue.push(next);}return distance;};
  const farthest=from=>[...distances(from)].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
  const start=farthest(0)[0],[exit,minimumSteps]=farthest(start);
  const distance=distances(exit),solution=[start];while(solution.at(-1)!==exit){const current=solution.at(-1);solution.push(cells[current].find(n=>n!==null&&distance.get(n)===distance.get(current)-1));}
  return{size,seed,cells,start,exit,minimumSteps,solution};
}
function mask(maze,cell,facing){return(maze.cells[cell][facing]!==null?1:0)|(maze.cells[cell][(facing+3)%4]!==null?2:0)|(maze.cells[cell][(facing+1)%4]!==null?4:0);}
export function corridorView(maze,cell,facing){
  const forward=maze.cells[cell][facing],near=mask(maze,cell,facing),far=forward===null?0:mask(maze,forward,facing);
  const exit=forward===maze.exit?1:forward!==null&&maze.cells[forward][facing]===maze.exit?2:0;
  return{near,far,exit,key:`view-${near}-${far}-${exit}`};
}
const poly=(points,fill,stroke='#2c4a68',width=2)=>`<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const lerp=(a,b,t)=>a+(b-a)*t;
const point=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t)];
export function corridorSVG({near,far,exit}){
  const rects=[{l:-70,r:1350,t:-50,b:770},{l:300,r:980,t:125,b:540},{l:495,r:785,t:210,b:415}];
  let drawing='';
  for(let depth=1;depth>=0;depth--){
    const a=rects[depth],b=rects[depth+1],bits=depth===0?near:far;
    const l1=[a.l,a.t],l2=[b.l,b.t],l3=[b.l,b.b],l4=[a.l,a.b],r1=[a.r,a.t],r2=[b.r,b.t],r3=[b.r,b.b],r4=[a.r,a.b];
    drawing+=poly([l1,r1,r2,l2],'url(#ceiling)')+poly([l4,r4,r3,l3],'url(#floor)');
    for(const t of [.18,.38,.58,.78]){const left=point(l4,l3,t),right=point(r4,r3,t);drawing+=`<path d="M${left} L${right}" stroke="#1f4056" stroke-width="2"/>`;}
    for(const side of ['left','right']){
      const p=side==='left'?[l1,l2,l3,l4]:[r1,r2,r3,r4],open=bits&(side==='left'?2:4);
      drawing+=poly(p,side==='left'?'url(#wallL)':'url(#wallR)');
      if(open){
        const topA=point(p[0],p[1],.18),topB=point(p[0],p[1],.82),bottomA=point(p[3],p[2],.18),bottomB=point(p[3],p[2],.82);
        topA[1]=lerp(topA[1],bottomA[1],.12);topB[1]=lerp(topB[1],bottomB[1],.12);
        drawing+=poly([topA,topB,bottomB,bottomA],'#030812','#53859b',4);
        const innerA=point(topA,topB,.20),innerB=point(bottomA,bottomB,.20);
        drawing+=`<path d="M${innerA} L${innerB}" stroke="#19384e" stroke-width="${depth?3:8}"/>`;
      }else{
        for(const t of [.24,.50,.76])drawing+=`<path d="M${point(p[0],p[1],t)} L${point(p[3],p[2],t)}" stroke="#1c354a" stroke-width="3"/>`;
        drawing+=`<path d="M${point(p[0],p[3],.47)} L${point(p[1],p[2],.47)}" stroke="#243f55" stroke-width="3"/>`;
      }
      drawing+=`<path d="M${point(p[0],p[3],.07)} L${point(p[1],p[2],.07)}" stroke="#73e7ed" stroke-width="${depth?3:6}" filter="url(#glow)"/>`;
    }
    if(!(bits&1)){
      drawing+=`<rect x="${b.l}" y="${b.t}" width="${b.r-b.l}" height="${b.b-b.t}" fill="url(#end)" stroke="#31536a" stroke-width="4"/>`;
      for(const t of [.25,.5,.75])drawing+=`<path d="M${b.l},${lerp(b.t,b.b,t)} H${b.r}" stroke="#233c50" stroke-width="3"/>`;
      drawing+=`<path d="M640,${b.t} V${b.b}" stroke="#233c50" stroke-width="3"/>`;
    }else if(exit===depth+1){
      drawing+=`<rect x="${b.l+15}" y="${b.t+10}" width="${b.r-b.l-30}" height="${b.b-b.t-10}" fill="#312311" stroke="#ffd575" stroke-width="10" filter="url(#glow)"/><text x="640" y="${(b.t+b.b)/2}" fill="#fff1c9" text-anchor="middle" font-family="sans-serif" font-size="${depth?30:48}" font-weight="700">EXIT</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="ceiling" x2="0" y2="1"><stop stop-color="#07101c"/><stop offset="1" stop-color="#15283b"/></linearGradient><linearGradient id="floor" x2="0" y2="1"><stop stop-color="#0c1b29"/><stop offset="1" stop-color="#183143"/></linearGradient><linearGradient id="wallL"><stop stop-color="#182a3c"/><stop offset="1" stop-color="#2b495f"/></linearGradient><linearGradient id="wallR"><stop stop-color="#29485e"/><stop offset="1" stop-color="#101f30"/></linearGradient><linearGradient id="end" x2="0" y2="1"><stop stop-color="#2b4356"/><stop offset="1" stop-color="#122535"/></linearGradient><filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><radialGradient id="vignette"><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs><rect width="1280" height="720" fill="#06101a"/>${drawing}<rect width="1280" height="720" fill="url(#vignette)"/><path d="M605 685h70" stroke="#72e5e7" stroke-width="4"/><text x="640" y="663" text-anchor="middle" fill="#9fc2d0" font-family="sans-serif" letter-spacing="6" font-size="15">THE QUIET VAULT</text></svg>`;
}
const sourceFor=key=>{const hex=createHash('sha256').update(key).digest('hex');return`local-media:${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;};
const condition=facing=>[{variable:'facing',op:'eq',value:facing}];
const button=(id,label,x,y,width,height,actions,when=[])=>({id,kind:'button',label,x,y,width,height,background:'#1b4560',color:'#f0fbff',fontSize:20,actions,when});
export function buildMazeExperience(){
  const mazes=[createMaze(4,80117),createMaze(5,224461),createMaze(6,907633)];
  const views=new Map(),scenes=[],assets=[];
  const sceneId=(level,cell)=>`maze${level+1}-cell${cell}`;
  const enter=level=>[{type:'set',variable:'facing',value:mazes[level].cells[mazes[level].start].findIndex(n=>n!==null)},{type:'goto',scene:sceneId(level,mazes[level].start)}];
  const intro={id:'welcome',title:'THE QUIET VAULT · BRB',description:'The streamer will be right back. Escape three increasingly tangled mazes. Click Forward or Back to move one space; Left and Right turn you in place. Find the golden EXIT in each maze. No items, keyboard, timer or shared score. Your progress stays on this device.',background:'#0a1625',elements:[{id:'intro-title',kind:'text',label:'THREE MAZES. ONE WAY OUT.',x:10,y:18,width:80,height:20,fontSize:38,background:'#0a1625',color:'#9ce9ec'},{id:'intro-note',kind:'text',label:'A click-controlled BRB challenge',x:15,y:42,width:70,height:12,fontSize:24,background:'#0a1625'},button('enter','ENTER THE VAULT',25,65,50,17,enter(0))]};
  scenes.push(intro);
  for(const [level,maze] of mazes.entries()){
    for(let cell=0;cell<maze.cells.length;cell++){
      if(cell===maze.exit)continue;
      const elements=[];
      for(let facing=0;facing<4;facing++){
        const view=corridorView(maze,cell,facing);views.set(view.key,view);
        elements.push({id:`view${facing}`,kind:'image',asset:view.key,label:'Corridor view',x:0,y:0,width:100,height:78,background:'#07131e',when:condition(facing)});
      }
      for(let facing=0;facing<4;facing++){
        const movement=(direction,id,label,x)=>{
          const next=maze.cells[cell][direction];
          if(next===null){elements.push({id:`${id}${facing}`,kind:'text',label: id==='forward'?'WALL AHEAD':'WALL BEHIND',x,y:83,width:22,height:13,background:'#17212d',color:'#78909f',fontSize:16,when:condition(facing)});return;}
          const destination=next===maze.exit?(level===2?'escaped':`clear${level+1}`):sceneId(level,next);
          elements.push(button(`${id}${facing}`,label,x,83,22,13,[{type:'add',variable:'steps',value:1},{type:'goto',scene:destination}],condition(facing)));
        };
        movement(facing,'forward','FORWARD ↑',27);movement(opposite(facing),'back','BACK ↓',51);
        elements.push(button(`left${facing}`,'↶ LEFT',3,83,22,13,[{type:'set',variable:'facing',value:(facing+3)%4}],condition(facing)));
        elements.push(button(`right${facing}`,'RIGHT ↷',75,83,22,13,[{type:'set',variable:'facing',value:(facing+1)%4}],condition(facing)));
      }
      scenes.push({id:sceneId(level,cell),title:`BRB · Maze ${level+1} of 3`,description:'Reach the golden exit. Left/right turn; forward/back step. Total steps: {steps}',background:'#07131e',elements});
    }
    if(level<2)scenes.push({id:`clear${level+1}`,title:`Maze ${level+1} complete`,description:`You found the exit. The next maze is larger. Total steps: {steps}`,background:'#0a1625',elements:[{id:'clear-title',kind:'text',label:'THE VAULT GOES DEEPER',x:10,y:22,width:80,height:23,fontSize:36,background:'#0a1625',color:'#ffe0a0'},button('continue',`ENTER MAZE ${level+2}`,25,61,50,18,enter(level+1))]});
  }
  scenes.push({id:'escaped',title:'You escaped the Quiet Vault',description:'Three mazes conquered. Total steps: {steps}. The streamer will be back soon. This challenge awards no paid or physical prizes.',background:'#0a1625',elements:[{id:'victory',kind:'text',label:'VAULT CLEARED',x:10,y:15,width:80,height:25,fontSize:44,background:'#0a1625',color:'#ffe0a0'},button('again','TRY AGAIN',25,62,50,18,[{type:'restart'}])]});
  for(const view of views.values())assets.push({id:view.key,kind:'image',name:`Corridor ${view.near}-${view.far}${view.exit?' · exit':''}`,source:sourceFor(view.key)});
  const design=validateExperience({kind:'experience',version:1,id:'quiet-vault-brb-v1',name:'BRB · The Quiet Vault',enabled:true,saveProgress:true,start:'welcome',variables:[{id:'facing',initial:0},{id:'steps',initial:0}],scenes,assets});
  return{design,mazes,views};
}
async function main(){
  const directory=path.resolve('outputs/brb-maze-20261101');await mkdir(directory,{recursive:true});
  const {design,mazes,views}=buildMazeExperience(),files={};
  for(const asset of design.assets){const data=await sharp(Buffer.from(corridorSVG(views.get(asset.id)))).resize({width:1024}).png().toBuffer();files[asset.source]=`data:image/png;base64,${data.toString('base64')}`;await writeFile(path.join(directory,`${asset.id}.png`),data);}
  const backup={format:'scene-studio-experience-backup',design,files};
  await writeFile(path.join(directory,'quiet-vault-brb.experience.json'),JSON.stringify(backup));
  await writeFile(path.join(directory,'maze-solutions.json'),JSON.stringify(mazes,null,2));
  const receipt={scenes:design.scenes.length,images:design.assets.length,manifestBytes:Buffer.byteLength(JSON.stringify(design)),backupBytes:Buffer.byteLength(JSON.stringify(backup)),minimumSteps:mazes.map(m=>m.minimumSteps),file:path.join(directory,'quiet-vault-brb.experience.json')};
  await writeFile(path.join(directory,'build-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
