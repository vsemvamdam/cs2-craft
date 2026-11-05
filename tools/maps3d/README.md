
## Карты с текстурами (build_textured.mjs)

Настоящая геометрия и текстуры карты берутся из файлов игры на своём компьютере (Source 2 Viewer CLI):

```powershell
.\s2v\Source2Viewer-CLI.exe -i "<CS2>\game\csgo\maps\de_mirage.vpk" -f maps/de_mirage.vmap_c -o "<папка>\de_mirage" --game "<CS2>\game\csgo\gameinfo.gi" -d --gltf_export_format gltf --gltf_export_materials --gltf_textures_adapt
```

Затем здесь: `npm i && node build_textured.mjs <папка>/de_mirage.gltf ../../public/maps3d/de_mirage.glb` и добавить карту
в `TEXTURED_MAPS` в `src/lib/map3d.ts`. Скрипт убирает служебные браши, оставляет цветовые текстуры (WebP ≤512 px),
переводит метры и оси экспортёра в систему сайта, склеивает и сжимает геометрию (meshopt). Mirage: 1,29 млн → 0,74 млн
треугольников, 22,7 МБ. Карты © Valve Corporation.
