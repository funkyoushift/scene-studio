import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMazeExperience} from '../scripts/build-brb-maze.mjs';
import {advanceExperience,initialExperienceState,conditionsMet} from '../src/experience.mjs';
test('BRB maze compiles for the unchanged v1 player and every passage is reversible',()=>{
  const {design,mazes}=buildMazeExperience();assert.ok(design.scenes.length<=100);assert.ok(design.assets.length<=128);assert.ok(Buffer.byteLength(JSON.stringify(design))<=750000);
  for(const maze of mazes){assert.ok(maze.minimumSteps>=maze.size*2);for(let cell=0;cell<maze.cells.length;cell++)for(let d=0;d<4;d++){const next=maze.cells[cell][d];if(next!==null)assert.equal(maze.cells[next][(d+2)%4],cell);}}
});
test('real player transitions solve all three mazes; turns stay put and steps count correctly',()=>{
  const {design,mazes}=buildMazeExperience();let state=initialExperienceState(design),steps=0;
  const click=label=>{const scene=design.scenes.find(s=>s.id===state.scene),button=scene.elements.find(e=>e.kind==='button'&&e.label===label&&conditionsMet(e.when,state.values));assert.ok(button,`Missing ${label} in ${state.scene}`);state=advanceExperience(design,state,button.actions);};
  click('ENTER THE VAULT');
  for(let level=0;level<mazes.length;level++){
    const maze=mazes[level];
    for(let i=0;i<maze.solution.length-1;i++){
      const cell=maze.solution[i],next=maze.solution[i+1],direction=maze.cells[cell].indexOf(next);
      while(state.values.facing!==direction){const before=state.scene;click('RIGHT ↷');assert.equal(state.scene,before);}
      click('FORWARD ↑');steps++;assert.equal(state.values.steps,steps);
      if(next!==maze.exit){click('BACK ↓');steps++;assert.equal(state.scene,`maze${level+1}-cell${cell}`);click('FORWARD ↑');steps++;}
    }
    if(level<2)click(`ENTER MAZE ${level+2}`);
  }
  assert.equal(state.scene,'escaped');assert.equal(state.values.steps,steps);click('TRY AGAIN');assert.equal(state.scene,'welcome');assert.equal(state.values.steps,0);
});
