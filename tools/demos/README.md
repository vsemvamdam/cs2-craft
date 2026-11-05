# Раскидки профи: извлечение гранат из демок CS2

`extract_nades.py` читает демки CS2 (`.dem`, формат `PBDEMS2`) через
[demoparser2](https://github.com/LaihoE/demoparser) и складывает каждый бросок
гранаты в `public/data/nades/<map>.json`. Сайт по этим данным строит раздел
«Раскидки профи»: точку броска, углы, траекторию на радаре и точку приземления.

## Установка

```bash
python3 -m pip install demoparser2          # на Debian/Ubuntu с системным Python: --break-system-packages
```

Нужен Python 3.9+. `pandas` ставится вместе с demoparser2.
Для `.rar` дополнительно нужен `unrar`, `7z` или `bsdtar`. `.zip`, `.gz`, `.bz2`
и `.xz` распаковываются средствами Python.

## Где взять демку

1. Откройте страницу матча на HLTV (`https://www.hltv.org/matches/<id>/...`).
2. Внизу, в блоке **Demo**, или на вкладке **Demos** нажмите *GOTV Demo*.
   Скачается архив `.rar` (иногда `.zip`), в нём по одному `.dem` на карту.
3. Скачивать приходится **вручную в браузере**. HLTV стоит за Cloudflare и
   отдаёт ботам и серверам CI (GitHub Actions) 403 или страницу
   с JS-проверкой вместо файла. При подготовке пайплайна hltv.org
   не открылся для автоматического запроса. Автоматическое скачивание с HLTV поэтому
   не поддерживается и не гарантируется, а обходить защиту мы не пытаемся.
   Если вместо архива пришёл HTML, скрипт пишет
   «получен HTML вместо файла» и переходит к следующему URL.
4. Другие источники: ссылки на демки от организаторов турниров (FACEIT, BLAST,
   ESL иногда выкладывают их публично), а также ваш собственный «зеркальный»
   архив (GitHub Release, S3, R2 и т.п.), куда вы один раз загружаете демки,
   скачанные вручную.

> Скрипт принимает только демки CS2. Демки CS:GO (`HL2DEMO`) demoparser2 не читает.

## Запуск

```bash
# одна демка с метаданными
python3 tools/demos/extract_nades.py ~/Downloads/vitality-vs-spirit-m1-mirage.dem \
  --event "IEM Cologne 2026" --match "Vitality vs Spirit" --date 2026-08-10 \
  --url "https://www.hltv.org/matches/1234567/vitality-vs-spirit-iem-cologne-2026" \
  --vod "https://www.youtube.com/watch?v=XXXXXXXX"

# сразу весь архив HLTV (.rar/.zip) или папка с демками
python3 tools/demos/extract_nades.py ~/Downloads/vitality-vs-spirit.rar --event "..." --match "..." --date 2026-08-10
python3 tools/demos/extract_nades.py ~/demos/cologne/
```

Метаданные можно положить в sidecar-файл, чтобы не писать флаги каждый раз:

* `foo.json` рядом с `foo.dem` (только для этой демки) или
* `meta.json` в папке с демками (для всех демок в ней), или
* `--meta path/to/meta.json`.

```json
{ "event": "IEM Cologne 2026", "match": "Vitality vs Spirit", "date": "2026-08-10",
  "url": "https://www.hltv.org/matches/...", "vod": "https://youtu.be/..." }
```

Порядок приоритета: флаги CLI > `foo.json` > `meta.json` > `--meta`.
Если `date` не задан, скрипт пробует вытащить его из имени файла (`2026-08-10`, `20260810`).

Полезные флаги:

| Флаг | Что делает |
|---|---|
| `--out DIR` | куда писать JSON (по умолчанию `public/data/nades/`) |
| `--players "ZywOo,donk"` | только эти игроки (ники или steamid) |
| `--types smoke,molotov` | только эти типы гранат |
| `--no-traj` | не сохранять траектории (файл получается примерно втрое меньше) |
| `--include-warmup` | не выкидывать разминку |
| `--keep-postround` | оставить броски после конца раунда |
| `--dry-run` | только статистика, без записи |

Повторный запуск на той же демке **заменяет** её броски (id стабилен:
`sha1(demo|tick|steamid)[:12]`), остальные демки в файле не трогаются.
Поэтому `public/data/nades/<map>.json` можно спокойно наполнять по одной демке.

## Режим для GitHub Actions: `--from-urls`

```bash
python3 tools/demos/extract_nades.py --from-urls tools/demos/urls.txt
```

`urls.txt`: одна строка на файл, после `|` идут JSON-метаданные (необязательно):

```
# комментарий
https://github.com/<you>/cs2-demos/releases/download/cologne-2026/vit-spirit.rar | {"event":"IEM Cologne 2026","match":"Vitality vs Spirit","date":"2026-08-10","url":"https://www.hltv.org/matches/..."}
https://example.org/demos/final-m2-inferno.dem.gz | {"event":"...","match":"...","date":"2026-08-11"}
```

Скрипт скачивает каждый URL и определяет формат по сигнатуре: `.dem`, `.zip`,
`.rar`, `.7z`, `.gz`, `.bz2`, `.xz`, `.zst`. Архивы распаковываются,
в том числе вложенные (архив внутри архива), после чего каждая `.dem`
разбирается, а результат сливается в JSON. Временные файлы удаляются,
если не задан `--keep` или `--work-dir`.

**Важно:** ссылки вида `hltv.org/download/demo/<id>` в CI почти наверняка
не сработают из-за Cloudflare (см. выше). Надёжная схема такая:
скачать архив вручную, загрузить его в Release своего репозитория
и вписать в `urls.txt` прямую ссылку на ассет Release.

Пример workflow (`.github/workflows/nades.yml`):

```yaml
name: nades
on:
  workflow_dispatch:
  push:
    paths: ["tools/demos/urls.txt"]
jobs:
  extract:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: sudo apt-get update && sudo apt-get install -y unrar || sudo apt-get install -y unar
      - run: pip install demoparser2
      - run: python3 tools/demos/extract_nades.py --from-urls tools/demos/urls.txt
      - run: |
          git config user.name "nades-bot"
          git config user.email "nades-bot@users.noreply.github.com"
          git add public/data/nades/*.json
          git diff --cached --quiet || git commit -m "nades: update from demos"
          git push
```

## Формат `public/data/nades/<map>.json`

```jsonc
{
  "map": "de_mirage",
  "updated": "2026-11-05T01:18:00+00:00",
  "throws": [{
    "id": "21025d5e4f2f",          // sha1("<demo>|<tick>|<steamid>")[:12]
    "player": "ZywOo", "steamid": "7656119...", "team": "Vitality", "side": "T",
    "type": "smoke",               // smoke | flash | he | molotov | decoy
    "round": 1, "tick": 2641,
    "time": 13.75,                 // секунд от конца фризтайма
    "throw": { "x": -170.49, "y": 573.51, "z": -70.52, "pitch": -34.32, "yaw": -153.51 },
    "land":  { "x": -1545.5, "y": 259.9, "z": -166.7 },
    "traj":  [[x, y, z], ...],     // до 40 точек полёта снаряда
    "move":  "stand",              // stand | crouch | walk | run | jump | runjump
    "speed": 0.0,                  // горизонтальная скорость игрока, юнитов/с
    "event": "...", "match": "...", "date": "YYYY-MM-DD",
    "demo": "file.dem", "url": "https://www.hltv.org/matches/...", "vod": null
  }]
}
```

* `throw.x/y/z` — **ноги** игрока (origin) в тике `weapon_fire`. Для консоли:
  `setpos {x} {y} {z}; setang {pitch} {yaw} 0`.
* `throw.pitch/yaw` — углы обзора в момент вылета гранаты (в CS2 это примерно
  на 7 тиков позже `weapon_fire`). Именно они задают направление броска:
  на тестовой демке медианная ошибка по yaw составила 0.1° (0.04° для бросков с места).
* `land`: для smoke, HE, flash и decoy это точка детонации (`*_detonate`, `decoy_started`),
  для molotov — точка возгорания (`inferno_startburn`). Если события нет
  (молотов упал в воду или в небо, граната улетела за раунд), берётся
  последняя или первая неподвижная точка снаряда.
* `move`: определяется по `is_airborne` в окне между `weapon_fire` и
  вылетом гранаты (прыжок), `duck_amount ≥ 0.5` (присед), скорости
  (< 10 — `stand`, ≤ 135 или shift — `walk`, иначе `run`). `runjump` = прыжок
  со скоростью > 135. Jumpthrow-бинд и обычный прыжок не различаются.
* `team`: клан-тег команды из демки (`m_szClanTeamname`). Если его нет
  (матчмейкинг), пишется `T`/`CT`.
* Выкидываются разминка, фризтайм и броски после `round_end` (флаг `--keep-postround` оставляет их).

## Радар и `maps.json`

`public/data/nades/maps.json` хранит трансформацию overview для каждой карты
и ссылку на радар (картинка грузится хотлинком с GitHub, в репозиторий не копируется):

```
px = (x - pos_x) / scale
py = (pos_y - y) / scale      // радар 1024×1024
```

У Nuke, Train и Vertigo есть `lower` (нижний уровень). Его радар используется,
когда `z < lower.z_max`, с теми же `pos_x/pos_y/scale`.
Значения взяты из `game/csgo/pak01_dir/resource/overviews/*.txt`
([SteamDatabase/GameTracking-CS2](https://github.com/SteamDatabase/GameTracking-CS2)).
Радары: [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons)
(выгружаются из файлов игры автоматически).

## Ограничения

* `public/data/nades/sample/de_mirage.json` — результат прогона на тестовой
  демке (матчмейкинг, **не про-игроки**). Это пример данных для разработки
  интерфейса, в раздел «Раскидки профи» его выводить не надо.

* Скрипт проверен на одной публичной демке (тестовый фикстур demoparser,
  de_mirage, матчмейкинг, 9 раундов), а не на профессиональном матче.
  Формат демок HLTV тот же (GOTV/SourceTV), но клан-теги и длина матча там другие.
* Декой в тестовой демке не встречался, поэтому ветка `decoy_started` не проверялась.
* «Раскидки» здесь — все броски из матча, включая ситуативные. Отбирать
  повторяющиеся лайнапы (кластеризация по точке броска и приземления) нужно уже
  на стороне сайта или отдельным шагом.
