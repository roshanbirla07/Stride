const $ = id => document.getElementById(id);
const state = { token: sessionStorage.getItem('strideSession'), user: null, period: 'day', registering: false, groups: [], groupId: null, refreshId: 0 };
const fmt = n => Number(n || 0).toLocaleString();
const setText = (id, value) => { $(id).textContent = value; };
const istDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const dateLabel = day => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(day+'T00:00:00+05:30'));
function freshness(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Refresh time unavailable';
  const time = date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  return `Updated ${istDay(date) === istDay() ? 'today' : dateLabel(istDay(date))} · ${time} IST`;
}
function initials(name) { return name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase(); }

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers },
    cache: 'no-store'
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('Server response was not valid JSON'); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showAuth() {
  $('dashboard').hidden = true;
  $('auth-panel').hidden = false;
  $('initials').hidden = true;
  $('pilot-label').hidden = false;
  ++state.refreshId;
  state.user = null;
  state.token = null;
  state.groups = [];
  state.groupId = null;
  sessionStorage.removeItem('strideSession');
  sessionStorage.removeItem('strideGroupId');
}

async function showDashboard() {
  try {
    state.user = await api('/me');
    $('auth-panel').hidden = true;
    $('dashboard').hidden = false;
    $('initials').hidden = false;
    $('pilot-label').hidden = true;
    setText('user-name', `${state.user.name.split(' ')[0]}.`);
    setText('initials', initials(state.user.name));
    setText('today-label', istDay());
    setText('upload-url', `${location.origin}/shortcut/steps`);
    await refreshGroups();
    await Promise.all([refresh(), tokenStatus()]);
  } catch (error) {
    if (/expired|sign in/i.test(error.message)) showAuth();
    else setText('board-message', error.message);
  }
}

async function refreshGroups(preferred) {
  const result = await api('/groups');
  state.groups = result.groups;
  const remembered = Number(sessionStorage.getItem('strideGroupId'));
  const choice = preferred ?? state.groupId ?? remembered;
  state.groupId = state.groups.some(g => g.id === choice) ? choice : (state.groups[0]?.id ?? null);
  const select = $('group-select'); select.replaceChildren();
  if (!state.groups.length) {
    const option = document.createElement('option'); option.textContent = 'Create or join a group'; option.value = '';
    select.append(option); $('group-manage').hidden = false;
  } else {
    state.groups.forEach(g => {
      const option = document.createElement('option'); option.value = g.id; option.textContent = g.name;
      select.append(option);
    });
    select.value = String(state.groupId);
  }
  select.disabled = !state.groups.length;
  sessionStorage.setItem('strideGroupId', String(state.groupId ?? ''));
  const group = state.groups.find(g => g.id === state.groupId);
  setText('group-code', group?.code ?? '—');
  $('copy-group-code').disabled = !group;
  $('rotate-group-code').hidden = !group || group.ownerId !== state.user.id;
  setText('group-activation', group && group.effectiveDay > istDay()
    ? `Your results in ${group.name} begin ${group.effectiveDay}. Keep syncing; uploads count once membership starts.`
    : '');
}

async function refresh() {
  if (!state.token || !state.user) return;
  const id = ++state.refreshId;
  const day = istDay();
  const requestedGroup = state.groupId;
  const requestedPeriod = state.period;
  $('sync-now').disabled = !requestedGroup;
  setText('period-label', requestedPeriod === 'day' ? 'TODAY' : `THIS ${requestedPeriod.toUpperCase()}`);
  setText('my-steps', '…');
  setText('hero-note', 'Updating your rank…');
  setText('board-message', '');
  setText('sync-status', 'Refreshing standings…');
  setText('sync-indicator', '↻');
  $('sync-indicator').className = 'sync-indicator';
  $('entries').replaceChildren();
  $('entries').setAttribute('aria-busy', 'true');
  document.querySelector('.hero').setAttribute('aria-busy', 'true');
  $('refresh-board').disabled = true;
  setText('refresh-board', 'Refreshing…');
  try {
    if (!requestedGroup) {
      setText('range', 'Create or join a group to see a leaderboard.');
      setText('my-steps', '—');
      setText('hero-note', 'Your crew starts here');
      setText('coins', '0'); setText('points', '0');
      setText('sync-status', 'Create or join a group first');
      setText('sync-indicator', '—');
      return;
    }
    setText('range', `${requestedPeriod === 'day' ? dateLabel(day) : requestedPeriod === 'week' ? 'This week' : 'This month'} · IST`);
    const board = await api(`/leaderboard?period=${requestedPeriod}&day=${day}&groupId=${requestedGroup}`);
    if (id !== state.refreshId) return;
    setText('today-label', day);
    setText('range', `${dateLabel(board.from)}${board.from.slice(0,4)!==board.through.slice(0,4)?' '+board.from.slice(0,4):''}${board.from === board.through ? '' : ' – '+dateLabel(board.through)} ${day.slice(0,4)} · IST`);
    setText('coins', fmt(board.wallet.coins));
    setText('points', fmt(board.wallet.points));
    const mine = board.entries.find(entry => entry.id === state.user.id);
    setText('my-steps', mine ? fmt(mine.steps) : '—');
    const group = state.groups.find(g => g.id === requestedGroup);
    const pending = group && group.effectiveDay > day;
    setText('hero-note', mine ? `Rank #${mine.rank} of ${board.entries.length}` : pending ? `Results begin ${dateLabel(group.effectiveDay)}` : 'Refresh your health steps to appear');
    setText('sync-status', mine ? freshness(mine.lastSync) : 'No health total for this period');
    const current = mine && istDay(new Date(mine.lastSync)) === day;
    setText('sync-indicator', current ? '✓' : '—');
    $('sync-indicator').className = `sync-indicator${current ? ' refreshed' : ''}`;
    const entries = $('entries');
    if (!board.entries.length) {
      const empty = document.createElement('p'); empty.className = 'empty-state';
      empty.textContent = pending ? `Your membership begins ${dateLabel(group.effectiveDay)}. Check back then.` : 'No totals yet. Refresh health steps in the native app, or run your Today Shortcut.';
      entries.append(empty);
    }
    board.entries.forEach(entry => {
      const row = document.createElement('div'); row.className = 'entry'+(entry.id === state.user.id ? ' my-entry' : '');
      const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = `#${entry.rank}`;
      const avatar = document.createElement('span'); avatar.className = 'entry-avatar'; avatar.textContent = initials(entry.name); avatar.setAttribute('aria-hidden','true');
      const person = document.createElement('div'); person.className = 'entry-person';
      const name = document.createElement('strong'); name.textContent = entry.id === state.user.id ? 'You' : entry.name;
      const updated = document.createElement('small'); updated.textContent = freshness(entry.lastSync);
      if (istDay(new Date(entry.lastSync)) < day) updated.className = 'older-total';
      person.append(name, updated);
      const steps = document.createElement('div'); steps.className = 'steps';
      const count = document.createElement('strong'); count.textContent = fmt(entry.steps);
      const unit = document.createElement('small'); unit.textContent = 'steps'; steps.append(count, unit);
      row.append(rank, avatar, person, steps); entries.append(row);
    });
  } catch (error) {
    if (id !== state.refreshId) return;
    setText('my-steps', '—'); setText('hero-note', 'Rank unavailable');
    setText('sync-status', 'Refresh failed'); setText('sync-indicator', '!');
    $('sync-indicator').className = 'sync-indicator failed';
    setText('board-message', `${error.message}. Tap Refresh standings to retry.`);
  } finally {
    if (id === state.refreshId) {
      $('entries').setAttribute('aria-busy', 'false');
      document.querySelector('.hero').setAttribute('aria-busy', 'false');
      $('refresh-board').disabled = !state.groupId;
      setText('refresh-board', 'Refresh standings');
    }
  }
}

$('refresh-board').addEventListener('click', refresh);
$('group-select').addEventListener('change', event => {
  state.groupId = Number(event.target.value);
  refreshGroups(state.groupId).then(refresh).catch(error => setText('group-message', error.message));
});
$('group-options').addEventListener('click', () => { $('group-manage').hidden = !$('group-manage').hidden; });
$('create-group-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const group = await api('/groups', { method: 'POST', body: JSON.stringify({ name: $('new-group-name').value.trim() }) });
    $('new-group-name').value = '';
    await refreshGroups(group.id); await refresh();
    setText('group-message', `Created ${group.name}. Share code ${group.code}; results begin ${group.effectiveDay}.`);
  } catch (error) { setText('group-message', error.message); }
});
$('join-group-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api('/groups/join', { method: 'POST', body: JSON.stringify({ code: $('join-code').value.trim() }) });
    const joined = result.groups.find(g => !state.groups.some(old => old.id === g.id));
    $('join-code').value = '';
    await refreshGroups(joined?.id); await refresh();
    setText('group-message', `Joined ${joined?.name ?? 'group'}. Your results begin tomorrow.`);
  } catch (error) { setText('group-message', error.message); }
});
$('copy-group-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('group-code').textContent); setText('group-message', 'Code copied.'); }
  catch { setText('group-message', 'Select and copy the code above.'); }
});
$('rotate-group-code').addEventListener('click', async () => {
  if (!confirm('Regenerate code? The previous invite code will stop working.')) return;
  try {
    await api('/groups/rotate', { method: 'POST', body: JSON.stringify({ groupId: state.groupId }) });
    await refreshGroups(state.groupId); setText('group-message', 'New code ready to share.');
  } catch (error) { setText('group-message', error.message); }
});

async function tokenStatus() {
  try {
    const status = await api('/shortcut/status');
    setText('token-status', status.connected ? `Upload token active until ${new Date(status.expiresAt).toLocaleDateString()}. Rotate it before expiry.` : 'No active upload token. Generate one to set up the Shortcut.');
  } catch (error) { setText('token-status', error.message); }
}

$('auth-toggle').addEventListener('click', () => {
  state.registering = !state.registering;
  $('name-wrap').hidden = !state.registering;
  $('name').required = state.registering;
  $('password').autocomplete = state.registering ? 'new-password' : 'current-password';
  setText('auth-title', state.registering ? 'Create account' : 'Sign in');
  setText('auth-submit', state.registering ? 'Create account' : 'Sign in');
  setText('auth-toggle', state.registering ? 'Already have an account? Sign in' : 'New here? Create account');
  setText('auth-message', '');
});

$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('auth-submit'); button.disabled = true;
  try {
    const body = { email: $('email').value.trim(), password: $('password').value };
    if (state.registering) body.name = $('name').value.trim();
    const result = await api(state.registering ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(body) });
    state.token = result.token;
    sessionStorage.setItem('strideSession', state.token);
    $('password').value = '';
    await showDashboard();
  } catch (error) { setText('auth-message', error.message); }
  finally { button.disabled = false; }
});

document.querySelectorAll('[data-period]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.period === state.period)); button.addEventListener('click', () => {
  state.period = button.dataset.period;
  document.querySelectorAll('[data-period]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); });
  refresh();
}); });

$('sync-now').addEventListener('click', () => {
  setText('sync-hint', 'Shortcut opened. Return after it finishes; check the step count above to confirm upload.');
  location.href = 'shortcuts://run-shortcut?name=Stride%20Sync';
  setTimeout(refresh, 4000);
});
$('create-token').addEventListener('click', async () => {
  if (!confirm('Generate a new upload token? Your previous Shortcut token will stop working.')) return;
  try {
    const result = await api('/shortcut/token', { method: 'POST', body: '{}' });
    $('token-box').hidden = false; setText('upload-token', result.token);
    await tokenStatus();
  } catch (error) { setText('token-status', error.message); }
});
$('copy-token').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('upload-token').textContent); setText('copy-token', 'Copied'); }
  catch { setText('token-status', 'Select and copy the token above manually.'); }
});
$('revoke-token').addEventListener('click', async () => {
  if (!confirm('Revoke the upload token? The Shortcut will stop uploading.')) return;
  try {
    await api('/shortcut/revoke', { method: 'POST', body: '{}' });
    $('token-box').hidden = true; setText('upload-token', ''); await tokenStatus();
  } catch (error) { setText('token-status', error.message); }
});
$('sign-out').addEventListener('click', showAuth);
window.addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
if (state.token) showDashboard(); else showAuth();
