import { optimizerAvailable, optimizeModel } from '/home/user/ClaudePower/skyfall/tools/assets/optimize.mjs';
import fs from 'fs';
console.log('avail', await optimizerAvailable());
for (const id of fs.readdirSync('/tmp/claude-0/-home-user-ClaudePower/5a017925-4e3e-5120-b965-a0c52504be18/scratchpad/fk/out').filter(f=>!f.endsWith('.glb'))) {
  fs.copyFileSync('/tmp/claude-0/-home-user-ClaudePower/5a017925-4e3e-5120-b965-a0c52504be18/scratchpad/fk/out/'+id, '/tmp/claude-0/-home-user-ClaudePower/5a017925-4e3e-5120-b965-a0c52504be18/scratchpad/fk/out/'+id+'.glb');
  const n = await optimizeModel('/tmp/claude-0/-home-user-ClaudePower/5a017925-4e3e-5120-b965-a0c52504be18/scratchpad/fk/out/'+id+'.glb', 'public/assets/weapons/fk-'+id+'.glb', {});
  console.log(id, n);
}
