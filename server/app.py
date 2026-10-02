"""Stride pilot API. Python 3.11+, standard library only."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
DB = Path(os.environ.get("STRIDE_DB", Path(__file__).with_name("stride.sqlite3")))
WIN_COINS = int(os.environ.get("WIN_COINS", "100"))
MAX_STEPS = 100000


def now_ist():
    return datetime.now(IST)


def connect():
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=10000")
    return db


def init():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users(
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS shortcut_tokens(
          user_id INTEGER PRIMARY KEY REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS step_days(
          user_id INTEGER NOT NULL REFERENCES users(id), day TEXT NOT NULL,
          steps INTEGER NOT NULL, source TEXT NOT NULL, synced_at TEXT NOT NULL,
          PRIMARY KEY(user_id,day));
        CREATE TABLE IF NOT EXISTS settlements(
          day TEXT PRIMARY KEY, settled_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS results(
          day TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
          steps INTEGER, rank INTEGER, status TEXT NOT NULL,
          PRIMARY KEY(day,user_id));
        CREATE TABLE IF NOT EXISTS ledger(
          id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          day TEXT NOT NULL, kind TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
          coins INTEGER NOT NULL DEFAULT 0,
          UNIQUE(user_id,day,kind));
        """)


class Problem(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def register(name, email, password):
    name, email = str(name).strip(), str(email).strip().lower()
    if not (1 <= len(name) <= 60 and "@" in email and len(email) <= 254
            and isinstance(password, str) and len(password) >= 10):
        raise Problem(400, "Provide a name, valid email and password of at least 10 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    with connect() as db:
        try:
            cur = db.execute("INSERT INTO users(name,email,password_hash,created_at) VALUES(?,?,?,?)",
                (name, email, salt.hex()+":"+digest.hex(), now_ist().isoformat()))
        except sqlite3.IntegrityError:
            raise Problem(409, "Email is already registered")
        return issue(db, cur.lastrowid)


def issue(db, uid):
    raw = secrets.token_urlsafe(32)
    expiry = (now_ist() + timedelta(days=35)).isoformat()
    db.execute("INSERT INTO sessions VALUES(?,?,?)",
        (hashlib.sha256(raw.encode()).hexdigest(), uid, expiry))
    user = db.execute("SELECT id,name,email FROM users WHERE id=?", (uid,)).fetchone()
    return {"token": raw, "user": dict(user), "expiresAt": expiry}


def login(email, password):
    with connect() as db:
        row = db.execute("SELECT * FROM users WHERE email=?", (str(email).strip().lower(),)).fetchone()
        if row and isinstance(password, str):
            salt, expected = row["password_hash"].split(":")
            actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1)
            if hmac.compare_digest(actual, bytes.fromhex(expected)):
                return issue(db, row["id"])
    raise Problem(401, "Invalid credentials")


def auth(header):
    if not header.startswith("Bearer "):
        raise Problem(401, "Sign in required")
    key = hashlib.sha256(header[7:].encode()).hexdigest()
    with connect() as db:
        user = db.execute("""SELECT u.id,u.name,u.email FROM sessions s
            JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?""",
            (key, now_ist().isoformat())).fetchone()
    if not user:
        raise Problem(401, "Session expired")
    return dict(user)


def create_shortcut_token(uid):
    raw = secrets.token_urlsafe(32)
    expiry = (now_ist() + timedelta(days=45)).isoformat()
    with connect() as db:
        db.execute("""INSERT INTO shortcut_tokens(user_id,token_hash,expires_at)
            VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET
            token_hash=excluded.token_hash,expires_at=excluded.expires_at""",
            (uid, hashlib.sha256(raw.encode()).hexdigest(), expiry))
    return {"token": raw, "expiresAt": expiry}


def shortcut_auth(header):
    if not header.startswith("Bearer ") or not header[7:]:
        raise Problem(401, "Shortcut token required")
    key = hashlib.sha256(header[7:].encode()).hexdigest()
    with connect() as db:
        row = db.execute("SELECT user_id FROM shortcut_tokens WHERE token_hash=? AND expires_at>?",
                         (key, now_ist().isoformat())).fetchone()
    if not row:
        raise Problem(401, "Shortcut token expired or revoked")
    return row["user_id"]


def shortcut_status(uid):
    with connect() as db:
        row = db.execute("SELECT expires_at FROM shortcut_tokens WHERE user_id=?", (uid,)).fetchone()
    return {"connected": bool(row and row["expires_at"] > now_ist().isoformat()),
            "expiresAt": row["expires_at"] if row else None}


def day_allowed(day, clock):
    try:
        parsed = datetime.strptime(day, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise Problem(400, "Invalid date")
    today = clock.date()
    if parsed == today or (parsed == today-timedelta(days=1)
                           and clock.hour == 0 and clock.minute < 30):
        return
    raise Problem(409, "Day is closed or outside the sync window")


def sync(uid, day, steps, source, clock=None):
    clock = clock or now_ist()
    day_allowed(day, clock)
    if type(steps) is not int or not 0 <= steps <= MAX_STEPS:
        raise Problem(400, "Invalid steps")
    if source not in ("health_connect", "healthkit"):
        raise Problem(400, "Invalid health source")
    with connect() as db:
        db.execute("""INSERT INTO step_days(user_id,day,steps,source,synced_at)
            VALUES(?,?,?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET
            steps=excluded.steps,source=excluded.source,synced_at=excluded.synced_at""",
            (uid, day, steps, source, clock.isoformat()))
    return {"day": day, "steps": steps, "syncedAt": clock.isoformat()}


def settle(day, clock=None):
    clock = clock or now_ist()
    try:
        parsed = datetime.strptime(day, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise Problem(400, "Invalid date")
    if parsed >= clock.date() or (parsed == clock.date()-timedelta(days=1)
                                   and clock.hour == 0 and clock.minute < 30):
        raise Problem(409, "Wait until the 12:30 AM IST cutoff")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM settlements WHERE day=?", (day,)).fetchone():
            return {"day": day, "alreadySettled": True}
        users = db.execute("SELECT id FROM users WHERE date(created_at)<=?", (day,)).fetchall()
        rows = db.execute("SELECT user_id,steps FROM step_days WHERE day=? ORDER BY steps DESC,user_id", (day,)).fetchall()
        eligible = {r["user_id"]: r["steps"] for r in rows}
        if len(eligible) >= 2:
            high, low = max(eligible.values()), min(eligible.values())
            winners = [u for u, steps in eligible.items() if steps == high]
            losers = [u for u, steps in eligible.items() if steps == low]
            # A tied last place is not penalized. Top ties split the prize.
            for uid in winners:
                db.execute("INSERT INTO ledger(user_id,day,kind,coins) VALUES(?,?,?,?)",
                           (uid, day, "winner", WIN_COINS // len(winners)))
            if len(losers) == 1 and high != low:
                uid = losers[0]
                db.execute("INSERT INTO ledger(user_id,day,kind,points) VALUES(?,?,?,?)",
                           (uid, day, "last", -10))
                streak = 1
                while db.execute("SELECT 1 FROM ledger WHERE user_id=? AND day=? AND kind='last'",
                                 (uid, (parsed-timedelta(days=streak)).isoformat())).fetchone():
                    streak += 1
                if streak % 3 == 0:
                    db.execute("INSERT INTO ledger(user_id,day,kind,points) VALUES(?,?,?,?)",
                               (uid, day, "three_last", -50))
        for user in users:
            uid = user["id"]
            steps = eligible.get(uid)
            rank = (1 + sum(n > steps for n in eligible.values())) if steps is not None else None
            db.execute("INSERT INTO results VALUES(?,?,?,?,?)",
                       (day, uid, steps, rank, "verified" if steps is not None else "unverified"))
        db.execute("INSERT INTO settlements VALUES(?,?)", (day, clock.isoformat()))
    return {"day": day, "alreadySettled": False, "verified": len(eligible)}


def leaderboard(period, day, uid):
    if period not in ("day", "week", "month"):
        raise Problem(400, "Invalid period")
    try:
        target = datetime.strptime(day, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise Problem(400, "Invalid date")
    if target > now_ist().date():
        raise Problem(400, "Future date")
    start = target if period == "day" else (
        target-timedelta(days=target.weekday()) if period == "week" else target.replace(day=1))
    with connect() as db:
        rows = db.execute("""SELECT u.id,u.name,SUM(s.steps) steps,MAX(s.synced_at) last_sync
            FROM step_days s JOIN users u ON u.id=s.user_id
            WHERE s.day BETWEEN ? AND ? GROUP BY u.id ORDER BY steps DESC,u.id""",
            (start.isoformat(), target.isoformat())).fetchall()
        settled = bool(db.execute("SELECT 1 FROM settlements WHERE day=?", (day,)).fetchone())
        wallet = db.execute("SELECT COALESCE(SUM(points),0) points,COALESCE(SUM(coins),0) coins FROM ledger WHERE user_id=?", (uid,)).fetchone()
    return {"period": period, "from": start.isoformat(), "through": day,
            "settled": settled if period == "day" else False, "wallet": dict(wallet),
            "entries": [{"rank": 1+sum(x["steps"] > r["steps"] for x in rows), "id": r["id"],
                         "name": r["name"], "steps": r["steps"], "lastSync": r["last_sync"]}
                        for r in rows]}


class Handler(BaseHTTPRequestHandler):
    def static(self, name, mime):
        payload = (Path(__file__).with_name("web") / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(payload)

    def reply(self, code, data):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def dispatch(self, method):
        path = urlsplit(self.path)
        query = parse_qs(path.query)
        if method == "POST":
            length = int(self.headers.get("Content-Length", "0"))
            if length > 8192:
                raise Problem(413, "Request too large")
            try:
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError()
            except (ValueError, json.JSONDecodeError):
                raise Problem(400, "Invalid JSON")
            if path.path == "/auth/register":
                return self.reply(201, register(body.get("name"), body.get("email"), body.get("password")))
            if path.path == "/auth/login":
                return self.reply(200, login(body.get("email"), body.get("password")))
            if path.path == "/shortcut/steps":
                uid = shortcut_auth(self.headers.get("Authorization", ""))
                day = body.get("day", now_ist().date().isoformat())
                return self.reply(200, sync(uid, day, body.get("steps"), "healthkit"))
            user = auth(self.headers.get("Authorization", ""))
            if path.path == "/steps":
                return self.reply(200, sync(user["id"], body.get("day"), body.get("steps"), body.get("source")))
            if path.path == "/shortcut/token":
                return self.reply(201, create_shortcut_token(user["id"]))
            if path.path == "/shortcut/revoke":
                with connect() as db:
                    db.execute("DELETE FROM shortcut_tokens WHERE user_id=?", (user["id"],))
                return self.reply(200, {"connected": False})
        else:
            static = {"/": ("index.html", "text/html; charset=utf-8"),
                      "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                      "/style.css": ("style.css", "text/css; charset=utf-8")}
            if path.path in static:
                return self.static(*static[path.path])
            if path.path == "/health":
                return self.reply(200, {"ok": True})
            user = auth(self.headers.get("Authorization", ""))
            if path.path == "/me":
                return self.reply(200, user)
            if path.path == "/shortcut/status":
                return self.reply(200, shortcut_status(user["id"]))
            if path.path == "/leaderboard":
                return self.reply(200, leaderboard(query.get("period", ["day"])[0],
                    query.get("day", [now_ist().date().isoformat()])[0], user["id"]))
        raise Problem(404, "Not found")

    def do_GET(self):
        self.handle_method("GET")

    def do_POST(self):
        self.handle_method("POST")

    def handle_method(self, method):
        try:
            self.dispatch(method)
        except Problem as e:
            self.reply(e.status, {"error": e.message})
        except Exception:
            print("Request failed", file=sys.stderr)
            self.reply(500, {"error": "Internal server error"})


if __name__ == "__main__":
    init()
    if len(sys.argv) > 1 and sys.argv[1] == "settle":
        print(json.dumps(settle(sys.argv[2] if len(sys.argv)>2 else
                                (now_ist().date()-timedelta(days=1)).isoformat())))
    else:
        port = int(os.environ.get("PORT", "8000"))
        print(f"Stride API listening on {port}")
        ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
