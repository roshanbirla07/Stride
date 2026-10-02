import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import app

IST = ZoneInfo("Asia/Kolkata")


class CoreFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        app.DB = Path(self.tmp.name) / "test.sqlite3"
        app.init()
        self.ids = [app.register(name, f"{name}@example.com", "long-password-123")["user"]["id"]
                    for name in ("Ada", "Bela", "Chao")]
        self.gid = app.create_group(self.ids[0], "Crew")["id"]
        for uid in self.ids[1:]:
            app.join_group(uid, app.groups_for(self.ids[0])["groups"][0]["code"])
        with app.connect() as db:
            db.execute("UPDATE group_members SET effective_day=?", ((app.now_ist().date()-timedelta(days=10)).isoformat(),))

    def tearDown(self):
        self.tmp.cleanup()

    def test_cutoff_idempotency_and_streak(self):
        today = app.now_ist().date()
        with app.connect() as db:
            db.execute("UPDATE users SET created_at=?", ((today-timedelta(days=5)).isoformat(),))
        for i in (4, 3, 2):
            day = (today - timedelta(days=i)).isoformat()
            # Test historical records directly; public uploads reject closed days.
            with app.connect() as db:
                db.executemany("INSERT INTO step_days VALUES(?,?,?,?,?)",
                    [(self.ids[0], day, 12000, "healthkit", app.now_ist().isoformat()),
                     (self.ids[1], day, 5000, "health_connect", app.now_ist().isoformat())])
            result = app.settle(day)
            self.assertEqual(result["verified"], 2)
            self.assertTrue(app.settle(day)["alreadySettled"])
        with app.connect() as db:
            a = db.execute("SELECT SUM(coins) FROM group_ledger WHERE user_id=?", (self.ids[0],)).fetchone()[0]
            b = db.execute("SELECT SUM(points) FROM group_ledger WHERE user_id=?", (self.ids[1],)).fetchone()[0]
            missing = db.execute("SELECT status FROM group_results WHERE user_id=? LIMIT 1", (self.ids[2],)).fetchone()[0]
        self.assertEqual(a, 300)
        self.assertEqual(b, -80)
        self.assertEqual(missing, "unverified")

    def test_sync_cutoff(self):
        day = "2026-09-30"
        app.sync(self.ids[0], day, 123, "healthkit", datetime(2026, 10, 1, 0, 29, tzinfo=IST))
        with self.assertRaises(app.Problem):
            app.sync(self.ids[0], day, 999, "healthkit", datetime(2026, 10, 1, 0, 30, tzinfo=IST))
        with self.assertRaises(app.Problem):
            app.settle(day, datetime(2026, 10, 1, 0, 29, tzinfo=IST))
        self.assertFalse(app.settle(day, datetime(2026, 10, 1, 0, 30, tzinfo=IST))["alreadySettled"])

    def test_tied_last_no_penalty(self):
        day = (app.now_ist().date()-timedelta(days=2)).isoformat()
        with app.connect() as db:
            db.executemany("INSERT INTO step_days VALUES(?,?,?,?,?)",
                [(self.ids[0],day,9000,"healthkit","x"),
                 (self.ids[1],day,1000,"healthkit","x"),
                 (self.ids[2],day,1000,"healthkit","x")])
        app.settle(day)
        with app.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM group_ledger WHERE points<0").fetchone()[0],0)

    def test_shortcut_token_rotation_and_scope(self):
        uid = self.ids[0]
        first = app.create_shortcut_token(uid)["token"]
        self.assertEqual(app.shortcut_auth("Bearer " + first), uid)
        self.assertTrue(app.shortcut_status(uid)["connected"])
        second = app.create_shortcut_token(uid)["token"]
        with self.assertRaises(app.Problem):
            app.shortcut_auth("Bearer " + first)
        self.assertEqual(app.shortcut_auth("Bearer " + second), uid)
        today = app.now_ist().date().isoformat()
        app.sync(app.shortcut_auth("Bearer " + second), today, 5432, "healthkit")
        board = app.leaderboard("day", today, uid)
        self.assertEqual(board["entries"][0]["steps"], 5432)
        with app.connect() as db:
            db.execute("DELETE FROM shortcut_tokens WHERE user_id=?", (uid,))
        with self.assertRaises(app.Problem):
            app.shortcut_auth("Bearer " + second)

    def test_two_groups_one_upload_separate_rewards_and_membership(self):
        second = app.create_group(self.ids[1], "Home")["id"]
        code = app.groups_for(self.ids[1])["groups"][1]["code"]
        app.join_group(self.ids[0], code)
        today = app.now_ist().date()
        with app.connect() as db:
            db.execute("UPDATE group_members SET effective_day=? WHERE group_id=?",
                       ((today-timedelta(days=4)).isoformat(), second))
        day = (today-timedelta(days=2)).isoformat()
        with app.connect() as db:
            db.executemany("INSERT INTO step_days VALUES(?,?,?,?,?)",
                [(self.ids[0],day,10000,"healthkit","x"),
                 (self.ids[1],day,2000,"health_connect","x"),
                 (self.ids[2],day,12000,"healthkit","x")])
        self.assertEqual(app.leaderboard("day",day,self.ids[0],self.gid)["entries"][0]["id"],self.ids[2])
        self.assertEqual(app.leaderboard("day",day,self.ids[0],second)["entries"][0]["id"],self.ids[0])
        self.assertEqual(app.settle(day)["groupsSettled"],2)
        self.assertEqual(app.leaderboard("day",day,self.ids[0],second)["wallet"]["coins"],100)
        self.assertEqual(app.leaderboard("day",day,self.ids[1],second)["wallet"]["points"],-10)
        self.assertEqual(app.leaderboard("day",day,self.ids[1],self.gid)["wallet"]["points"],-10)
        with self.assertRaises(app.Problem):
            app.leaderboard("day",day,self.ids[2],second)
        self.assertTrue(app.settle(day)["alreadySettled"])

    def test_join_starts_tomorrow_and_code_rotation(self):
        gid = app.create_group(self.ids[0], "Office")["id"]
        old_code = next(g["code"] for g in app.groups_for(self.ids[0])["groups"] if g["id"]==gid)
        new_code = app.rotate_group_code(self.ids[0],gid)["code"]
        with self.assertRaises(app.Problem):
            app.join_group(self.ids[2],old_code)
        app.join_group(self.ids[2],new_code)
        today=app.now_ist().date().isoformat()
        app.sync(self.ids[2],today,9000,"healthkit")
        self.assertEqual(app.leaderboard("day",today,self.ids[2],gid)["entries"],[])
        with self.assertRaises(app.Problem):
            app.rotate_group_code(self.ids[2],gid)

    def test_migrate_existing_global_results_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            previous = app.DB
            try:
                app.DB=Path(tmp)/"old.sqlite3"; app.init()
                uid=app.register("Legacy","legacy@example.com","long-password-123")["user"]["id"]
                day=(app.now_ist().date()-timedelta(days=2)).isoformat()
                with app.connect() as db:
                    db.execute("INSERT INTO settlements VALUES(?,?)",(day,"x"))
                    db.execute("INSERT INTO results VALUES(?,?,?,?,?)",(day,uid,5000,1,"verified"))
                    db.execute("INSERT INTO ledger(user_id,day,kind,coins) VALUES(?,?,?,?)",(uid,day,"winner",100))
                app.init(); app.init()
                board=app.leaderboard("day",day,uid)
                self.assertTrue(board["settled"])
                self.assertEqual(board["wallet"]["coins"],100)
                with app.connect() as db:
                    self.assertEqual(db.execute("SELECT count(*) FROM group_ledger").fetchone()[0],1)
            finally: app.DB=previous


if __name__ == "__main__":
    unittest.main()
