const $ = s => document.querySelector(s);
const list = $('#tripList');
const dialog = $('#tripDialog');
const form = $('#tripForm');
const tpl = $('#tripTemplate');
let trips = [];
let activeFilter = 'all';
let serverMode = false;

const WORKER_API_ORIGIN = 'https://cargo-reminder-pwa.k995680983-3fb.workers.dev';
const API_BASE = location.hostname.endsWith('.github.io') ? WORKER_API_ORIGIN : '';
const LOCAL_KEY = 'cargoTripsLocalV2';
const CLIENT_ID_KEY = 'cargoReminderBrowserId';

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
const CLIENT_ID = getClientId();

const fmt = d => d ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(d + 'T12:00:00')) : '—';
function reminderDate(trip) {
  const dt = new Date(trip.eta_date + 'T12:00:00');
  dt.setDate(dt.getDate() - Number(trip.remind_days_before ?? 1));
  return dt;
}
function isToday(d) {
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
function localLoad() {
  try {
    const current = localStorage.getItem(LOCAL_KEY);
    if (current !== null) {
      const parsed = JSON.parse(current);
      return Array.isArray(parsed) ? parsed : [];
    }
    const legacy = JSON.parse(localStorage.getItem('cargoTrips') || '[]');
    const migrated = Array.isArray(legacy) ? legacy.map((t, i) => ({
      ...t,
      id: String(t.id || `legacy-${Date.now()}-${i}`)
    })) : [];
    localStorage.setItem(LOCAL_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}
function localSave() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(trips));
}
async function api(url, options = {}) {
  let target = url.startsWith('/api/') ? API_BASE + url : url;
  if (url.startsWith('/api/')) {
    target += (target.includes('?') ? '&' : '?') + 'client_id=' + encodeURIComponent(CLIENT_ID);
  }
  const r = await fetch(target, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!r.ok) {
    let message = '请求失败';
    try { message = (await r.json()).error || message; } catch {}
    throw new Error(message);
  }
  return r.status === 204 ? null : r.json();
}

function setModeBanner(message = '') {
  const banner = $('#modeBanner');
  if (!message) { banner.classList.add('hidden'); banner.textContent = ''; return; }
  banner.textContent = message;
  banner.classList.remove('hidden');
}

async function syncLocalTrips() {
  if (!serverMode) return false;
  try {
    await api('/api/sync-all', {
      method: 'POST',
      body: JSON.stringify({ trips })
    });
    return true;
  } catch {
    serverMode = false;
    setModeBanner('⚠️ 行程已保存在本浏览器，但提醒后台暂时没同步上。网络恢复后重新打开页面会自动重试。');
    return false;
  }
}

async function loadTrips() {
  trips = localLoad();
  render();

  try {
    await api('/api/health');
    serverMode = true;
    setModeBanner('');
    await syncLocalTrips();
  } catch {
    serverMode = false;
    setModeBanner('⚠️ 当前仅本机保存：行程不会丢，但自动推送要等提醒后台恢复后才能同步。');
  }
}

function render() {
  const shown = trips.filter(t => activeFilter === 'all' || t.status === activeFilter);
  list.innerHTML = '';
  $('#todayCount').textContent = trips.filter(t => t.status !== '已报备' && isToday(reminderDate(t))).length;
  if (!shown.length) {
    list.innerHTML = '<div class="empty">还没有行程。点“＋ 新增行程”开始记录。</div>';
    return;
  }
  for (const t of shown) {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector('.trip-card');
    card.querySelector('.route').textContent = `${t.origin} → ${t.destination}`;
    const badge = card.querySelector('.badge');
    badge.textContent = t.status;
    if (t.status === '已报备') badge.classList.add('done');
    card.querySelector('.dates').textContent = `发货 ${fmt(t.ship_date)} · 预计到达 ${fmt(t.eta_date)}`;
    const rd = reminderDate(t);
    const days = Number(t.remind_days_before ?? 1);
    const label = days === 0 ? '到达当天' : `提前 ${days} 天`;
    card.querySelector('.reminder').textContent = `提醒：${fmt(rd.toISOString().slice(0, 10))} ${t.remind_time || '09:00'}（${label}）`;
    card.querySelector('.note').textContent = t.note || '';
    const done = card.querySelector('.done-btn');
    done.textContent = t.status === '已报备' ? '恢复待报备' : '标记已报备';
    if (t.status === '已报备') done.classList.add('undo');
    done.onclick = () => toggleDone(t);
    card.querySelector('.edit-btn').onclick = () => openEdit(t);
    list.appendChild(node);
  }
}

async function toggleDone(t) {
  const status = t.status === '已报备' ? '待报备' : '已报备';
  await updateTrip(t.id, { status });
}
async function updateTrip(id, patch) {
  const i = trips.findIndex(x => String(x.id) === String(id));
  if (i < 0) return;
  trips[i] = { ...trips[i], ...patch };
  localSave();
  render();
  if (serverMode) await syncLocalTrips();
}

function clearForm() {
  form.reset();
  $('#tripId').value = '';
  $('#remindDays').value = '1';
  $('#remindTime').value = '09:00';
  $('#deleteBtn').classList.add('hidden');
  $('#formTitle').textContent = '新增行程';
}
function openNew() {
  clearForm();
  const now = new Date();
  const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $('#shipDate').value = localToday;
  dialog.showModal();
}
function openEdit(t) {
  clearForm();
  $('#formTitle').textContent = '编辑行程';
  $('#tripId').value = t.id;
  $('#origin').value = t.origin;
  $('#destination').value = t.destination;
  $('#shipDate').value = t.ship_date || '';
  $('#etaDate').value = t.eta_date;
  $('#remindDays').value = String(t.remind_days_before ?? 1);
  $('#remindTime').value = t.remind_time || '09:00';
  $('#note').value = t.note || '';
  $('#deleteBtn').classList.remove('hidden');
  dialog.showModal();
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = {
    origin: $('#origin').value.trim(),
    destination: $('#destination').value.trim(),
    ship_date: $('#shipDate').value,
    eta_date: $('#etaDate').value,
    remind_days_before: Number($('#remindDays').value),
    remind_time: $('#remindTime').value || '09:00',
    note: $('#note').value.trim()
  };
  if (!data.origin || !data.destination || !data.eta_date) return;

  const id = $('#tripId').value;
  if (id) {
    const i = trips.findIndex(x => String(x.id) === String(id));
    if (i >= 0) trips[i] = { ...trips[i], ...data, notified: 0 };
  } else {
    const localId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    trips.push({ id: localId, ...data, status: '待报备', notified: 0 });
  }

  localSave();
  dialog.close();
  render();
  if (serverMode) {
    const ok = await syncLocalTrips();
    if (!ok) alert('行程已经保存在这个浏览器里，但后台提醒暂时没同步上。');
  }
});

$('#deleteBtn').onclick = async () => {
  const id = $('#tripId').value;
  if (!id || !confirm('确定删除这条行程吗？')) return;
  trips = trips.filter(x => String(x.id) !== String(id));
  localSave();
  dialog.close();
  render();
  if (serverMode) await syncLocalTrips();
};

$('#addBtn').onclick = openNew;
$('#closeDialog').onclick = () => dialog.close();
document.querySelectorAll('.filter').forEach(b => b.onclick = () => {
  document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  activeFilter = b.dataset.filter;
  render();
});

function base64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
function isIosStandalone() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return !isIOS || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function setNotifyStatus(message, kind = '') {
  const el = $('#notifyStatus');
  if (!el) return;
  el.textContent = '通知状态：' + message;
  el.classList.remove('ok', 'warn');
  if (kind) el.classList.add(kind);
}
function errorText(e) {
  return [e?.name, e?.message].filter(Boolean).join('：') || '未知错误';
}
async function refreshPushButton() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS && !isIosStandalone()) {
    setNotifyStatus('iPhone 请先“添加到主屏幕”，再从桌面图标打开', 'warn');
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    setNotifyStatus('当前环境不支持 Web Push', 'warn');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      $('#notifyBtn').textContent = '提醒已开启';
      setNotifyStatus('权限已允许，已有推送订阅', 'ok');
      try {
        await api('/api/subscribe', {
          method: 'POST',
          body: JSON.stringify(sub.toJSON ? sub.toJSON() : sub)
        });
      } catch {}
    } else if (Notification.permission === 'granted') {
      setNotifyStatus('通知权限已允许，尚未创建推送订阅');
    } else {
      setNotifyStatus('等待你开启通知权限');
    }
  } catch (e) {
    setNotifyStatus('检测失败：' + errorText(e), 'warn');
  }
}
async function enablePush() {
  if (!serverMode) {
    alert('后台数据库还没接通，所以暂时不能开启自动推送。');
    return;
  }
  if (!isIosStandalone()) {
    alert('iPhone 需要先用 Safari 打开这个网站 → 分享 → 添加到主屏幕，然后从桌面图标打开，再点“开启提醒”。');
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    setNotifyStatus('当前环境不支持网页推送', 'warn');
    alert('当前环境不支持网页推送。iPhone 需要 iOS 16.4 或更高版本，并从主屏幕打开本应用。');
    return;
  }

  let stage = '请求通知权限';
  try {
    // iOS 要求权限请求直接发生在用户点击之后，所以这里必须放在任何网络 await 之前。
    setNotifyStatus('正在请求通知权限…');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setNotifyStatus('通知权限未允许', 'warn');
      alert('需要允许通知，才能在报备日自动提醒你。');
      return;
    }

    stage = '等待 Service Worker';
    setNotifyStatus('权限已允许，正在准备推送服务…', 'ok');
    const reg = await navigator.serviceWorker.ready;

    stage = '读取推送配置';
    setNotifyStatus('正在连接后台读取推送配置…');
    const config = await api('/api/config');

    stage = '创建推送订阅';
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      setNotifyStatus('正在创建设备推送订阅…');
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(config.vapidPublicKey)
      });
    }

    stage = '保存推送订阅';
    setNotifyStatus('正在保存设备订阅…');
    await api('/api/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON ? sub.toJSON() : sub) });
    $('#notifyBtn').textContent = '提醒已开启';

    stage = '发送测试推送';
    setNotifyStatus('订阅成功，正在发送测试推送…', 'ok');
    const test = await api('/api/test-push', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    if (test.ok) {
      setNotifyStatus(`推送已提交：送达 ${test.delivered}/${test.subscriptions}`, 'ok');
    } else {
      setNotifyStatus(`订阅成功，但测试推送未送达（${test.delivered}/${test.subscriptions}）`, 'warn');
      alert('提醒权限已经开启，但测试通知没有送达。');
    }
  } catch (e) {
    const detail = `${stage}失败：${errorText(e)}`;
    setNotifyStatus(detail, 'warn');
    alert(detail);
  }
}

async function testNotification() {
  if (!isIosStandalone()) {
    alert('iPhone 需要先把网站添加到主屏幕，再从桌面图标打开测试通知。');
    return;
  }
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    setNotifyStatus('当前环境不支持通知', 'warn');
    return;
  }
  try {
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') {
      setNotifyStatus('通知权限未允许', 'warn');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    const sub = 'PushManager' in window ? await reg.pushManager.getSubscription() : null;
    if (!sub) {
      setNotifyStatus('还没有服务器推送订阅，请先点“开启提醒”', 'warn');
      alert('请先点“开启提醒”，成功后再测试通知。');
      return;
    }

    setNotifyStatus('8 秒后发送测试通知：现在回桌面或锁屏');
    alert('测试通知会在 8 秒后发到手机。点“确定”后马上回桌面或锁屏，就能看到它真实弹出来的样子。');
    const result = await api('/api/test-push', {
      method: 'POST',
      body: JSON.stringify({ endpoint: sub.endpoint, delayMs: 8000 })
    });
    if (result.queued) {
      setNotifyStatus('测试通知已排队：现在回桌面或锁屏，约 8 秒后会弹出', 'ok');
    } else {
      setNotifyStatus(`服务器测试推送 ${result.delivered}/${result.subscriptions}`, result.ok ? 'ok' : 'warn');
    }
  } catch (e) {
    setNotifyStatus('测试通知失败：' + errorText(e), 'warn');
    alert('测试通知失败：' + errorText(e));
  }
}
$('#notifyBtn').onclick = enablePush;
$('#testNotifyBtn').onclick = testNotification;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(refreshPushButton).catch(() => {});
}
loadTrips();


document.addEventListener('dblclick', event => {
  event.preventDefault();
}, { passive: false });
