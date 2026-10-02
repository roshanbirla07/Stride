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
            a = db.execute("SELECT SUM(coins) FROM ledger WHERE user_id=?", (self.ids[0],)).fetchone()[0]
            b = db.execute("SELECT SUM(points) FROM ledger WHERE user_id=?", (self.ids[1],)).fetchone()[0]
            missing = db.execute("SELECT status FROM results WHERE user_id=? LIMIT 1", (self.ids[2],)).fetchone()[0]
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
            self.assertEqual(db.execute("SELECT count(*) FROM ledger WHERE points<0").fetchone()[0],0)

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


if __name__ == "__main__":
    unittest.main()
