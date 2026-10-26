// Test reel facultatif. Il peut entrainer une petite facturation OpenAI.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../backend/storage.js';
import { createAiService } from '../backend/ai.js';
if(!process.argv.includes('--confirm-cost'))throw new Error('Ce test est payant : ajoute --confirm-cost pour le lancer.');
try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY est absent du serveur.');
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'valen-test-ia-'));
const store=createStore({dataDir});
try{
 const ai=createAiService({store,apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-4.1-mini',dailyLimit:1,maxOutputTokens:2000});
 const result=await ai.generate({request_id:randomUUID(),kind:'vocabulary',mode:'words',text:'reliable',level:'B1',count:1});
 process.stdout.write(`API OpenAI : reponse valide, sauvegarde CSV reussie (${result.added} ajout). Le carnet principal n'a pas ete modifie.\n`);
}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
finally{await store.close();await fs.rm(dataDir,{recursive:true,force:true});}
