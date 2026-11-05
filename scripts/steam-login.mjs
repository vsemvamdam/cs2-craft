#!/usr/bin/env node
// One-time helper: log in to Steam by QR code and print a refresh token for the
// STEAM_REFRESH_TOKEN repository secret (used to download full price history).
//
//   npm install
//   npm run steam-login
//
// Scan the QR code with the Steam Mobile app (Steam Guard → scan QR). The token is valid
// for ~200 days and gives access to that account, so prefer a secondary account and never
// commit the token anywhere — only paste it into GitHub → Settings → Secrets → Actions.

import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import qrcode from 'qrcode-terminal';

const session = new LoginSession(EAuthTokenPlatformType.WebBrowser);
const start = await session.startWithQR();
console.log('\nОтсканируйте QR-код в мобильном приложении Steam (Steam Guard → сканировать QR):\n');
qrcode.generate(start.qrChallengeUrl, { small: true });
console.log('\nЕсли QR не читается, откройте ссылку на телефоне:', start.qrChallengeUrl, '\n');

session.on('remoteInteraction', () => console.log('Подтвердите вход в приложении…'));
session.on('authenticated', async () => {
  console.log('\nГотово. Вход выполнен как', session.accountName);
  console.log('\nSTEAM_REFRESH_TOKEN (скопируйте целиком в секрет репозитория):\n');
  console.log(session.refreshToken);
  console.log('\nGitHub → Settings → Secrets and variables → Actions → New repository secret → STEAM_REFRESH_TOKEN');
  process.exit(0);
});
session.on('timeout', () => { console.error('Время ожидания истекло, запустите снова.'); process.exit(1); });
session.on('error', (e) => { console.error('Ошибка:', e.message); process.exit(1); });
