// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {it,expect} from 'vitest';
it('MV3 grants no API permissions and injects only on chatgpt.com',()=>{
  const m=JSON.parse(readFileSync('public/manifest.json','utf8'));
  expect(m.manifest_version).toBe(3);expect(m.permissions??[]).toEqual([]);expect(m.host_permissions??[]).toEqual([]);
  expect(m.content_scripts.flatMap((x:any)=>x.matches)).toEqual(['https://chatgpt.com/*']);
  expect(m.web_accessible_resources.flatMap((x:any)=>x.matches)).toEqual(['https://chatgpt.com/*']);
  expect(m.content_security_policy.extension_pages).toContain("connect-src 'none'");
});
it('product source has no network/credential/write API or HTML injection',()=>{
  const files=[...readdirSync('src').map(x=>'src/'+x),...readdirSync('public').filter(x=>x.endsWith('.js')).map(x=>'public/'+x),
    '../research/m2-prototype/parser.js','../research/m2-prototype/probe.js','../research/m2-prototype/observe.js'];
  const code=files.map(f=>readFileSync(f,'utf8')).join('\n');
  expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|document\.cookie|\/backend-api\/|\/api\/auth\/|execCommand|dangerouslySetInnerHTML|\.innerHTML\s*=/);
});
