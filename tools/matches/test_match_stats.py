#!/usr/bin/env python3
"""Tests for match_stats.compute() on events derived from a real CS2 demo
(tests/fixtures/mirage.events.json.gz: Vitality vs …, de_mirage 13:5, made with
`match_stats.py <demo> --dump-events`). The game's own per-player counters stored in the
fixture (kills_total, damage_total, …) are the reference. Run: python3 -I tools/matches/test_match_stats.py"""
import gzip
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import match_stats as M  # noqa: E402

FIXTURE = HERE.parent.parent / "tests" / "fixtures" / "mirage.events.json.gz"
ZYWOO = "76561198113666193"
S1ZZI = "76561199001538362"


def load():
    with gzip.open(FIXTURE, "rt", encoding="utf-8") as f:
        return json.load(f)


class ComputeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ev = load()
        cls.res = {sid: M.compute(cls.ev, sid) for sid in cls.ev["roster"]}

    def test_match_level(self):
        r = self.res[ZYWOO]
        self.assertEqual(r["map"], "de_mirage")
        self.assertEqual(r["rounds"], 18)
        self.assertEqual(r["score"], [13, 5])
        self.assertEqual(r["result"], "W")
        self.assertEqual(len(r["rh"]), 18)
        self.assertEqual(r["rh"].count("W"), 13)
        self.assertEqual(r["mode"], "other")  # tournament server: no matchmaking rank type
        self.assertIsNone(r["rating"])
        self.assertTrue(30 * 60 < r["duration"] < 45 * 60)
        other = self.res[S1ZZI]
        self.assertEqual(other["score"], [5, 13])
        self.assertEqual(other["result"], "L")
        self.assertEqual(other["rh"], "".join("L" if c == "W" else "W" for c in r["rh"]))

    def test_scoreboard(self):
        r = self.res[ZYWOO]
        self.assertEqual(len(r["players"]), 10)
        self.assertEqual(sum(1 for p in r["players"] if p["team"] == 0), 5)
        self.assertEqual(r["players"][0]["team"], 0)
        self.assertIn(ZYWOO, [p["sid"] for p in r["players"] if p["team"] == 0])
        self.assertIn(S1ZZI, [p["sid"] for p in r["players"] if p["team"] == 1])
        names = {p["sid"]: p["name"] for p in r["players"]}
        self.assertEqual(names[ZYWOO], "ZywOo")

    def test_against_game_counters(self):
        # K/D/A/HS and multikill rounds must equal the game's own counters exactly;
        # damage (capped at remaining HP) within 2 %, utility damage within 30 HP
        for sid, p in self.ev["players"].items():
            c = p["c"]
            me = self.res[sid]["me"]
            with self.subTest(player=p["name"]):
                self.assertEqual(me["k"], c["k"])
                self.assertEqual(me["d"], c["d"])
                self.assertEqual(me["a"], c["a"])
                self.assertEqual(me["hs"], c["hs"])
                self.assertEqual(me["mk"]["3"], c["3k"])
                self.assertEqual(me["mk"]["4"], c["4k"])
                self.assertEqual(me["mk"]["5"], c["5k"])
                self.assertEqual(me["mvp"], c["mvp"])
                self.assertEqual(me["ef"], c["ef"])
                self.assertLessEqual(abs(me["dmg"] - c["dmg"]), max(3, 0.02 * c["dmg"]))
                self.assertLessEqual(abs(me["ud"] - c["ud"]), 30)
        exact = sum(1 for sid, p in self.ev["players"].items() if self.res[sid]["me"]["dmg"] == p["c"]["dmg"])
        self.assertGreaterEqual(exact, 8)

    def test_owner_details(self):
        me = self.res[ZYWOO]["me"]
        self.assertEqual((me["k"], me["d"], me["a"], me["hs"]), (19, 9, 6, 8))
        self.assertEqual(me["dmg"], 1641)
        self.assertAlmostEqual(me["adr"], round(1641 / 18, 1))
        self.assertEqual(sum(w["k"] for w in me["weapons"].values()), me["k"])
        self.assertEqual(sum(w["hs"] for w in me["weapons"].values()), me["hs"])
        self.assertEqual(sum(w["dmg"] for w in me["weapons"].values()), me["dmg"])
        self.assertEqual(sum(w["shots"] for w in me["weapons"].values()), me["shots"])
        self.assertEqual(sum(w["hits"] for w in me["weapons"].values()), me["hits"])
        self.assertEqual(me["weapons"]["awp"]["k"], 11)
        self.assertNotIn("m4a1", me["weapons"])  # ZywOo never used an M4A4
        self.assertTrue(0 < me["acc"] < 100)
        self.assertLessEqual(me["hh"], me["hits"])
        self.assertTrue(0 < me["kast"] <= 100)
        self.assertGreaterEqual(me["fk"], 1)
        self.assertEqual(me["ud"], me["weapons"]["hegrenade"]["dmg"] + me["weapons"]["molotov"]["dmg"])
        for x, (att, won) in me["cl"].items():
            self.assertTrue(1 <= int(x) <= 5 and 0 <= won <= att)

    def test_totals_consistent(self):
        all_k = sum(self.res[s]["me"]["k"] for s in self.ev["roster"])
        all_fk = sum(self.res[s]["me"]["fk"] for s in self.ev["roster"])
        all_fd = sum(self.res[s]["me"]["fd"] for s in self.ev["roster"])
        self.assertEqual(all_fk, 18)  # one opening kill per round
        self.assertEqual(all_fk, all_fd)
        enemy_kills = sum(1 for d in self.ev["deaths"] if d[1] and d[1] != d[2] and d[7] != d[8])
        self.assertEqual(all_k, enemy_kills)
        # M4A1-S vs M4A4 damage told apart by the attacker's active weapon
        mezii = self.res["76561197973140692"]["me"]["weapons"]
        self.assertIn("m4a1_silencer", mezii)
        self.assertGreater(mezii["m4a1_silencer"]["dmg"], 0)

    def test_clutch_and_kast_rules(self):
        # 1v2 in a tiny synthetic round: A (team 2) survives alone vs two, kills both
        rounds = [[100, 1000, 2, "ct_killed"]]
        roster = {s: [[2 if s in "ab" else 3, 1, 1 if s == "a" else 0]] for s in "abcd"}
        sid = {"a": "76561190000000001", "b": "76561190000000002", "c": "76561190000000003", "d": "76561190000000004"}
        roster = {sid[k]: v for k, v in roster.items()}
        deaths = [
            [200, sid["c"], sid["b"], "", 0, 0, "ak47", 3, 2, 0],
            [300, sid["a"], sid["c"], "", 1, 0, "ak47", 2, 3, 0],  # trade within 5 s → b gets KAST
            [900, sid["a"], sid["d"], "", 0, 0, "ak47", 2, 3, 0],
        ]
        ev = {"rounds": rounds, "roster": roster, "deaths": deaths, "hurts": [], "shots": [], "players": {}, "start": 100}
        a = M.compute(ev, sid["a"])
        self.assertEqual(a["me"]["cl"], {"2": [1, 1]})
        self.assertEqual(a["me"]["tk"], 1)
        self.assertEqual(a["me"]["mk"]["2"], 1)
        self.assertEqual(a["score"], [1, 0])
        b = M.compute(ev, sid["b"])
        self.assertEqual(b["me"]["kast"], 100.0)  # traded
        c = M.compute(ev, sid["c"])
        self.assertEqual(c["me"]["kast"], 100.0)  # had a kill
        d = M.compute(ev, sid["d"])
        self.assertEqual(d["me"]["kast"], 0.0)
        self.assertEqual(d["me"]["cl"], {"1": [1, 0]})  # d was last alive vs a: lost 1v1

    def test_rating_and_mode(self):
        ev = load()
        for sid, p in ev["players"].items():
            p["r0"] = [15230, 15480, 14990, 15235, 11, 120]
        r = M.compute(ev, ZYWOO)
        self.assertEqual(r["mode"], "premier")
        self.assertEqual(r["rating"], {"type": "premier", "before": 15230, "after": 15480, "delta": 250, "pred": True, "wins": 120})
        lost = M.compute(ev, S1ZZI)
        self.assertEqual(lost["rating"]["after"], 14990)
        self.assertEqual(lost["rating"]["delta"], -240)
        for p in ev["players"].values():
            p["r0"] = [9, 9, 8, 9, 12, 40]
        self.assertEqual(M.compute(ev, ZYWOO)["mode"], "competitive")

    def test_weapon_names(self):
        self.assertEqual(M.norm_weapon("weapon_knife_butterfly"), "knife")
        self.assertEqual(M.norm_weapon("bayonet"), "knife")
        self.assertEqual(M.norm_weapon("m4a1", "M4A1-S"), "m4a1_silencer")
        self.assertEqual(M.norm_weapon("m4a1", "M4A4"), "m4a1")
        self.assertEqual(M.norm_weapon("hkp2000", "USP-S"), "usp_silencer")
        self.assertEqual(M.norm_weapon("deagle", "R8 Revolver"), "revolver")
        self.assertEqual(M.norm_weapon("inferno"), "molotov")
        self.assertEqual(M.norm_weapon("weapon_incgrenade"), "molotov")
        self.assertEqual(M.norm_weapon("weapon_ak47"), "ak47")


if __name__ == "__main__":
    unittest.main(verbosity=1)
