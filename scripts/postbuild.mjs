// GitHub Pages: SPA fallback + no Jekyll processing
import fs from 'node:fs';
fs.copyFileSync('dist/index.html', 'dist/404.html');
fs.writeFileSync('dist/.nojekyll', '');
console.log('postbuild: 404.html + .nojekyll');
