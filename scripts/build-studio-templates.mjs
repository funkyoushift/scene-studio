import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {buildMazeExperience,corridorSVG} from './build-brb-maze.mjs';
export async function buildStudioTemplates(directory){
  const {design,views}=buildMazeExperience(),files={};
  for(const asset of design.assets){
    const png=await sharp(Buffer.from(corridorSVG(views.get(asset.id)))).resize({width:1024}).png().toBuffer();
    files[asset.source]=`data:image/png;base64,${png.toString('base64')}`;
  }
  await mkdir(directory,{recursive:true});
  await writeFile(`${directory}/quiet-vault.experience.json`,JSON.stringify({format:'scene-studio-experience-backup',design,files}));
}
