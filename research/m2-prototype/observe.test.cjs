const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'observe.js'), 'utf8');

function harness() {
  const timers = new Map();
  const listeners = new Map();
  const thread = {isConnected: true, contains: node => node === thread};
  const document = {
    documentElement: {}, visibilityState: 'visible',
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
  let clock = 0, timerId = 0, captures = 0, current = true;
  let mutate, active;
  const context = vm.createContext({document, M2OfflineParser: {ID_ATTRIBUTES: []},
    MutationObserver: class {
      constructor(callback) { mutate = callback; }
      observe() { active = true; }
      disconnect() { active = false; }
    },
    setTimeout(fn, delay) { timers.set(++timerId, {fn, time: clock + delay}); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context);
  const scope = {thread, selector: '.thread'};
  const initial = {scope, snapshot: 'first'};
  const state = context.M2Observe.start(initial, () => ({scope, snapshot: 'change:' + ++captures}), () => current);
  return {state, thread, document, active: () => active, listeners, captures: () => captures,
    leave() { current = false; },
    change(target = thread) { mutate([{target}]); },
    tick(ms) {
      const end = clock + ms;
      for (;;) {
        const event = [...timers].sort((a, b) => a[1].time - b[1].time)[0];
        if (!event || event[1].time > end) break;
        timers.delete(event[0]);
        clock = event[1].time;
        event[1].fn();
      }
      clock = end;
    },
  };
}

test('observes coalesced relevant changes and returns only newer revisions', () => {
  const h = harness();
  h.change({contains: () => false});
  h.tick(250);
  assert.equal(h.captures(), 0);
  h.change(); h.change();
  h.tick(250);
  assert.equal(h.captures(), 1);
  assert.equal(h.state.read(1).snapshot, 'change:1');
  assert.equal(h.state.read(2).snapshot, undefined);
  const otherThread = {nodeType: 1, contains: () => false, closest: selector => selector === '.thread'};
  h.change(otherThread);
  h.tick(250);
  assert.equal(h.captures(), 2);
});

test('pauses in a hidden tab and drops queued work and bodies when the route changes', () => {
  const h = harness();
  h.change();
  h.document.visibilityState = 'hidden';
  h.tick(250);
  assert.equal(h.captures(), 0);
  h.document.visibilityState = 'visible';
  h.listeners.get('visibilitychange')();
  h.leave();
  h.tick(250);
  assert.equal(h.active(), false);
  assert.equal(h.state.read(0).snapshot, undefined);
});

test('expires on either observation budget and stops pending work after disposal', () => {
  const silent = harness();
  silent.tick(60_000);
  assert.equal(silent.active(), false);
  assert.equal(silent.state.read(0).snapshot, 'first');
  const busy = harness();
  for (let i = 0; i < 70; i++) { busy.change(); busy.tick(250); }
  assert.equal(busy.active(), false);
  assert.equal(busy.captures(), 59);
  const cleared = harness();
  cleared.change();
  cleared.state.dispose();
  cleared.tick(250);
  assert.equal(cleared.captures(), 0);
  assert.equal(cleared.state.read(0).snapshot, undefined);
});
