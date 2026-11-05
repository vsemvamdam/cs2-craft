#!/usr/bin/env node
// One-time helper: log in to Steam by QR code and print a refresh token.
//   node steam-login.mjs           → token for the STEAM_REFRESH_TOKEN secret (full price history, web login)
//   node steam-login.mjs --client  → token for the STEAM_BOT_TOKEN secret (Steam client login: asks the CS2
//                                    game servers for demo links of your matches; works for ~200 days)
// Self-contained: needs only the `steam-session` and `qrcode-terminal` packages,
// so it can be run from any folder (see README → «Включить полную историю цен Steam»).
//
// The token is valid for ~200 days and gives access to that account, so prefer a secondary
// account and never commit or share it — only paste it into GitHub → Settings → Secrets → Actions.

import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import qrcode from 'qrcode-terminal';

const client = process.argv.includes('--client');
const secret = client ? 'STEAM_BOT_TOKEN' : 'STEAM_REFRESH_TOKEN';
const session = new LoginSession(client ? EAuthTokenPlatformType.SteamClient : EAuthTokenPlatformType.WebBrowser);
session.loginTimeout = 5 * 60 * 1000; // 5 minutes to scan the code (library default is 30 s)

const start = await session.startWithQR();
console.log('\nОтсканируйте QR-код в мобильном приложении Steam:');
console.log('Steam → значок щита (Steam Guard) → «Сканировать QR-код». На это есть 5 минут.\n');
qrcode.generate(start.qrChallengeUrl, { small: true });

session.on('remoteInteraction', () => console.log('Код отсканирован — подтвердите вход в приложении Steam…'));
session.on('authenticated', () => {
  console.log(`\nГотово: вход выполнен как ${session.accountName}.`);
  console.log(`\nСкопируйте строку ниже целиком в секрет репозитория ${secret}`);
  console.log('(GitHub → Settings → Secrets and variables → Actions → New repository secret):\n');
  console.log(session.refreshToken);
  console.log('\nНикому не пересылайте этот токен — он даёт доступ к аккаунту.');
  process.exit(0);
});
session.on('timeout', () => { console.error('Время ожидания истекло — запустите ещё раз.'); process.exit(1); });
session.on('error', (e) => { console.error('Ошибка входа:', e.message); process.exit(1); });
