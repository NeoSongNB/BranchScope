import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const inventory=[];const notices=[];
for(const [location,pkg] of Object.entries(lock.packages)){
  if(!location)continue;
  let files=[];try{files=await readdir(location);}catch{}
  const licenses=files.filter(f=>/^(license|licence|copying|notice)(\.|$)/i.test(f));
  inventory.push({location,version:pkg.version,license:pkg.license??'UNDECLARED',dev:!!pkg.dev,licenseFiles:licenses});
  for(const file of licenses){try{notices.push(`\n=== ${location} ${pkg.version} / ${file} ===\n${await readFile(path.join(location,file),'utf8')}`);}catch{}}
}
await mkdir('public/licenses',{recursive:true});
await writeFile('public/licenses/dependency-inventory.json',JSON.stringify(inventory,null,2));
await writeFile('public/licenses/THIRD-PARTY-NOTICES.txt',notices.join('\n'));
console.log(JSON.stringify({packages:inventory.length,undeclared:inventory.filter(x=>x.license==='UNDECLARED').map(x=>x.location),licenseTypes:[...new Set(inventory.map(x=>x.license))]},null,2));
