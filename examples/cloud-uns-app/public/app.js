const messages = {
  zh: {
    controlTitle: '设备采集', controlHelp: '通过应用服务端执行已授权的采集操作。重放保留同一请求标识。', controlRun: '执行或重放', controlNew: '新建操作',
    controlLoading: '正在读取控制权限…', controlReady: '已就绪，请确认后执行', controlBusy: '正在执行…', controlDone: '操作已完成', controlReplay: '已返回原操作结果',
    controlUnavailable: '控制不可用，请联系管理员检查应用配置和授权', controlUnknown: '操作结果尚未确认，请先核对设备；重放会使用原请求标识',
    title: '工单数据', create: '新增工单', orderNo: '工单号', amount: '金额（分）', save: '保存', records: '工单列表',
    refresh: '刷新列表', state: '状态', revision: '版本', theme: '切换主题', loading: '正在读取…', empty: '暂无工单',
    loaded: '已读取工单', saved: '已保存', replayed: '已返回原保存结果', readonly: '当前应用只有读取权限',
    writable: '当前应用可以读取并新增工单', noAccess: '当前应用没有数据访问权限', denied: '访问被拒绝，请联系管理员检查应用的数据授权',
    unknown: '保存结果尚未确认。请刷新列表核对；再次点击保存会使用相同请求标识。', failed: '请求失败', draft: '草稿',
  },
  en: {
    controlTitle: 'Device collection', controlHelp: 'Run an authorized collection through this App server. Replay keeps the same request identity.', controlRun: 'Execute or replay', controlNew: 'New operation',
    controlLoading: 'Loading control access…', controlReady: 'Ready. Confirm before executing.', controlBusy: 'Executing…', controlDone: 'Operation completed', controlReplay: 'Original operation result returned',
    controlUnavailable: 'Control unavailable. Ask an administrator to check App configuration and grants.', controlUnknown: 'Operation outcome is unconfirmed. Check the device first; replay preserves the original request identity.',
    title: 'Work orders', create: 'New work order', orderNo: 'Order number', amount: 'Amount (cents)', save: 'Save', records: 'Work orders',
    refresh: 'Refresh list', state: 'Status', revision: 'Revision', theme: 'Switch theme', loading: 'Loading…', empty: 'No work orders',
    loaded: 'Work orders loaded', saved: 'Saved', replayed: 'Original save result returned', readonly: 'This App has read access',
    writable: 'This App can read and create work orders', noAccess: 'This App has no data access', denied: 'Access denied. Ask an administrator to check App data grants.',
    unknown: 'Save outcome is unconfirmed. Refresh the list to check; saving again uses the same request identity.', failed: 'Request failed', draft: 'Draft',
  },
};
const $ = (selector) => document.querySelector(selector);
let language = localStorage.getItem('uns-orders-language') === 'en' ? 'en' : 'zh';
let canWrite = false;
let busy = false;
let controlState = 'controlLoading';
let controlError = '';
let controlStorageKey;
let controlBusy = false;
const text = (key) => messages[language][key];
function status(key, error = false, code = '') {
  $('#status').textContent = `${text(key)}${code ? ` (${code})` : ''}`;
  $('#status').dataset.error = String(error);
}
function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = text('title');
  $('#language').value = language;
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = text(element.dataset.i18n); });
  $('#write-state').textContent = text(canWrite ? 'writable' : 'readonly');
  $('#control-status').textContent = `${text(controlState)}${controlError ? ` (${controlError})` : ''}`;
}
async function request(path, options) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(), { status: response.status, code: result.code });
  return result;
}
function errorState(error) {
  if (error.status === 403 || error.status === 401) {
    canWrite = false;
    $('#records').replaceChildren();
    $('#save').disabled = true;
    $('#write-state').textContent = text('noAccess');
    status('denied', true, error.code);
  } else status(error.code === 'OUTCOME_UNKNOWN' ? 'unknown' : 'failed', true, error.code);
}
async function refresh() {
  $('#refresh').disabled = true;
  status('loading');
  try {
    const result = await request('/api/orders');
    canWrite = result.canWrite;
    $('#app-name').textContent = result.app;
    $('#records').replaceChildren();
    for (const item of result.items) {
      const row = document.createElement('tr');
      for (const value of [item.data.orderNo, item.data.amount, item.data.status === 'draft' ? text('draft') : item.data.status, item.revision]) {
        const cell = document.createElement('td'); cell.textContent = String(value ?? ''); row.append(cell);
      }
      $('#records').append(row);
    }
    status(result.items.length ? 'loaded' : 'empty');
    translate();
    $('#save').disabled = !canWrite || busy;
  } catch (error) { errorState(error); }
  finally { $('#refresh').disabled = false; }
}
$('#order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !canWrite) return;
  const form = new FormData(event.currentTarget);
  const input = { orderNo: String(form.get('orderNo')), amount: Number(form.get('amount')) };
  const fingerprint = JSON.stringify(input);
  let intent;
  try { intent = JSON.parse(localStorage.getItem('uns-orders-intent')); } catch { /* Start a new intent. */ }
  if (intent?.fingerprint !== fingerprint) {
    intent = { fingerprint, key: crypto.randomUUID() };
    localStorage.setItem('uns-orders-intent', JSON.stringify(intent));
  }
  busy = true;
  $('#save').disabled = true;
  try {
    const result = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, idempotencyKey: intent.key }) });
    await refresh();
    status(result.replayed ? 'replayed' : 'saved');
  } catch (error) { errorState(error); }
  finally { busy = false; $('#save').disabled = !canWrite; }
});
$('#refresh').addEventListener('click', refresh);
$('#language').addEventListener('change', (event) => {
  language = event.target.value;
  localStorage.setItem('uns-orders-language', language);
  translate();
  void refresh();
});
document.documentElement.dataset.theme = localStorage.getItem('uns-orders-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('#theme').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('uns-orders-theme', theme);
});
translate();
void refresh();

function controlStatus(key, code = '') {
  controlState = key; controlError = code;
  $('#control-status').textContent = `${text(key)}${code ? ` (${code})` : ''}`;
}
async function loadControl() {
  try {
    const info = await request('/api/device/telemetry');
    if (!info.canInvoke) throw new Error();
    controlStorageKey = `uns-control-intent:${location.host}:${info.operator}`;
    $('#control-run').disabled = false; $('#control-new').disabled = false;
    controlStatus('controlReady');
  } catch (error) { controlStatus('controlUnavailable', error.code); }
}
$('#control-run').addEventListener('click', async () => {
  if (controlBusy || !controlStorageKey) return;
  controlBusy = true; $('#control-run').disabled = true; $('#control-new').disabled = true;
  controlStatus('controlBusy');
  try {
    let intentId = localStorage.getItem(controlStorageKey);
    if (!intentId) { intentId = crypto.randomUUID(); localStorage.setItem(controlStorageKey, intentId); }
    const result = await request('/api/device/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intentId }) });
    controlStatus(result.replayed ? 'controlReplay' : 'controlDone');
  } catch (error) { controlStatus(error.code === 'OUTCOME_UNKNOWN' ? 'controlUnknown' : 'controlUnavailable', error.code); }
  finally { controlBusy = false; $('#control-run').disabled = false; $('#control-new').disabled = false; }
});
$('#control-new').addEventListener('click', () => {
  if (controlBusy || !controlStorageKey) return;
  if (controlState === 'controlUnknown') return; // Resolve the uncertain operation before creating a new intent.
  try { localStorage.removeItem(controlStorageKey); controlStatus('controlReady'); }
  catch { controlStatus('controlUnavailable'); }
});
void loadControl();
