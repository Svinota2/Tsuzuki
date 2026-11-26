import { projectUrl, publishableKey } from './cloud-config.js';

export const configured = Boolean(projectUrl && publishableKey);
const sessionKey = 'tsuzuki.cloud.session.v1';
let refresh;
function readSession() {
  try { return JSON.parse(localStorage.getItem(sessionKey)); } catch { return null; }
}
function saveSession(data) {
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in
  };
  localStorage.setItem(sessionKey, JSON.stringify(session));
  return session;
}
function clearSession() { localStorage.removeItem(sessionKey); }

async function call(path, { method = 'GET', body, session, prefer } = {}) {
  if (!configured) throw Error('Облачные аккаунты ещё не подключены.');
  const headers = { apikey: publishableKey };
  if (session) headers.Authorization = 'Bearer ' + session.access_token;
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  let response;
  try {
    response = await fetch(projectUrl + path, {
      method, headers, credentials: 'omit', redirect: 'error', body: body && JSON.stringify(body)
    });
  } catch {
    throw Error('Не удалось подключиться к аккаунту Tsuzuki. Проверьте интернет.');
  }
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    const messages = {
      invalid_credentials: 'Проверьте логин и пароль.',
      user_already_exists: 'Этот логин уже занят.',
      email_exists: 'Этот логин уже занят.',
      weak_password: 'Выберите более надёжный пароль.'
    };
    throw Object.assign(new Error(messages[data?.error_code ?? data?.code] ||
      (response.status === 429 ? 'Слишком много запросов. Попробуйте позже.' : 'Запрос отклонён. Попробуйте снова.')), { status: response.status });
  }
  return data;
}

async function validSession() {
  if (refresh) return refresh;
  const session = readSession();
  if (!session) return null;
  if (session.expires_at > Date.now() / 1000 + 45) return session;
  const renew = async () => {
    const current = readSession();
    if (!current || current.expires_at > Date.now() / 1000 + 45) return current;
    try {
      const result = await call('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: { refresh_token: current.refresh_token }
      });
      return readSession()?.refresh_token === current.refresh_token ? saveSession(result) : readSession();
    } catch (error) {
      if (![400, 401, 403].includes(error.status)) throw error;
      if (readSession()?.refresh_token === current.refresh_token) clearSession();
      return readSession();
    }
  };
  refresh = (globalThis.navigator?.locks ? navigator.locks.request(sessionKey, renew) : renew())
    .finally(() => { refresh = null; });
  return refresh;
}

const loginSuffix = '@accounts.tsuzuki.invalid';
function accountEmail(login) {
  const name = login.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name)) {
    throw Error('Логин: от 3 до 32 символов, латинские буквы, цифры, дефис или подчёркивание.');
  }
  return name + loginSuffix;
}
function displayLogin(email) {
  return email.endsWith(loginSuffix) ? email.slice(0, -loginSuffix.length) : email;
}
export async function api(path, method = 'GET', body) {
  if (path.startsWith('catalog')) {
    const term = new URLSearchParams(path.split('?')[1]).get('q')?.slice(0, 160);
    const query = '{ animes(limit: 30, censored: true, order: popularity' +
      (term ? ', search: ' + JSON.stringify(term) : '') +
      ') { id name russian episodes score airedOn { year } genres { russian } poster { previewUrl mainUrl } } }';
    const response = await fetch('https://shikimori.io/api/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query })
    });
    const list = (await response.json()).data?.animes;
    if (!response.ok || !Array.isArray(list)) throw Error('Каталог временно недоступен.');
    return list.map(a => ({ id: Number(a.id), title: a.russian || a.name, original: a.name,
      poster: a.poster?.mainUrl || a.poster?.previewUrl || '', year: a.airedOn?.year,
      score: a.score, episodes: a.episodes, genres: a.genres?.map(g => g.russian) || [] }));
  }
  if (path === 'register' || path === 'login') {
    const endpoint = path === 'register' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password';
    const credentials = { email: accountEmail(body.login), password: body.password };
    const result = await call(endpoint, { method, body: credentials });
    if (!result.access_token) throw Error('Регистрация временно недоступна.');
    saveSession(result);
    return { login: displayLogin(result.user.email) };
  }
  if (path === 'me' && !configured) return { login: null };
  const session = await validSession();
  if (path === 'me') {
    if (!session) return { login: null };
    try { return { login: displayLogin((await call('/auth/v1/user', { session })).email) }; }
    catch(e) { if (e.status !== 401 && e.status !== 403) throw e; clearSession(); return { login: null }; }
  }
  if (path === 'logout') {
    if (session) await call('/auth/v1/logout?scope=local', { method, session });
    clearSession(); return;
  }
  if (!session) throw Object.assign(Error('Войдите в аккаунт.'), { status: 401 });
  const table = '/rest/v1/tsuzuki_library';
  if (method === 'GET') {
    const entries = [];
    const limit = 500;
    let last = 0;
    for (;;) {
      const page = await call(table + '?select=id,title,poster,status,watched&order=id&limit=' + limit + '&id=gt.' + last, { session });
      entries.push(...page);
      if (page.length < limit) return entries;
      last = page.at(-1).id;
    }
  }
  if (method === 'POST') return call(table + '?on_conflict=user_id,id', {
    method, session, prefer: 'resolution=ignore-duplicates',
    body: (Array.isArray(body) ? body : [body]).map(entry => ({
      id: entry.id, title: entry.title,
      poster: entry.poster?.startsWith('https://') && entry.poster.length <= 2048 ? entry.poster : '',
      status: entry.status || 'planned', watched: entry.watched ?? 0
    }))
  });
  if (method === 'PATCH' && body.delta) return call('/rest/v1/rpc/tsuzuki_mark_episode', {
    method: 'POST', session, body: { title_id: body.id, step: body.delta }
  });
  const filter = '?id=eq.' + encodeURIComponent(body.id);
  return call(table + filter, { method, session, body: method === 'PATCH' ? { status: body.status } : undefined });
}
