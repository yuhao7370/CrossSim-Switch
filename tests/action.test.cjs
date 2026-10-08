const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const bash = process.env.CROSSSIM_TEST_BASH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/bash.exe' : '/bin/bash');
const posix = p => p.replace(/\\/g, '/').replace(/^([A-Z]):/i, (_, drive) => '/' + drive.toLowerCase());
const action = posix(path.resolve('module/action.sh'));
fs.mkdirSync(path.resolve('build'), {recursive: true});
const root = fs.mkdtempSync(path.join(path.resolve('build'), 'action-test-'));
let runId = 0;

function run({locale = 'zh-CN', product = 'zh-CN', output = 'SIM 1 · Operator\nCross-SIM switch: Off', code = 0} = {}) {
  const trace = path.join(root, `${++runId}.txt`);
  const result = spawnSync(bash, ['-c', `
function /system/bin/settings { printf '%s\\n' "$CROSSSIM_TEST_LOCALE"; }
function /system/bin/getprop { printf '%s\\n' "$CROSSSIM_TEST_PRODUCT"; }
function /system/bin/sh {
  printf '%s:%s\\n' "$2" "$3" >> "$CROSSSIM_TEST_TRACE"
  case "$1" in */control.sh) ;; *) return 90 ;; esac
  [ "$2" = summary ] && [ "$#" = 3 ] || return 91
  printf '%s\\n' "$CROSSSIM_TEST_OUTPUT"
  return "$CROSSSIM_TEST_CODE"
}
. "$0"
`, action], {encoding: 'utf8', env: {...process.env,
    CROSSSIM_TEST_LOCALE: locale, CROSSSIM_TEST_PRODUCT: product,
    CROSSSIM_TEST_OUTPUT: output, CROSSSIM_TEST_CODE: String(code), CROSSSIM_TEST_TRACE: posix(trace)
  }});
  return {...result, calls: fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n') : []};
}

test('Action reads the summary exactly once and never requests a SIM toggle', () => {
  const r = run({locale: 'zh-CN,en-US'});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, ['summary:en']);
  assert.equal(r.stdout, 'Cross-SIM\n\nSIM 1 · Operator\nCross-SIM switch: Off\n');
});

test('Action preserves system carrier names in its English summary', () => {
  const r = run({locale: 'en-US,zh-CN', output: 'SIM 2 · 台湾大哥大\nCross-SIM switch: On'});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, ['summary:en']);
  assert.match(r.stdout, /台湾大哥大\nCross-SIM switch: On/);
});

test('Action stays in English with missing or non-English system locales', () => {
  for (const [locale, product] of [['null', 'zh-CN'], ['', 'en-US'], ['zh-CN', 'zh-CN']]) {
    const r = run({locale, product});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.calls, ['summary:en']);
    assert.match(r.stdout, /Cross-SIM switch: Off/);
  }
});

test('Action reports failure without exposing JSON or claiming a successful change', () => {
  for (const locale of ['zh-CN', 'en-US']) {
    const r = run({locale, code: 17, output: 'CROSSSIM_RESULT:{"ok":false,"error":"test failure"}'});
    assert.equal(r.status, 17);
    assert.equal(r.calls.length, 1);
    assert.equal(r.stdout, 'Cross-SIM\n\nStatus unavailable. Try again shortly.\n');
  }
});
