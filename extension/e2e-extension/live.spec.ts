import {chromium, expect, test, type BrowserContext, type Frame, type Page} from '@playwright/test';
import {resolve} from 'node:path';

const session = '00000000-0000-0000-0000-000000000001';
const route = '/c/' + session;
const site = 'https://chatgpt.com';
const profile = {
  对话线程: 'main', 单条消息: 'article', 用户角色: '[data-role="user"]',
  助手角色: '[data-role="assistant"]', 用户正文: '.copy', 助手正文: '.copy',
};
const fixture = `<!doctype html><meta charset="utf-8"><title>Local extension fixture</title>
  <style>body{margin:32px;font:16px system-ui}main{max-width:540px}article{padding:16px;background:#eef3f7;margin:12px 0}</style>
  <h1>本地会话测试页</h1><aside><article data-role="user" data-dil-message-id="SIDEBAR-ONLY"><p class="copy">侧栏</p></article></aside>
  <main><div style="display:contents">
    <article data-role="user" data-dil-message-id="demo-u1"><div class="copy">给出一个树的例子<button>复制</button></div></article>
    <article data-role="assistant"><div data-chatgpt-search-message-ids="demo-a1 demo-a1" class="copy">一棵树可以有多个叶子。<span hidden>隐藏旧正文</span></div></article>
  </div><form><p>输入框提示</p><textarea></textarea></form>
  <div style="display:none"><article data-role="assistant" data-dil-message-id="OLD-ONLY"><p class="copy">旧线程</p></article></div></main>`;

async function fixtureBrowser(html = fixture) {
  const dist = resolve(process.env.BRANCHSCOPE_EXTENSION_DIR ?? 'dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, chromiumSandbox: true, viewport: {width: 1440, height: 1000},
    args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  });
  await context.route('**/*', async request => {
    if (request.request().url().startsWith(site + '/')) {
      await request.fulfill({contentType: 'text/html', body: html});
    } else if (request.request().url().startsWith('chrome-extension://')) {
      await request.continue();
    } else {
      await request.abort();
    }
  });
  return context;
}

async function launcher(context: BrowserContext, page: Page, name: string) {
  const cdp = await context.newCDPSession(page);
  try {
    async function findButton() {
      const {nodes} = await cdp.send('Accessibility.getFullAXTree');
      return nodes.find(node => node.name?.value === name && node.role?.value === 'button')?.backendDOMNodeId;
    }
    await expect.poll(findButton).toBeDefined();
    const {model} = await cdp.send('DOM.getBoxModel', {backendNodeId: await findButton()});
    const [left, top, right, , , bottom] = model.content;
    await page.mouse.click((left + right) / 2, (top + bottom) / 2);
  } finally {
    await cdp.detach();
  }
}

async function openLive(context: BrowserContext, page: Page) {
  const frame = page.waitForEvent('framenavigated', {
    predicate: candidate => candidate.url().includes('/index.html?mode=live&panel='),
  });
  await launcher(context, page, '会话地图');
  return await frame;
}

async function setup(frame: Frame, fields = profile) {
  const mode = frame.getByLabel('使用手动配置');
  if (!(await mode.isVisible())) await frame.getByText('手动调试配置', {exact: true}).click();
  await mode.check();
  await expect(frame.getByRole('button', {name: '采样当前会话'})).toBeDisabled();
  for (const [label, value] of Object.entries(fields)) await frame.getByLabel(label, {exact: true}).fill(value);
  await frame.getByLabel('已核对配置并授权读取此会话').check();
}

test('loaded MV3 samples only on request, renders nodes, resamples, and clears on route change', async () => {
  const context = await fixtureBrowser();
  try {
    const page = context.pages()[0];
    await page.goto(site + route);
    const frame = await openLive(context, page);
    const sample = frame.getByRole('button', {name: '采样当前会话'});
    await expect(frame.getByText('等待手动采样。仅采集当前已挂载的消息。')).toBeVisible();
    await expect(sample).toBeEnabled();
    await expect(frame.locator('.react-flow__node')).toHaveCount(0);
    await setup(frame);
    await sample.click();
    await expect(frame.locator('.react-flow__node')).toHaveCount(2);
    await expect(frame.locator('.react-flow__node').locator('.card-meta span')).toHaveText(['demo-u1', 'demo-a1']);
    await expect(frame.locator('.react-flow__edge')).toHaveCount(0);
    await expect(frame.getByText('关系未知', {exact: true})).toHaveCount(2);
    await frame.getByLabel('搜索已采样的正文').fill('多个叶子');
    await frame.getByRole('navigation', {name: '搜索结果'}).getByRole('button').click();
    await expect(frame.getByLabel('消息详情')).toContainText('一棵树可以有多个叶子。');
    await expect(frame.getByLabel('消息详情')).not.toContainText('隐藏旧正文');
    await page.evaluate(() => {
      const article = document.createElement('article');
      article.setAttribute('data-role', 'assistant');
      article.setAttribute('data-dil-message-id', 'demo-a2');
      const copy = document.createElement('p');
      copy.className = 'copy';
      copy.textContent = '另一条回答。';
      article.append(copy);
      document.querySelector('main')!.append(article);
    });
    await expect(frame.locator('.react-flow__node')).toHaveCount(2);
    await sample.click();
    await expect(frame.locator('.react-flow__node')).toHaveCount(3);
    await expect(frame.locator('.react-flow__node[data-id="demo-a1"]')).toHaveCount(1);
    await frame.getByRole('button', {name: '适配视图'}).click();
    await page.screenshot({path: 'test-results/m2-local-extension.png'});
    await page.evaluate(() => history.pushState({}, '', '/c/00000000-0000-0000-0000-000000000002'));
    await expect.poll(() => frame.isDetached()).toBe(true);
    const otherFrame = await openLive(context, page);
    await expect(otherFrame.locator('.react-flow__node')).toHaveCount(0);
    await expect(otherFrame.getByRole('button', {name: '采样当前会话'})).toBeEnabled();
  } finally {
    await context.close();
  }
});

test('clear and stop discard bodies; renewed authorization after refresh recovers the same IDs', async () => {
  const context = await fixtureBrowser();
  try {
    const page = context.pages()[0];
    await page.goto(site + route);
    const frame = await openLive(context, page);
    const sample = frame.getByRole('button', {name: '采样当前会话'});
    await setup(frame);
    await sample.click();
    await expect(frame.locator('.react-flow__node')).toHaveCount(2);
    const originalIds = await frame.locator('.react-flow__node .card-meta span').allTextContents();
    await frame.getByRole('button', {name: '清除数据'}).click();
    await expect(frame.getByText('已清除当前会话采样。')).toBeVisible();
    await expect(frame.locator('.react-flow__node')).toHaveCount(0);
    await sample.click();
    await expect(frame.locator('.react-flow__node')).toHaveCount(2);
    await frame.getByRole('button', {name: '停止采集'}).click();
    await expect(frame.getByText('采集已停止。重新打开地图后可手动开始。')).toBeVisible();
    await expect(frame.locator('.react-flow__node')).toHaveCount(0);
    await expect(sample).toBeDisabled();
    await page.reload();
    const refreshed = await openLive(context, page);
    await expect(refreshed.locator('.react-flow__node')).toHaveCount(0);
    await expect(refreshed.getByRole('button', {name: '采样当前会话'})).toBeEnabled();
    await setup(refreshed);
    await refreshed.getByRole('button', {name: '采样当前会话'}).click();
    await expect(refreshed.locator('.react-flow__node .card-meta span')).toHaveText(originalIds);
    await launcher(context, page, '合成对话地图');
    await expect.poll(() => refreshed.isDetached()).toBe(true);
    await expect.poll(() => page.frames().some(child => child.url().startsWith('chrome-extension://') &&
      child.url().endsWith('/index.html'))).toBe(true);
    const synthetic = page.frames().find(child => child.url().endsWith('/index.html'))!;
    await expect(synthetic.getByLabel('合成场景')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('default profile uses one click, returns redacted diagnostics and follows authorized mutations', async () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const assistantId = '22222222-2222-2222-2222-222222222222';
  const context = await fixtureBrowser(`<!doctype html><meta charset="utf-8">
    <main data-thread-find-target="conversation">
      <article data-conversation-role="user" data-chatgpt-search-message-ids="${userId}">
        <div data-user-message-bubble="true">sample private body</div>
      </article>
      <article data-conversation-role="assistant" data-dil-source-message-id="${assistantId}">
        <div class="markdown">sample response</div>
      </article>
    </main>`);
  try {
    const page = context.pages()[0];
    await page.goto(site + route);
    const frame = await openLive(context, page);
    await expect(frame.locator('.react-flow__node')).toHaveCount(0);
    const unauthorized = await frame.evaluate(pathname => {
      const api = (window as typeof window & {chrome: {runtime: {sendMessage(value: unknown): Promise<unknown>}}}).chrome;
      const panel = new URLSearchParams(location.search).get('panel');
      return api.runtime.sendMessage({channel: 'conversation-map-live-ui', panel, action: 'watch', pathname});
    }, route);
    expect(unauthorized).toEqual({ok: false, code: 'PROFILE_REQUIRED'});
    await frame.getByRole('button', {name: '采样当前会话'}).click();
    await expect(frame.locator('.react-flow__node .card-meta span')).toHaveText([userId, assistantId]);
    await expect(frame.locator('.react-flow__edge')).toHaveCount(0);
    await frame.getByText('验收诊断（脱敏）', {exact: true}).click();
    const diagnostics = frame.getByLabel('验收诊断', {exact: true});
    await expect(diagnostics).toHaveValue(/"idSetFingerprint": "[a-f0-9]{24}"/);
    const record = await diagnostics.inputValue();
    expect(JSON.parse(record)).toMatchObject({profile: 'candidate-auto', identified: 2, readable: 2, issues: []});
    for (const privateValue of [route, userId, assistantId, 'sample private body', 'sample response']) {
      expect(record).not.toContain(privateValue);
    }

    await frame.getByRole('button', {name: '跟踪更新'}).click();
    await expect(frame.getByText('正在跟踪当前会话更新。')).toBeVisible();
    await page.locator('.markdown').evaluate(node => { node.textContent = 'updated response'; });
    await expect(frame.locator('.react-flow__node').filter({hasText: 'updated response'})).toHaveCount(1);
    await expect(frame.locator('.react-flow__node')).toHaveCount(2);
    await frame.getByRole('button', {name: '清除数据'}).click();
    await expect(frame.getByText('已清除当前会话采样。')).toBeVisible();
    await page.locator('.markdown').evaluate(node => { node.textContent = 'after clear'; });
    await expect(frame.locator('.react-flow__node')).toHaveCount(0);

    await page.locator('.markdown').evaluate(node => node.after(node.cloneNode(true)));
    await frame.getByRole('button', {name: '采样当前会话'}).click();
    await expect(frame.getByText(/页面结构与自动识别规则不匹配/)).toBeVisible();
    await expect(diagnostics).toHaveValue(/BODY_NOT_UNIQUE/);
    await expect(frame.locator('.react-flow__node')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('unsupported routes, ambiguous threads and bodies, and message limits show explicit states', async () => {
  const context = await fixtureBrowser();
  try {
    const page = context.pages()[0];
    await page.goto(site + '/');
    const unsupported = await openLive(context, page);
    await expect(unsupported.getByText(/仅支持 ChatGPT 普通已保存会话/)).toBeVisible();
    await expect(unsupported.locator('.react-flow__node')).toHaveCount(0);
    await page.goto(site + route);
    const frame = await openLive(context, page);
    await setup(frame, {...profile, 对话线程: 'body > :is(aside)'});
    await page.evaluate(() => document.querySelector('aside')!.after(document.querySelector('aside')!.cloneNode(true)));
    // Aside is excluded even when a selector explicitly names it.
    await frame.getByRole('button', {name: '采样当前会话'}).click();
    await expect(frame.getByText(/未找到唯一可采样的对话线程/)).toBeVisible();
    await frame.getByLabel('对话线程', {exact: true}).fill('main');
    await frame.getByLabel('已核对配置并授权读取此会话').check();
    await page.evaluate(() => {
      const duplicate = document.querySelector('main')!.cloneNode(true) as HTMLElement;
      duplicate.id = 'duplicate-thread';
      document.querySelector('main')!.after(duplicate);
    });
    await frame.getByRole('button', {name: '采样当前会话'}).click();
    await expect(frame.getByText(/未找到唯一可采样的对话线程/)).toBeVisible();
    await expect(frame.locator('.react-flow__node')).toHaveCount(0);
    await page.evaluate(() => {
      document.getElementById('duplicate-thread')!.remove();
      const alternate = document.createElement('p');
      alternate.className = 'copy';
      alternate.textContent = '歧义正文';
      document.querySelector('article[data-role=assistant]')!.append(alternate);
    });
    await frame.getByRole('button', {name: '采样当前会话'}).click();
    await expect(frame.getByText('采样不完整。请查看采样问题。')).toBeVisible();
    await expect(frame.locator('.react-flow__node')).toHaveCount(2);
    await expect(frame.locator('.react-flow__node[data-id="demo-a1"]')).toContainText('内容不可读取');
    await page.evaluate(() => {
      const added = document.createDocumentFragment();
      for (let i = 0; i < 199; i++) added.append(document.createElement('article'));
      document.querySelector('main')!.append(added);
    });
    await frame.getByRole('button', {name: '采样当前会话'}).click();
    await expect(frame.getByText(/消息数量超过单次上限/)).toBeVisible();
    await expect(frame.locator('.react-flow__node')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('the field check reloads the authorized conversation once and reopens a redacted result', async () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const context = await fixtureBrowser(`<!doctype html><meta charset="utf-8">
    <main data-thread-find-target="conversation">
      <article data-conversation-role="user" data-chatgpt-search-message-ids="${id}">
        <div data-user-message-bubble="true">fixture body for reload check</div>
      </article>
    </main>`);
  try {
    const page = context.pages()[0];
    await page.goto(site + route);
    let reloads = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) reloads++; });
    const frame = await openLive(context, page);
    const reopened = page.waitForEvent('framenavigated', {
      predicate: item => item !== frame && item.url().includes('/index.html?mode=live&panel='),
    });
    await frame.getByRole('button', {name: '运行现场验收'}).click();
    const next = await reopened;
    const diagnostic = next.getByLabel('验收诊断', {exact: true});
    await expect(diagnostic).toHaveValue(/same-ids-in-same-order/);
    const value = await diagnostic.inputValue();
    expect(reloads).toBe(1);
    expect(page.url()).toBe(site + route);
    expect(JSON.parse(value)).toMatchObject({
      t10: 'sampled-compare-visible-messages', t11: 'same-ids-in-same-order',
      t13: 'dedicated-boundary-cases-not-exercised', before: {identified: 1}, after: {identified: 1},
    });
    for (const privateValue of [route, id, 'fixture body for reload check', 'orderedIds', 'fingerprint']) {
      expect(value).not.toContain(privateValue);
    }
    await expect(next.locator('.react-flow__node')).toHaveCount(0);
    await next.getByRole('button', {name: '清除数据'}).click();
    await expect(diagnostic).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a blocked field baseline reports the reason without reloading the page', async () => {
  const context = await fixtureBrowser();
  try {
    const page = context.pages()[0];
    await page.goto(site + route);
    const frame = await openLive(context, page);
    await frame.getByRole('button', {name: '运行现场验收'}).click();
    const diagnostic = frame.getByLabel('验收诊断', {exact: true});
    await expect(diagnostic).toHaveValue(/BASELINE_NOT_COMPARABLE/);
    expect(JSON.parse(await diagnostic.inputValue())).toMatchObject({
      t11: 'inconclusive', before: {status: 'blocked', issues: ['THREAD_NOT_UNIQUE']},
    });
    expect(await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('navigate');
  } finally {
    await context.close();
  }
});
