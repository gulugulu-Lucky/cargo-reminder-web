const $ = s => document.querySelector(s);
const list = $('#tripList');
const dialog = $('#tripDialog');
const form = $('#tripForm');
const tpl = $('#tripTemplate');
let trips = [];
let activeFilter = 'all';
let serverMode = true;

const WORKER_API_ORIGIN = 'https://cargo-reminder-pwa.k995680983-3fb.workers.dev';
const API_BASE = location.hostname.endsWith('.github.io') ? WORKER_API_ORIGIN : '';

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
function localLoad() { return JSON.parse(localStorage.getItem('cargoTrips') || '[]'); }
function localSave() { localStorage.setItem('cargoTrips', JSON.stringify(trips)); }
async function api(url, options = {}) {
  const target = url.startsWith('/api/') ? API_BASE + url : url;
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

async function loadTrips() {
  try {
    trips = await api('/api/trips');
    serverMode = true;
    setModeBanner('');
  } catch {
    serverMode = false;
    trips = localLoad();
    setModeBanner('⚠️ 当前为本机模式：行程能记录，但后台自动推送还没接通。部署时绑定 D1 后会自动恢复。');
  }
  render();
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
  if (serverMode) {
    try { await api('/api/trips/' + id, { method: 'PATCH', body: JSON.stringify(patch) }); }
    catch (e) { alert(e.message); return; }
  } else {
    const i = trips.findIndex(x => String(x.id) === String(id));
    trips[i] = { ...trips[i], ...patch };
    localSave();
  }
  await loadTrips();
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
  try {
    if (serverMode) {
      if (id) await api('/api/trips/' + id, { method: 'PATCH', body: JSON.stringify(data) });
      else await api('/api/trips', { method: 'POST', body: JSON.stringify(data) });
    } else {
      if (id) {
        const i = trips.findIndex(x => String(x.id) === String(id));
        trips[i] = { ...trips[i], ...data, notified: 0 };
      } else {
        trips.push({ id: Date.now(), ...data, status: '待报备', notified: 0 });
      }
      localSave();
    }
    dialog.close();
    await loadTrips();
  } catch (err) { alert(err.message); }
});
$('#deleteBtn').onclick = async () => {
  const id = $('#tripId').value;
  if (!id || !confirm('确定删除这条行程吗？')) return;
  if (serverMode) await api('/api/trips/' + id, { method: 'DELETE' });
  else { trips = trips.filter(x => String(x.id) !== String(id)); localSave(); }
  dialog.close();
  await loadTrips();
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
  let stage = '请求通知权限';
  try {
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') {
      setNotifyStatus('通知权限未允许', 'warn');
      return;
    }
    stage = '显示本机测试通知';
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('✅ 本机通知测试', {
      body: '如果你看到这条，说明设备本身的通知显示是正常的。',
      icon: './icon.svg',
      tag: 'cargo-local-test'
    });
    setNotifyStatus('本机测试通知已触发', 'ok');

    const sub = 'PushManager' in window ? await reg.pushManager.getSubscription() : null;
    if (sub && serverMode) {
      stage = '发送服务器测试推送';
      const result = await api('/api/test-push', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      setNotifyStatus(`本机测试成功；服务器推送 ${result.delivered}/${result.subscriptions}`, result.ok ? 'ok' : 'warn');
    }
  } catch (e) {
    setNotifyStatus(`${stage}失败：${errorText(e)}`, 'warn');
    alert(`${stage}失败：${errorText(e)}`);
  }
}
$('#notifyBtn').onclick = enablePush;
$('#testNotifyBtn').onclick = testNotification;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(refreshPushButton).catch(() => {});
}
loadTrips();
