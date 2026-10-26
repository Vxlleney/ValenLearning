import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const walk=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap((item)=>item.isDirectory()?walk(path.join(dir,item.name)):[path.join(dir,item.name)]);
let failed=false;
for(const file of ['backend','shared','scripts'].flatMap((dir)=>walk(path.join(root,dir))).filter((file)=>/\.(js|mjs)$/.test(file))){
 const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
 if(result.status!==0)failed=true;
}
if(failed)process.exit(1);
process.stdout.write('Syntaxe JavaScript du serveur : OK.\n');
// La commande build verifie aussi les imports, le JSX et les styles Tailwind.
const npm=process.platform==='win32'?'npm.cmd':'npm';
const result=spawnSync(npm,['run','build'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
if (result.error) console.error(result.error.message);
process.exitCode=result.status ?? 1;
