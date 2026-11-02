import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceKeys,publishedWorkspace,publicationScene,expectedRevision} from '../studio/workspace.mjs';
import {catalog,makeTemplate,emptyScene,emptyAutomation,findTemplates} from '../studio/catalog.mjs';
import {buildMazeExperience} from '../scripts/build-brb-maze.mjs';
import {preflightPublish} from '../src/images.mjs';
test('each account and signed-out exploration use separate draft and backup keys',()=>{
  const a=workspaceKeys('492630829'),b=workspaceKeys('1335954085'),c=workspaceKeys(null);
  for(const key of ['SAVE','BACKUP','SLUG'])assert.equal(new Set([a[key],b[key],c[key]]).size,3);
  assert.throws(()=>workspaceKeys('../another-user'));
});
test('saved drafts keep both starting revisions for conflict protection',()=>{
  const workspace=publishedWorkspace({scene:emptyScene(),revision:6},{design:emptyAutomation(),revision:9});
  const restored=JSON.parse(JSON.stringify(workspace));
  assert.equal(expectedRevision(restored,'scene'),6);assert.equal(expectedRevision(restored,'automation'),9);
  assert.throws(()=>expectedRevision({sceneRevision:null},'scene'));
});
test('full gallery has 47 source-backed usable templates and portable maze',()=>{
  assert.equal(catalog.length,47);
  assert.equal(new Set(catalog.map(x=>x.id)).size,47);
  const maze=buildMazeExperience().design;
  for(const item of catalog){const payload=makeTemplate(item,maze);assert.ok(payload.scene);assert.ok(payload.automation);for(const object of payload.scene.objects)if(object.action==='link'&&!object.url)object.url='https://example.com/';preflightPublish(payload.scene,'1335954085');}
  assert.equal(findTemplates('quiet vault').length,1);
});
test('publication respects hidden scene objects without deleting the editable draft',()=>{
  const item=catalog.find(c=>c.type==='widget');const ws=makeTemplate(item);ws.hidden=[ws.scene.objects[0].id];
  const before=JSON.stringify(ws);assert.equal(publicationScene(ws).objects.length,ws.scene.objects.length-1);assert.equal(JSON.stringify(ws),before);
});
