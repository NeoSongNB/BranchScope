import {test,expect} from '@playwright/test';
test('synthetic map: search, drag, viewport and reload persistence',async({page})=>{
  await page.goto('http://127.0.0.1:4173');
  await page.getByLabel('合成场景').selectOption('answers');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.getByLabel('搜索已加载的样本文本').fill('稳定');
  await page.getByRole('navigation',{name:'搜索结果'}).getByRole('button').click();
  await expect(page.getByLabel('消息详情')).toContainText('a-alt');
  const node=page.locator('.react-flow__node[data-id="a-alt"]');const box=await node.boundingBox();
  if(!box)throw new Error('node not visible');
  await page.mouse.move(box.x+70,box.y+35);await page.mouse.down();await page.mouse.move(box.x+165,box.y+100,{steps:12});await page.mouse.up();
  await expect(page.getByRole('status')).toHaveText('布局已保存');
  await expect(node).toBeVisible();
  const transform=await node.evaluate(el=>getComputedStyle(el).transform);
  const viewport=await page.locator('.react-flow__viewport').getAttribute('style');
  await page.reload();await expect(page.getByLabel('合成场景')).toHaveValue('answers');
  await expect(page.locator('.react-flow__node[data-id="a-alt"]')).toHaveCSS('transform',transform);
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style',viewport!);
  await expect(page.getByLabel('消息详情')).toContainText('a-alt');
  await page.getByRole('button',{name:'追加测试节点'}).click();await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(page.locator('.react-flow__node[data-id="a-alt"]')).toHaveCSS('transform',transform);
  await page.screenshot({path:'test-results/m1-map.png',fullPage:true});
});
test('all malformed fixtures remain interactive and content is inert',async({page})=>{
  await page.goto('http://127.0.0.1:4173');
  for(const id of ['missing','cycle','duplicate','unordered','hidden','long']){
    await page.getByLabel('合成场景').selectOption(id);await expect(page.locator('.react-flow__node').first()).toBeVisible();
    if(id==='cycle')await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  }
  await page.getByLabel('搜索已加载的样本文本').fill('javascript');await page.getByRole('navigation',{name:'搜索结果'}).getByRole('button').click();
  await expect(page.locator('.message-body')).toContainText('<script>');await expect(page.locator('.message-body script,.message-body img,.message-body a')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/发送|编辑|重新生成/})).toHaveCount(0);
});
test('pan, zoom, direction and reopening preserve layout',async({page})=>{
  await page.goto('http://127.0.0.1:4173');
  await page.getByLabel('合成场景').selectOption('linear');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.getByRole('button',{name:'重排为横向'}).click();
  await page.getByRole('button',{name:'适配视图'}).click();
  const canvas=await page.getByTestId('canvas').boundingBox();if(!canvas)throw new Error('canvas unavailable');
  await page.mouse.move(canvas.x+canvas.width-30,canvas.y+canvas.height-80);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width-130,canvas.y+canvas.height-120,{steps:8});await page.mouse.up();
  await page.mouse.wheel(0,120);
  await expect(page.getByRole('status')).toHaveText('布局已保存');
  await page.waitForTimeout(300); // wheel end is debounced by React Flow
  const transform=await page.locator('.react-flow__viewport').getAttribute('style');
  await page.goto('about:blank');await page.goto('http://127.0.0.1:4173');
  await expect(page.getByRole('button',{name:'重排为纵向'})).toBeVisible();
  await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style',transform!);
});


test('search selection stays stable after another node was selected',async({page})=>{
  await page.goto('http://127.0.0.1:4173');
  await expect(page.locator('.react-flow__node')).toHaveCount(9);
  await page.locator('.react-flow__node[data-id="u1"]').click();
  await expect(page.locator('.detail-meta code')).toHaveText('u1');
  await page.getByLabel('搜索已加载的样本文本').fill('关系');
  await page.getByRole('navigation',{name:'搜索结果'}).getByRole('button',{name:/AI · a1 /}).click();
  const samples=await page.evaluate(async()=>{
    const values:{selection:string;viewport:string|null}[]=[];
    for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,25));values.push({selection:(document.querySelector('.detail-meta code')?.textContent??'none')+'|'+[...document.querySelectorAll('.react-flow__node.selected')].map(n=>n.getAttribute('data-id')).join(','),viewport:document.querySelector('.react-flow__viewport')?.getAttribute('style')??null});}
    return values;
  });
  console.log('selection samples',JSON.stringify([...new Set(samples.map(s=>s.selection))]));
  expect([...new Set(samples.map(s=>s.selection))]).toEqual(['a1|a1']);
  expect(new Set(samples.map(s=>s.viewport)).size).toBe(1);
  await page.getByRole('navigation',{name:'搜索结果'}).getByRole('button',{name:/AI · a2 /}).click();
  await expect(page.locator('.detail-meta code')).toHaveText('a2');
  await page.waitForTimeout(500);
  await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id','a2');
  await page.getByRole('button',{name:'适配视图'}).click();
  await page.locator('.react-flow__node[data-id="u1"]').click();
  await expect(page.locator('.detail-meta code')).toHaveText('u1');
});
