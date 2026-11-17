import {useEffect, useMemo, useRef, useState} from 'react';
import {ReactFlowProvider} from '@xyflow/react';
import {Workspace} from './App';
import {isCurrentSample, liveFixture, requestLive, sampleDiagnostic, type LiveSnapshot, type SelectorName} from './live';
import type {LayoutStore} from './storage';

const memoryOnly: LayoutStore = {
  async load() { return null; },
  async save() {},
  async last() { return null; },
  async remember() {},
};
const selectorLabels: Record<SelectorName, string> = {
  thread: '对话线程', message: '单条消息', user: '用户角色', assistant: '助手角色',
  userBody: '用户正文', assistantBody: '助手正文',
};
const keys = Object.keys(selectorLabels) as SelectorName[];
const errors: Record<string, string> = {
  UNSUPPORTED_ROUTE: '仅支持 ChatGPT 普通已保存会话。请打开对话后重新打开地图。',
  THREAD_NOT_UNIQUE: '未找到唯一可采样的对话线程。请刷新会话后重试。',
  MESSAGE_CONTAINER_AMBIGUOUS: '消息容器有重叠。请刷新会话后重试，或使用手动调试配置。',
  MESSAGE_OUTSIDE_CONTAINER: '部分消息标识出现在预期容器外。请复制验收诊断。',
  AUTO_PROFILE_MISMATCH: '页面结构与自动识别规则不匹配。请复制验收诊断，或使用手动调试配置。',
  NO_MESSAGES: '未找到匹配的已挂载消息。请等待会话加载后重试。',
  PROFILE_REQUIRED: '请先确认当前会话的采样配置。',
  INVALID_PROFILE: '采样配置无效。每项应使用一条具体选择器，避免逗号或全页选择器。',
  DOCUMENT_HIDDEN: '请回到当前聊天标签页再采样。',
  MESSAGE_LIMIT: '消息数量超过单次上限（200 条）。',
  STOPPED: '采集已停止。重新打开地图后可手动开始。',
  BODY_NOT_UNIQUE: '部分消息正文无法唯一识别。',
  ROLE_NOT_CONFIRMED: '发现无法确认角色的消息。',
  UNRESOLVED_IDENTITY: '发现缺失、重复或冲突的消息标识。',
  CONTENT_UNREADABLE: '部分消息正文无法读取。',
  CONTENT_TRUNCATED: '部分正文已达到采样上限并截断。',
  WORK_LIMIT: '页面结构过大，已达到采样工作上限。',
  TIME_LIMIT: '采样超时。请等待页面加载后重试。',
  MAP_CLOSED: '请从 ChatGPT 会话页面右下角打开会话地图。',
  TAB_UNAVAILABLE: '当前标签页无法连接采集器。请刷新网页后重新打开地图。',
  CONTEXT_CHANGED: '会话已切换，请从当前页面重新打开地图。',
};
function describe(code = 'SAMPLING_ERROR') {
  return errors[code] ?? `当前采样不可用（${code}）。`;
}

function captureNotice(pathname: string, captured: LiveSnapshot, watching: boolean) {
  if (captured.status === 'blocked') return describe(captured.issues[0]?.code);
  if (!isCurrentSample(pathname, captured)) return describe('CONTEXT_CHANGED');
  if (captured.status === 'partial') return '采样不完整。请查看采样问题。';
  return watching ? '正在跟踪当前会话更新。' : '当前已挂载消息已采样。';
}

export function LiveApp() {
  const [pathname, setPathname] = useState('');
  const [snapshot, setSnapshot] = useState<LiveSnapshot>();
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [watching, setWatching] = useState(false);
  const revision = useRef(0);
  const generation = useRef(0);
  const [notice, setNotice] = useState('正在检查当前会话…');
  const [manual, setManual] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [diagnostic, setDiagnostic] = useState('');
  const [diagnosticError, setDiagnosticError] = useState<string>();
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [selectors, setSelectors] = useState<Partial<Record<SelectorName, string>>>({});
  const fixture = useMemo(() => liveFixture(pathname, snapshot), [pathname, snapshot]);
  const canSample = !manual || (confirmed && keys.every(key => selectors[key]?.trim()));
  const issueCodes = [...new Set(snapshot?.issues.map(issue => issue.code))]
    .filter(code => snapshot?.status !== 'blocked' || code !== snapshot.issues[0]?.code);
  useEffect(() => {
    let cancelled = false;
    void requestLive({action: 'context'}).then(result => {
      if (cancelled) return;
      if (!result.ok || !result.pathname) {
        setDiagnosticError(result.code ?? 'TAB_UNAVAILABLE');
        setNotice(describe(result.code));
        return;
      }
      setPathname(result.pathname);
      setStopped(result.stopped === true);
      setNotice(result.stopped ? describe('STOPPED') : '等待手动采样。仅采集当前已挂载的消息。');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!snapshot) {
      setDiagnostic(diagnosticError ? JSON.stringify({schema: 1, status: 'blocked', issues: [diagnosticError]}, null, 2) : '');
    } else {
      void sampleDiagnostic(snapshot).then(value => { if (!cancelled) setDiagnostic(value); });
    }
    return () => { cancelled = true; };
  }, [snapshot, diagnosticError]);

  useEffect(() => {
    if (!watching) return;
    const currentGeneration = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    async function poll() {
      const result = await requestLive({action: 'update', since: revision.current});
      if (cancelled || currentGeneration !== generation.current) return;
      if (!result.ok) {
        setSnapshot(undefined);
        setWatching(false);
        setDiagnosticError(result.code);
        setNotice(describe(result.code));
        return;
      }
      if (result.snapshot) {
        revision.current = result.revision ?? revision.current;
        setSnapshot(result.snapshot);
        setNotice(captureNotice(pathname, result.snapshot, !!result.watching));
      }
      if (result.watching) timer = setTimeout(poll, 650);
      else {
        setWatching(false);
        if (result.snapshot?.status !== 'blocked') setNotice('跟踪已结束。可再次采样或继续跟踪。');
      }
    }
    timer = setTimeout(poll, 650);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pathname, watching]);

  async function sample(action: 'sample' | 'watch') {
    if (busy || stopped || watching || !canSample || !pathname) return;
    setDiagnosticError(undefined);
    setBusy(true);
    setNotice('正在采样当前会话…');
    try {
      const fields = Object.fromEntries(keys.map(key => [key, selectors[key]?.trim() ?? ''])) as Record<SelectorName, string>;
      const result = await requestLive({action, pathname, authorized: true, profile: manual ? {
        ...fields, pathname, confirmed: true, evidence: 'Current page selectors confirmed by the map user',
      } : undefined});
      const captured = result.snapshot;
      if (!result.ok || !captured) {
        setSnapshot(undefined);
        setDiagnosticError(result.code ?? 'SAMPLING_ERROR');
        setNotice(describe(result.code));
        return;
      }
      setSnapshot(captured);
      revision.current = result.revision ?? 0;
      setWatching(result.watching === true);
      setNotice(captureNotice(pathname, captured, !!result.watching));
    } finally {
      setBusy(false);
    }
  }

  async function reset(action: 'clear' | 'stop') {
    generation.current++;
    setWatching(false);
    setSnapshot(undefined);
    setDiagnostic('');
    setDiagnosticError(undefined);
    setWorkspaceVersion(version => version + 1);
    if (action === 'stop') setStopped(true);
    setBusy(true);
    const result = await requestLive({action});
    if (action === 'stop') setNotice(result.ok ? describe('STOPPED') : describe(result.code));
    else setNotice(result.ok ? '已清除当前会话采样。' : describe(result.code));
    setBusy(false);
  }

  return <ReactFlowProvider key={`${pathname}:${workspaceVersion}`}><Workspace fixture={fixture} store={memoryOnly} liveControls={
    <section className="live-controls" aria-label="会话采样">
      <h2>当前会话采样</h2>
      <p role="status">{notice}</p>
      {pathname && <>
      <p>点击采样即授权读取此会话已挂载的消息。跟踪更新最长 60 秒。</p>
      <div className="tools">
        <button disabled={busy || stopped || watching || !canSample}
          onClick={() => void sample('sample')}>采样当前会话</button>
        <button disabled={busy || stopped || watching || !canSample}
          onClick={() => void sample('watch')}>跟踪更新</button>
        <button disabled={busy || stopped} onClick={() => void reset('stop')}>停止采集</button>
        <button disabled={busy || !snapshot} onClick={() => void reset('clear')}>清除数据</button>
      </div>
      <details>
        <summary>手动调试配置</summary>
        <label className="confirm-sample"><input type="checkbox" checked={manual} disabled={busy || stopped || watching}
          onChange={event => setManual(event.target.checked)}/>使用手动配置</label>
        {manual && <><p>角色规则匹配消息容器本身，正文规则匹配其唯一子容器。</p>
        {keys.map(key => <label key={key}>{selectorLabels[key]}<input type="text" maxLength={160}
          value={selectors[key] ?? ''} disabled={busy || stopped || watching} onChange={event => {
            setSelectors(current => ({...current, [key]: event.target.value}));
            setConfirmed(false);
          }}/></label>)}
        <label className="confirm-sample"><input type="checkbox" checked={confirmed} disabled={busy || stopped || watching}
          onChange={event => setConfirmed(event.target.checked)}/>已核对配置并授权读取此会话</label></>}
      </details>
      </>}
      {!!issueCodes.length && <details>
        <summary>采样问题（{issueCodes.length} 类）</summary>
        <ul>{issueCodes.map(code => <li key={code}>{describe(code)}</li>)}</ul>
      </details>}
      {diagnostic && <details open={snapshot?.status === 'blocked' ? true : undefined}>
        <summary>验收诊断（脱敏）</summary>
        <textarea aria-label="验收诊断" readOnly rows={7} value={diagnostic} onFocus={event => event.target.select()}
          style={{width: '100%', marginTop: 6, font: '11px monospace'}}/>
      </details>}
    </section>
  }/></ReactFlowProvider>;
}
