// One Steam client session per run: log in with a refresh token (steam-user), make sure the account
// has the free CS2 licence, launch app 730 and talk to the CS2 game coordinator via `globaloffensive`
// (DoctorMcKay; v3 speaks CS2's GC: ClientHello → ClientWelcome, MatchListRequestFullGameInfo → MatchList).
// Constructors are injected so tests can drive it with fakes.
import { SyncError } from './matches.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOGIN_ERRORS = {
  5: 'токен STEAM_BOT_TOKEN не принят (InvalidPassword)',
  15: 'доступ запрещён (AccessDenied) — токен отозван или аккаунт заблокирован',
  26: 'токен STEAM_BOT_TOKEN отозван (Revoked)',
  27: 'срок действия STEAM_BOT_TOKEN истёк (Expired)',
  84: 'Steam временно ограничил входы с этого адреса (RateLimitExceeded)',
  87: 'Steam временно ограничил входы (AccountLoginDeniedThrottle)',
};

export function loginError(e) {
  const code = e?.eresult;
  const why = LOGIN_ERRORS[code];
  const fatal = [5, 15, 26, 27].includes(code) || /refresh ?token/i.test(String(e?.message || ''));
  const msg = why
    ? `Вход в Steam не удался: ${why}.`
    : `Вход в Steam не удался (код ${code ?? '—'}).`;
  return new SyncError('steam', fatal ? `${msg} Получите новый токен: node scripts/steam-login.mjs --client → секрет STEAM_BOT_TOKEN.` : msg, { fatal });
}

/**
 * @param {object} o
 * @param {Function} o.SteamUser       steam-user constructor
 * @param {Function} o.GlobalOffensive globaloffensive constructor
 * @param {string} o.refreshToken      SteamClient refresh token
 * @param {{licence?: boolean}} o.state  persisted run state (licence flag is written back)
 * @param {(msg: string) => void} o.log
 */
export async function openGcSession({ SteamUser, GlobalOffensive, refreshToken, state, log, timeouts = {} }) {
  const t = { login: 60000, gc: 90000, request: 25000, gap: 2500, ...timeouts };
  const client = new SteamUser({ autoRelogin: false, enablePicsCache: false, dataDirectory: null, renewRefreshTokens: false });
  let closed = false;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new SyncError('steam', 'Steam не ответил на вход за 60 с — попробую в следующий раз')); }, t.login);
    const onOk = () => { cleanup(); resolve(); };
    const onErr = (e) => { cleanup(); reject(loginError(e)); };
    const cleanup = () => { clearTimeout(timer); client.removeListener('loggedOn', onOk); client.removeListener('error', onErr); };
    client.on('loggedOn', onOk);
    client.on('error', onErr);
    try {
      const p = client.logOn({ refreshToken });
      if (p && typeof p.catch === 'function') p.catch(onErr);
    } catch (e) {
      onErr(e);
    }
  });
  // from here on errors must never be unhandled (EventEmitter throws on an unhandled 'error')
  client.on('error', (e) => { if (!closed) log(`Steam: соединение потеряно (код ${e?.eresult ?? '—'})`); });
  log('Вход в Steam выполнен');

  const csgo = new GlobalOffensive(client);
  csgo.on('error', (e) => log(`Координатор CS2: ошибка входа (${e?.code ?? '—'})`));

  let licenceAsked = false;
  const askLicence = async () => {
    licenceAsked = true;
    try {
      const r = await client.requestFreeLicense([730]);
      state.licence = true;
      const n = (r?.grantedPackageIds || []).length;
      log(n ? `Бесплатная лицензия CS2 добавлена на аккаунт (пакетов: ${n})` : 'Лицензия CS2 уже есть на аккаунте');
    } catch (e) {
      log(`Не удалось запросить лицензию CS2 (код ${e?.eresult ?? '—'})`);
    }
  };
  if (!state.licence) await askLicence();

  const connect = () => new Promise((resolve) => {
    if (csgo.haveGCSession) return resolve(true);
    const timer = setTimeout(() => { off(); resolve(false); }, t.gc);
    const on = () => { off(); resolve(true); };
    const off = () => { clearTimeout(timer); csgo.removeListener('connectedToGC', on); };
    csgo.on('connectedToGC', on);
    client.gamesPlayed([730]);
  });

  let ok = await connect();
  if (!ok && !licenceAsked) {
    client.gamesPlayed([]);
    await askLicence();
    await sleep(2000);
    ok = await connect();
  }
  const close = async () => {
    if (closed) return;
    closed = true;
    try { client.gamesPlayed([]); } catch { /* already gone */ }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      client.once('disconnected', () => { clearTimeout(timer); resolve(); });
      try { client.logOff(); } catch { clearTimeout(timer); resolve(); }
    });
    log('Выход из Steam');
  };
  if (!ok) {
    await close();
    throw new SyncError('gc', 'Координатор CS2 не ответил (нет ClientWelcome) — попробую в следующий раз');
  }
  log('Подключение к координатору CS2 есть');

  let lastAt = 0;
  /** one MatchListRequestFullGameInfo → CDataGCCStrike15_v2_MatchInfo | { empty: true } | null (timeout) */
  const ask = (code, matchId) => new Promise((resolve) => {
    const done = (v) => { clearTimeout(timer); csgo.removeListener('matchList', on); resolve(v); };
    const on = (matches) => {
      const list = Array.isArray(matches) ? matches : [];
      const m = list.find((x) => x && String(x.matchid) === String(matchId));
      if (m) done(m);
      else if (!list.length) done({ empty: true });
    };
    const timer = setTimeout(() => done(null), t.request);
    csgo.on('matchList', on);
    try { csgo.requestGame(code); } catch { done(null); }
  });

  return {
    async requestGame(code, matchId) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!csgo.haveGCSession && !(await connect())) return null;
        const wait = lastAt + t.gap * (attempt + 1) - Date.now();
        if (wait > 0) await sleep(wait);
        lastAt = Date.now();
        const r = await ask(code, matchId);
        if (r) return r; // match info, or { empty: true } when the GC doesn't know the code
      }
      return null;
    },
    close,
  };
}
