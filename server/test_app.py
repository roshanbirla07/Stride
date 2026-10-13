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
        with app.connect() as db:
            db.execute("UPDATE group_members SET effective_day=?", (day,))
        from unittest.mock import patch
        with patch.object(app, "now_ist", return_value=datetime(2026, 9, 30, 23, 59, 59, tzinfo=IST)):
            app.sync(self.ids[0], day, 123, "healthkit")
        with self.assertRaises(app.Problem):
            app.sync(self.ids[0], day, 999, "healthkit", datetime(2026, 10, 1, 0, 0, tzinfo=IST))
        with self.assertRaises(app.Problem):
            app.settle(day, datetime(2026, 9, 30, 23, 59, 59, tzinfo=IST))
        self.assertFalse(app.settle(day, datetime(2026, 10, 1, 0, 0, tzinfo=IST))["alreadySettled"])

    def test_full_period_total_replaces_missing_days_and_can_decrease(self):
        day = app.now_ist().date().isoformat()
        uid = self.ids[0]
        app.sync(uid, day, 123, "healthkit")
        for period in ("day", "week", "month"):
            start, _ = app.period_range(period, day)
            first = start.isoformat()
            total = 700 if period == "day" else 17000
            board = app.refresh_total(uid, self.gid, period, day, first, total, "healthkit")
            self.assertEqual(board["entries"][0]["steps"], total)
            board = app.refresh_total(uid, self.gid, period, day, first, 50, "healthkit")
            self.assertEqual(board["entries"][0]["steps"], 50)
        with app.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM health_totals").fetchone()[0], 3)
            self.assertEqual(db.execute("SELECT count(*) FROM step_days").fetchone()[0], 0)

    def test_period_snapshot_ties_membership_and_rollover(self):
        from unittest.mock import patch
        clock = datetime(2026, 10, 12, 15, tzinfo=IST)  # Monday
        with patch.object(app, "now_ist", return_value=clock):
            with app.connect() as db:
                db.execute("UPDATE group_members SET effective_day='2026-10-02'")
            for uid in self.ids[:2]:
                app.refresh_total(uid, self.gid, "month", "2026-10-12", "2026-10-01", 5000, "healthkit")
            board = app.leaderboard("month", "2026-10-12", self.ids[0], self.gid)
            self.assertEqual([e["rank"] for e in board["entries"]], [1, 1])
            self.assertEqual(board["from"], "2026-10-01")
            self.assertEqual(board["entries"][0]["through"], "2026-10-12")
            self.assertEqual(app.period_range("week", "2026-10-12")[0].isoformat(), "2026-10-12")
            with self.assertRaises(app.Problem):
                app.refresh_total(self.ids[0], self.gid, "month", "2026-10-12", "2026-10-02", 100, "healthkit")
            with self.assertRaises(app.Problem):
                app.refresh_total(self.ids[0], self.gid, "day", "2026-10-12", "2026-10-12", True, "healthkit")
        with patch.object(app, "now_ist", return_value=datetime(2026, 11, 1, 0, tzinfo=IST)):
            self.assertEqual(app.leaderboard("month", "2026-11-01", self.ids[0], self.gid)["entries"], [])

    def test_delayed_refresh_does_not_overwrite_newer_total(self):
        from unittest.mock import patch
        clock = datetime(2026, 10, 12, 15, tzinfo=IST)
        with patch.object(app, "now_ist", return_value=clock):
            with app.connect() as db:
                db.execute("UPDATE group_members SET effective_day='2026-10-01'")
            app.refresh_total(self.ids[0], self.gid, "day", "2026-10-12", "2026-10-12", 900,
                              "healthkit", clock.isoformat())
            board = app.refresh_total(self.ids[0], self.gid, "day", "2026-10-12", "2026-10-12", 500,
                                      "healthkit", (clock-timedelta(minutes=1)).isoformat())
            self.assertEqual(board["entries"][0]["steps"], 900)

    def test_latest_day_replaces_previous_day_without_history_writes(self):
        from unittest.mock import patch
        with app.connect() as db:
            db.execute("UPDATE group_members SET effective_day='2026-10-01'")
        for day, steps in (("2026-10-11", 500), ("2026-10-12", 100)):
            clock = datetime.fromisoformat(day+"T15:00:00+05:30")
            with patch.object(app, "now_ist", return_value=clock):
                app.sync(self.ids[0], day, steps, "healthkit")
                self.assertEqual(app.leaderboard("day", day, self.ids[0])["entries"][0]["steps"], steps)
        with app.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM health_totals").fetchone()[0], 1)
            for table in ("step_days", "results", "ledger", "group_results", "group_ledger", "group_settlements"):
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0], 0)

    def test_new_member_uses_full_period_and_reuses_totals_across_groups(self):
        from unittest.mock import patch
        clock = datetime(2026, 10, 13, 15, tzinfo=IST)
        with patch.object(app, "now_ist", return_value=clock):
            uid = app.register("Newcomer", "new@example.com", "long-password-123")["user"]["id"]
            app.join_group(uid, app.groups_for(self.ids[0])["groups"][0]["code"])
            for period, start, total in (("day", "2026-10-13", 9000),
                                        ("week", "2026-10-12", 19000),
                                        ("month", "2026-10-01", 99000)):
                board = app.refresh_total(uid, self.gid, period, "2026-10-13", start, total, "healthkit")
                self.assertEqual(board["entries"][0]["steps"], total)
                self.assertEqual(board["entries"][0]["rank"], 1)
            second = app.create_group(self.ids[0], "Home")["id"]
            code = next(g["code"] for g in app.groups_for(self.ids[0])["groups"] if g["id"]==second)
            app.join_group(uid, code)
            self.assertEqual(app.leaderboard("month", "2026-10-13", uid, second)["entries"][0]["steps"], 99000)
            # Updating through one group changes the user's rank total everywhere.
            app.refresh_total(uid, second, "month", "2026-10-13", "2026-10-01", 110000, "healthkit")
            self.assertEqual(app.leaderboard("month", "2026-10-13", uid, self.gid)["entries"][0]["steps"], 110000)
            with app.connect() as db:
                self.assertEqual(db.execute("SELECT count(*) FROM health_totals WHERE user_id=?", (uid,)).fetchone()[0], 3)
                self.assertEqual(db.execute("SELECT count(*) FROM step_days").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT count(*) FROM period_totals").fetchone()[0], 0)

    def test_upgrade_imports_only_complete_legacy_snapshots(self):
        from unittest.mock import patch
        clock = datetime(2026, 10, 13, 15, tzinfo=IST)
        with patch.object(app, "now_ist", return_value=clock):
            with app.connect() as db:
                db.execute("UPDATE group_members SET effective_day='2026-09-01' WHERE user_id=?", (self.ids[0],))
                db.execute("UPDATE group_members SET effective_day='2026-10-10' WHERE user_id=?", (self.ids[1],))
                db.executemany("INSERT INTO period_totals VALUES(?,?,?,?,?,?,?,?)", [
                    (self.gid, self.ids[0], "month", "2026-10-01", "2026-10-13", 99000, "healthkit", clock.isoformat()),
                    (self.gid, self.ids[1], "month", "2026-10-01", "2026-10-13", 5000, "healthkit", clock.isoformat())])
            app.init(); app.init()
            entries = app.leaderboard("month", "2026-10-13", self.ids[0], self.gid)["entries"]
            self.assertEqual([e["id"] for e in entries], [self.ids[0]])
            app.refresh_total(self.ids[1], self.gid, "month", "2026-10-13", "2026-10-01", 100000, "healthkit")
            self.assertEqual(app.leaderboard("month", "2026-10-13", self.ids[1], self.gid)["entries"][0]["id"], self.ids[1])

    def test_refresh_requires_group_membership(self):
        gid = app.create_group(self.ids[0], "Private")["id"]
        day = app.now_ist().date().isoformat()
        with self.assertRaises(app.Problem):
            app.refresh_total(self.ids[1], gid, "day", day, day, 1, "healthkit")

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

    def test_join_starts_immediately_and_code_rotation(self):
        gid = app.create_group(self.ids[0], "Office")["id"]
        old_code = next(g["code"] for g in app.groups_for(self.ids[0])["groups"] if g["id"]==gid)
        new_code = app.rotate_group_code(self.ids[0],gid)["code"]
        with self.assertRaises(app.Problem):
            app.join_group(self.ids[2],old_code)
        app.join_group(self.ids[2],new_code)
        today=app.now_ist().date().isoformat()
        app.sync(self.ids[2],today,9000,"healthkit")
        self.assertEqual(app.leaderboard("day",today,self.ids[2],gid)["entries"][0]["steps"],9000)
        joined=next(g for g in app.groups_for(self.ids[2])["groups"] if g["id"]==gid)
        self.assertEqual(joined["effectiveDay"],today)
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
