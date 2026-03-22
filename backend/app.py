from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_mail import Mail, Message
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import pandas as pd
import warnings
import os
import re
import math
import logging
import secrets
from datetime import datetime, timedelta
from groq import Groq
from dotenv import load_dotenv
import bcrypt
import jwt as pyjwt
from functools import wraps

load_dotenv()
warnings.filterwarnings("ignore")

# ── JWT Secret — MUST be set in .env, no weak default ──
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise EnvironmentError(
        "JWT_SECRET is not set.\n"
        "Add a strong random secret to your .env file:\n"
        "  JWT_SECRET=your-long-random-secret-here"
    )
JWT_EXPIRY = 8  # hours

# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)

# ── Validate env vars ──
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise EnvironmentError(
        "GROQ_API_KEY is not set.\n"
        "Add it to your .env file:\n"
        "  GROQ_API_KEY=gsk_your_key_here"
    )

# ── Groq client ──
groq_client = Groq(api_key=GROQ_API_KEY)

# ── Flask app ──
app = Flask(__name__)
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
CORS(app, resources={r"/*": {
    "origins":           ALLOWED_ORIGINS,
    "allow_headers":     ["Content-Type", "Authorization", "X-User-Email"],
    "expose_headers":    ["Content-Type"],
    "methods":           ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "supports_credentials": False
}})

# ── Handle OPTIONS preflight globally ──
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        from flask import make_response
        resp = make_response()
        resp.headers["Access-Control-Allow-Origin"]  = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-User-Email"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        return resp

# ── Rate Limiter ──
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["200 per hour"],
    storage_uri="memory://"
)

# ── File size limit: 15 MB ──
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024

# ── Mail config ──
app.config["MAIL_SERVER"]         = "smtp.gmail.com"
app.config["MAIL_PORT"]           = 587
app.config["MAIL_USE_TLS"]        = True
app.config["MAIL_USERNAME"]       = os.environ.get("MAIL_USERNAME")
app.config["MAIL_PASSWORD"]       = os.environ.get("MAIL_PASSWORD")
app.config["MAIL_DEFAULT_SENDER"] = os.environ.get("MAIL_DEFAULT_SENDER")
mail = Mail(app)


@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File too large. Maximum size is 15 MB."}), 413

@app.errorhandler(429)
def rate_limit_exceeded(e):
    return jsonify({"status": "error", "message": "Too many requests. Please slow down and try again later."}), 429


# ─────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────

def get_db():
    try:
        import mysql.connector
        db = mysql.connector.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            user=os.environ.get("DB_USER", "root"),
            password=os.environ.get("DB_PASSWORD", ""),
            database=os.environ.get("DB_NAME", "insightflow"),
            connection_timeout=5
        )
        cursor = db.cursor(dictionary=True)
        return db, cursor
    except Exception as e:
        log.error("DB connection error: %s", e)
        return None, None


# ─────────────────────────────────────────
# JWT HELPERS
# ─────────────────────────────────────────

def create_token(user_id, email, name):
    payload = {
        "sub":   str(user_id),   # PyJWT v2+ requires sub to be a string
        "email": email,
        "name":  name,
        "iat":   datetime.utcnow(),
        "exp":   datetime.utcnow() + timedelta(hours=JWT_EXPIRY)
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_token(token):
    """Returns payload dict or None if invalid/expired."""
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"],
                            options={"verify_sub": False})
    except pyjwt.ExpiredSignatureError:
        log.warning("verify_token: Token EXPIRED")
        return None
    except pyjwt.InvalidSignatureError:
        log.warning("verify_token: Invalid SIGNATURE — JWT_SECRET mismatch?")
        return None
    except pyjwt.DecodeError as e:
        log.warning("verify_token: Decode error — %s", e)
        return None
    except pyjwt.InvalidTokenError as e:
        log.warning("verify_token: Invalid token — %s", e)
        return None


def get_current_user():
    """
    Extract verified user from:
    1. Authorization: Bearer <jwt> header (standard)
    2. Request body field "_token" (fallback for file:// CORS restrictions)
    """
    # 1. Try Authorization header first
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        if token:
            payload = verify_token(token)
            if payload:
                log.debug("get_current_user: Authenticated via header: %s", payload.get("email"))
                return payload
            log.warning("get_current_user: Header token invalid/expired")

    # 2. Fallback: token in JSON body (for file:// → localhost requests)
    try:
        if request.is_json:
            body_token = (request.get_json(silent=True) or {}).get("_token", "")
            if body_token:
                payload = verify_token(body_token)
                if payload:
                    log.debug("get_current_user: Authenticated via body token: %s", payload.get("email"))
                    return payload
    except Exception:
        pass

    log.debug("get_current_user: No valid token found. Auth header: %s", auth[:30] if auth else "MISSING")
    return None


def require_auth(f):
    """
    Decorator — returns 401 if no valid JWT.
    OPTIONS requests are always allowed through (CORS preflight).
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        # Always allow CORS preflight requests through
        if request.method == "OPTIONS":
            return "", 200
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────

@app.route("/health")
def health():
    db, cursor = get_db()
    db_ok = False
    if db:
        try:
            cursor.execute("SELECT 1")
            cursor.fetchone()
            db_ok = True
        except Exception:
            pass
        finally:
            cursor.close()
            db.close()
    return jsonify({
        "status": "ok",
        "database": "connected" if db_ok else "unavailable",
        "groq": "ready"
    })


# ─────────────────────────────────────────
# VERIFY JWT
# ─────────────────────────────────────────

@app.route("/verify-jwt", methods=["POST"])
def verify_jwt_route():
    data    = request.json or {}
    token   = data.get("token", "")
    payload = verify_token(token)
    if payload:
        return jsonify({"valid": True, "email": payload["email"], "name": payload["name"]})
    return jsonify({"valid": False}), 401


# ─────────────────────────────────────────
# REGISTER
# ─────────────────────────────────────────

@app.route("/register", methods=["POST"])
@limiter.limit("5 per hour")
def register():
    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500
    try:
        data     = request.json or {}
        name     = data.get("name", "").strip()
        email    = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not name or not email or not password:
            return jsonify({"status": "error", "message": "All fields are required"})
        if len(name) < 2:
            return jsonify({"status": "error", "message": "Name must be at least 2 characters"})
        if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
            return jsonify({"status": "error", "message": "Invalid email address"})
        if len(password) < 8:
            return jsonify({"status": "error", "message": "Password must be at least 8 characters"})
        if not re.search(r"[A-Z]", password):
            return jsonify({"status": "error", "message": "Password must contain at least one uppercase letter"})
        if not re.search(r"[0-9]", password):
            return jsonify({"status": "error", "message": "Password must contain at least one number"})

        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        if cursor.fetchone():
            return jsonify({"status": "error", "message": "Email already registered"})

        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        cursor.execute(
            "INSERT INTO users(name, email, password) VALUES(%s, %s, %s)",
            (name, email, hashed)
        )
        db.commit()
        cursor.execute(
            "INSERT INTO activity_log(user_id, action, detail, ip_address) VALUES(LAST_INSERT_ID(),%s,%s,%s)",
            ("register", email, request.remote_addr or "unknown")
        )
        db.commit()
        log.info("New user registered: %s", email)
        return jsonify({"status": "success", "message": "User registered successfully"})
    except Exception as e:
        log.error("Register error: %s", e)
        return jsonify({"status": "error", "message": "Registration failed"}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# LOGIN
# ─────────────────────────────────────────

@app.route("/login", methods=["POST"])
@limiter.limit("10 per minute")
def login():
    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500
    try:
        data     = request.json or {}
        email    = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"status": "error", "message": "Email and password required"})

        cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
        user = cursor.fetchone()
        ip   = request.remote_addr or "unknown"

        if user and user.get("is_active", 1) == 0:
            return jsonify({"status": "error", "message": "Account is disabled. Contact support."})

        # Account lockout
        if user:
            cursor.execute(
                """SELECT COUNT(*) as cnt FROM activity_log
                   WHERE user_id=%s AND action='login_failed'
                   AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)""",
                (user["id"],)
            )
            fail_row = cursor.fetchone()
            if fail_row and fail_row.get("cnt", 0) >= 5:
                return jsonify({
                    "status": "error",
                    "message": "Account temporarily locked due to too many failed attempts. Try again in 15 minutes."
                })

        if user and bcrypt.checkpw(password.encode("utf-8"), user["password"].encode("utf-8")):
            # Update last_login if column exists
            try:
                cursor.execute("UPDATE users SET last_login=NOW() WHERE id=%s", (user["id"],))
            except Exception:
                pass  # Column may not exist — non-fatal
            cursor.execute(
                "INSERT INTO activity_log(user_id, action, detail, ip_address) VALUES(%s,%s,%s,%s)",
                (user["id"], "login", email, ip)
            )
            db.commit()
            token = create_token(user["id"], user["email"], user["name"])
            log.info("Login OK: %s from %s", email, ip)
            return jsonify({
                "status": "success",
                "name":   user["name"],
                "email":  user["email"],
                "token":  token,
                "expiry": JWT_EXPIRY
            })
        else:
            uid = user["id"] if user else None
            cursor.execute(
                "INSERT INTO activity_log(user_id, action, detail, ip_address) VALUES(%s,%s,%s,%s)",
                (uid, "login_failed", email, ip)
            )
            db.commit()
            return jsonify({"status": "error", "message": "Invalid email or password"})
    except Exception as e:
        log.error("Login error: %s", e)
        return jsonify({"status": "error", "message": "Login failed"}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# LOGOUT
# ─────────────────────────────────────────

@app.route("/logout", methods=["POST"])
@require_auth
def logout():
    user  = get_current_user()
    email = user["email"] if user else (request.json or {}).get("email", "").strip().lower()
    if email:
        db, cursor = get_db()
        if db:
            try:
                cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
                u = cursor.fetchone()
                if u:
                    cursor.execute(
                        "INSERT INTO activity_log(user_id, action, ip_address) VALUES(%s,%s,%s)",
                        (u["id"], "logout", request.remote_addr or "unknown")
                    )
                    db.commit()
            except Exception as e:
                log.warning("Logout log error: %s", e)
            finally:
                cursor.close()
                db.close()
    return jsonify({"status": "ok"})


# ─────────────────────────────────────────
# FORGOT PASSWORD
# ─────────────────────────────────────────

@app.route("/forgot-password", methods=["POST"])
@limiter.limit("5 per hour")
def forgot_password():
    data  = request.json or {}
    email = data.get("email", "").strip().lower()
    if not email or not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
        return jsonify({"status": "error", "message": "Invalid email address"}), 400
    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id, name FROM users WHERE email=%s", (email,))
        user = cursor.fetchone()
        if not user:
            return jsonify({"status": "error", "message": "No account found with that email."})
        log.info("Password reset requested for: %s", email)
        return jsonify({"status": "success", "name": user["name"], "email": email})
    except Exception as e:
        log.error("Forgot password error: %s", e)
        return jsonify({"status": "error", "message": "Request failed"}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# RESET PASSWORD DIRECT
# ─────────────────────────────────────────

@app.route("/reset-password-direct", methods=["POST"])
def reset_password_direct():
    data     = request.json or {}
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")
    if not email or not password:
        return jsonify({"status": "error", "message": "Email and password required"}), 400
    if len(password) < 6:
        return jsonify({"status": "error", "message": "Password must be at least 6 characters"}), 400
    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        user = cursor.fetchone()
        if not user:
            return jsonify({"status": "error", "message": "User not found"}), 404
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        cursor.execute("UPDATE users SET password=%s WHERE email=%s", (hashed, email))
        cursor.execute(
            "INSERT INTO activity_log(user_id, action, detail, ip_address) VALUES(%s,%s,%s,%s)",
            (user["id"], "password_reset", email, request.remote_addr or "unknown")
        )
        db.commit()
        log.info("Password reset (direct) for: %s", email)
        return jsonify({"status": "success", "message": "Password updated successfully"})
    except Exception as e:
        log.error("Direct reset error: %s", e)
        return jsonify({"status": "error", "message": "Reset failed"}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# RESET PASSWORD (token-based)
# ─────────────────────────────────────────

@app.route("/verify-reset-token", methods=["POST"])
def verify_reset_token():
    data  = request.json or {}
    token = data.get("token", "").strip()
    if not token:
        return jsonify({"valid": False})
    db, cursor = get_db()
    if not db:
        return jsonify({"valid": False})
    try:
        cursor.execute("SELECT email, expires_at FROM password_resets WHERE token=%s", (token,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"valid": False})
        if datetime.now() > row["expires_at"]:
            cursor.execute("DELETE FROM password_resets WHERE token=%s", (token,))
            db.commit()
            return jsonify({"valid": False, "reason": "expired"})
        return jsonify({"valid": True})
    except Exception as e:
        log.error("Verify token error: %s", e)
        return jsonify({"valid": False})
    finally:
        cursor.close()
        db.close()


@app.route("/reset-password", methods=["POST"])
def reset_password():
    data     = request.json or {}
    token    = data.get("token", "").strip()
    password = data.get("password", "")
    if not token or not password:
        return jsonify({"status": "error", "message": "Token and password are required"}), 400
    if len(password) < 6:
        return jsonify({"status": "error", "message": "Password must be at least 6 characters"}), 400
    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT email, expires_at FROM password_resets WHERE token=%s", (token,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"status": "error", "message": "Invalid reset link"})
        if datetime.now() > row["expires_at"]:
            cursor.execute("DELETE FROM password_resets WHERE token=%s", (token,))
            db.commit()
            return jsonify({"status": "expired", "message": "Reset link has expired."})
        email  = row["email"]
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        cursor.execute("UPDATE users SET password=%s WHERE email=%s", (hashed, email))
        cursor.execute("DELETE FROM password_resets WHERE token=%s", (token,))
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        u = cursor.fetchone()
        if u:
            cursor.execute(
                "INSERT INTO activity_log(user_id, action, detail, ip_address) VALUES(%s,%s,%s,%s)",
                (u["id"], "password_reset", email, request.remote_addr or "unknown")
            )
        db.commit()
        log.info("Password reset successful for: %s", email)
        return jsonify({"status": "success", "message": "Password updated successfully"})
    except Exception as e:
        log.error("Reset password error: %s", e)
        return jsonify({"status": "error", "message": "Reset failed"}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# ACCOUNT — GET  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/account/<email>")
@require_auth
def get_account(email):
    user = get_current_user()
    # Users can only access their own account
    if user["email"] != email:
        return jsonify({"error": "Forbidden"}), 403
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT name, email FROM users WHERE email=%s", (email,))
        row = cursor.fetchone()
        # Fetch optional columns safely
        try:
            cursor.execute("SELECT created_at, last_login FROM users WHERE email=%s", (email,))
            extra = cursor.fetchone()
            if extra and row:
                row.update({k: str(v) if v else None for k, v in extra.items()})
        except Exception:
            pass  # columns may not exist yet
        if row:
            return jsonify(row)
        return jsonify({"error": "User not found"}), 404
    except Exception as e:
        log.error("Account fetch error: %s", e)
        return jsonify({"error": "Failed to fetch account"}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# ACCOUNT — UPDATE  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/account/update", methods=["POST"])
@require_auth
def update_account():
    user = get_current_user()
    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500
    try:
        data     = request.json or {}
        email    = data.get("email", "").strip().lower()
        new_name = data.get("name", "").strip()
        new_pass = data.get("password", "")

        # Users can only update their own account
        if user["email"] != email:
            return jsonify({"status": "error", "message": "Forbidden"}), 403

        if new_name:
            cursor.execute("UPDATE users SET name=%s WHERE email=%s", (new_name, email))
        if new_pass:
            if len(new_pass) < 6:
                return jsonify({"status": "error", "message": "Password must be at least 6 characters"})
            hashed = bcrypt.hashpw(new_pass.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            cursor.execute("UPDATE users SET password=%s WHERE email=%s", (hashed, email))
        db.commit()
        log.info("Account updated: %s", email)
        return jsonify({"status": "success", "message": "Account updated"})
    except Exception as e:
        log.error("Update account error: %s", e)
        return jsonify({"status": "error", "message": "Update failed"}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# UPLOAD  🔒 JWT required
# ─────────────────────────────────────────

ALLOWED_EXT = {".csv", ".txt", ".xlsx", ".xls", ".sql", ".json"}

@app.route("/upload", methods=["POST", "OPTIONS"])
@require_auth
def upload():
    user = get_current_user()

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400

    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in ALLOWED_EXT:
        return jsonify({"error": f"Unsupported file type: {ext.upper()}. Allowed: CSV, TXT, XLSX, XLS, SQL, JSON"}), 400

    try:
        df = _read_file(file, ext)
        if df is None:
            return jsonify({"error": "Could not parse file"}), 400

        df = df.dropna(how="all")
        df.columns = [str(c).strip() for c in df.columns]
        if df.empty:
            return jsonify({"error": "Dataset is empty after cleaning"}), 400

        total_rows    = len(df)
        total_columns = len(df.columns)
        missing       = int(df.isnull().sum().sum())
        missing_pct   = round(missing / max(total_rows * total_columns, 1) * 100, 1)
        duplicates    = int(df.duplicated().sum())
        numeric_cols  = list(df.select_dtypes(include="number").columns)
        cat_cols      = list(df.select_dtypes(exclude="number").columns)
        preview       = df.head(500).fillna("").values.tolist()

        result = {
            "rows":         total_rows,
            "columns":      total_columns,
            "missing":      missing,
            "missing_pct":  missing_pct,
            "duplicates":   duplicates,
            "numeric":      len(numeric_cols),
            "categorical":  len(cat_cols),
            "numeric_cols": numeric_cols,
            "cat_cols":     cat_cols,
            "preview":      preview,
            "headers":      list(df.columns),
            "fileName":     file.filename
        }

        # Save metadata to DB using verified JWT user
        try:
            db2, cur2 = get_db()
            if db2:
                cur2.execute("SELECT id FROM users WHERE email=%s", (user["email"],))
                u = cur2.fetchone()
                if u:
                    try:
                        file.seek(0, 2); fsize = file.tell(); file.seek(0)
                    except Exception:
                        fsize = 0
                    cur2.execute(
                        """INSERT INTO datasets
                           (user_id, file_name, file_size, file_type,
                            total_rows, total_cols, numeric_cols, cat_cols,
                            missing_vals, duplicates, headers)
                           VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (
                            u["id"], file.filename, fsize, ext.lstrip("."),
                            total_rows, total_columns,
                            len(numeric_cols), len(cat_cols),
                            missing, duplicates, str(list(df.columns))
                        )
                    )
                    cur2.execute(
                        "INSERT INTO activity_log(user_id, action, detail, ip_address) VALUES(%s,%s,%s,%s)",
                        (u["id"], "upload", file.filename, request.remote_addr or "unknown")
                    )
                    db2.commit()
                cur2.close()
                db2.close()
        except Exception as db_err:
            log.warning("Could not save dataset metadata: %s", db_err)

        log.info("Upload OK: %s | %d rows x %d cols", file.filename, total_rows, total_columns)
        return jsonify(result)

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        log.error("Upload error: %s", e)
        return jsonify({"error": "Upload failed", "details": str(e)}), 500


def _read_file(file, ext):
    if ext in (".csv", ".txt"):
        try:
            return pd.read_csv(file, low_memory=False)
        except Exception:
            file.seek(0)
            return pd.read_csv(file, sep=None, engine="python", low_memory=False)
    elif ext in (".xlsx", ".xls"):
        try:
            return pd.read_excel(file, engine="openpyxl")
        except Exception as e:
            err = str(e).lower()
            if any(k in err for k in ("encrypt", "password", "zip")):
                raise ValueError("This Excel file is password-protected. Remove the password and re-upload.")
            file.seek(0)
            try:
                return pd.read_excel(file, engine="xlrd")
            except Exception:
                return None
    elif ext == ".json":
        return pd.read_json(file)
    elif ext == ".sql":
        text = file.read().decode("utf-8", errors="ignore")
        rows = re.findall(r'\(([^()]+)\)', text)
        if not rows:
            raise ValueError("No data rows found in SQL file")
        parsed   = [[p.strip().strip("'\"") for p in r.split(",")] for r in rows]
        max_cols = max(len(r) for r in parsed)
        headers  = [f"Column_{i+1}" for i in range(max_cols)]
        padded   = [r + [""] * (max_cols - len(r)) for r in parsed]
        return pd.DataFrame(padded, columns=headers)
    return None


# ─────────────────────────────────────────
# AI CHAT  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/chat", methods=["POST"])
@require_auth
def chat():
    user         = get_current_user()
    data         = request.json or {}
    user_message = data.get("message", "").strip()
    history      = data.get("history", [])
    dataset_ctx  = data.get("dataset_context", "No dataset uploaded yet.")
    dataset_id   = data.get("dataset_id", None)

    if not user_message:
        return jsonify({"error": "No message provided"}), 400

    recent = history[-10:]
    ctx    = "\n".join(dataset_ctx.split("\n")[:50])
    system_prompt = (
        "You are InsightFlow's expert data analyst AI. "
        "Analyze data clearly and concisely. Use bullet points. Max 200 words. "
        "Always base answers on the dataset provided.\n\n"
        f"Dataset context:\n{ctx}"
    )

    try:
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "system", "content": system_prompt}] + recent + [
                {"role": "user", "content": user_message}
            ],
            max_tokens=1000,
            temperature=0.7
        )
        reply = response.choices[0].message.content
        log.info("Chat reply: %d chars", len(reply))

        # Save to DB using verified JWT user
        try:
            db2, cur2 = get_db()
            if db2:
                cur2.execute("SELECT id FROM users WHERE email=%s", (user["email"],))
                u = cur2.fetchone()
                if u:
                    uid = u["id"]
                    if not dataset_id:
                        cur2.execute(
                            "SELECT id FROM datasets WHERE user_id=%s ORDER BY uploaded_at DESC LIMIT 1",
                            (uid,)
                        )
                        ds = cur2.fetchone()
                        if ds: dataset_id = ds["id"]
                    cur2.execute(
                        "INSERT INTO chat_history(user_id, dataset_id, role, message) VALUES(%s,%s,%s,%s)",
                        (uid, dataset_id, "user", user_message)
                    )
                    cur2.execute(
                        "INSERT INTO chat_history(user_id, dataset_id, role, message) VALUES(%s,%s,%s,%s)",
                        (uid, dataset_id, "assistant", reply)
                    )
                    db2.commit()
                cur2.close()
                db2.close()
        except Exception as db_err:
            log.warning("Chat DB save error: %s", db_err)

        return jsonify({"reply": reply})
    except Exception as e:
        log.error("Chat error: %s", e)
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────
# AI SUMMARY  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/summary", methods=["POST"])
@require_auth
def summary():
    data    = request.json or {}
    headers = data.get("headers", [])
    rows    = data.get("dataset", data.get("preview", []))
    fname   = data.get("fileName", "dataset")
    if not headers or not rows:
        return jsonify({"error": "No dataset provided"}), 400
    try:
        df       = pd.DataFrame(rows[:100], columns=headers)
        preview  = df.head(5).to_string(index=False)
        num_cols = list(df.select_dtypes(include="number").columns)
        cat_cols = list(df.select_dtypes(exclude="number").columns)
        prompt = (
            f"Dataset: '{fname}' — {len(rows)} rows × {len(headers)} columns.\n"
            f"Numeric columns: {', '.join(num_cols) or 'None'}.\n"
            f"Categorical columns: {', '.join(cat_cols) or 'None'}.\n"
            f"First 5 rows:\n{preview}\n\n"
            "Give a 3-bullet insight summary. Mention key patterns, "
            "potential use cases, and any data quality notes. Max 120 words."
        )
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a senior data analyst. Be concise and insightful."},
                {"role": "user",   "content": prompt}
            ],
            max_tokens=400,
            temperature=0.5
        )
        return jsonify({"summary": response.choices[0].message.content})
    except Exception as e:
        log.error("Summary error: %s", e)
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────
# AI COLUMN INSIGHT  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/column-insight", methods=["POST"])
@require_auth
def column_insight():
    data     = request.json or {}
    col      = data.get("column", "")
    values   = data.get("values", [])
    col_type = data.get("type", "unknown")
    if not col or not values:
        return jsonify({"error": "column and values required"}), 400
    try:
        prompt = (
            f"Column: '{col}' (type: {col_type})\n"
            f"Sample values: {values[:50]}\n\n"
            "In 2-3 bullet points: describe the distribution pattern, "
            "any anomalies or outliers, and one actionable insight. Max 80 words."
        )
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a data analyst. Be brief and specific."},
                {"role": "user",   "content": prompt}
            ],
            max_tokens=200,
            temperature=0.5
        )
        return jsonify({"insight": response.choices[0].message.content})
    except Exception as e:
        log.error("Column insight error: %s", e)
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────
# ANALYZE  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/analyze", methods=["POST"])
@require_auth
def analyze():
    data    = request.json or {}
    headers = data.get("headers", [])
    rows    = data.get("dataset", data.get("preview", []))
    if not headers or not rows:
        return jsonify({"error": "No dataset provided"}), 400
    try:
        df = pd.DataFrame(rows, columns=headers)
        col_stats = {}
        for col in df.columns:
            series       = df[col]
            numeric_vals = pd.to_numeric(series, errors="coerce").dropna()
            is_num       = len(numeric_vals) > len(series) * 0.5
            if is_num:
                v  = numeric_vals
                q1 = float(v.quantile(0.25))
                q3 = float(v.quantile(0.75))
                iq = q3 - q1
                col_stats[col] = {
                    "type": "numeric", "count": int(v.count()),
                    "missing": int(series.isnull().sum()),
                    "min": _safe_float(v.min()), "max": _safe_float(v.max()),
                    "mean": _safe_float(v.mean()), "median": _safe_float(v.median()),
                    "std": _safe_float(v.std()) if len(v) > 1 else 0.0,
                    "variance": _safe_float(v.var()) if len(v) > 1 else 0.0,
                    "q1": round(q1, 4), "q3": round(q3, 4), "iqr": round(iq, 4),
                    "outliers": int(((v < q1 - 1.5*iq) | (v > q3 + 1.5*iq)).sum()),
                    "sum": _safe_float(v.sum()),
                    "skew": round(float(v.skew()), 4) if len(v) > 2 else 0.0,
                }
            else:
                vc = series.dropna().astype(str).value_counts()
                col_stats[col] = {
                    "type": "categorical", "count": int(series.count()),
                    "missing": int(series.isnull().sum()), "unique": int(series.nunique()),
                    "top_value": str(vc.index[0]) if len(vc) else "",
                    "top_count": int(vc.iloc[0]) if len(vc) else 0,
                    "top_10": {str(k): int(v) for k, v in vc.head(10).items()},
                }
        summary = {
            "total_rows":    len(df), "total_cols": len(df.columns),
            "total_missing": int(df.isnull().sum().sum()),
            "total_dupes":   int(df.duplicated().sum()),
            "numeric_cols":  [c for c in df.columns if col_stats[c]["type"] == "numeric"],
            "cat_cols":      [c for c in df.columns if col_stats[c]["type"] == "categorical"],
        }
        return jsonify({"summary": summary, "columns": col_stats})
    except Exception as e:
        log.error("Analyze error: %s", e)
        return jsonify({"error": "Analysis failed", "details": str(e)}), 500


def _safe_float(val):
    try:
        f = float(val)
        return 0.0 if (math.isnan(f) or math.isinf(f)) else round(f, 4)
    except Exception:
        return 0.0


# ─────────────────────────────────────────
# DATASET HISTORY  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/datasets/<email>")
@require_auth
def dataset_history(email):
    user = get_current_user()
    if user["email"] != email:
        return jsonify({"error": "Forbidden"}), 403
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        u = cursor.fetchone()
        if not u:
            return jsonify({"datasets": []})
        cursor.execute(
            """SELECT id, file_name, file_type, total_rows, total_cols,
                      numeric_cols, cat_cols, missing_vals, duplicates, uploaded_at
               FROM datasets WHERE user_id=%s
               ORDER BY uploaded_at DESC LIMIT 20""",
            (u["id"],)
        )
        rows = cursor.fetchall()
        for r in rows:
            if r.get("uploaded_at"):
                r["uploaded_at"] = str(r["uploaded_at"])
        return jsonify({"datasets": rows})
    except Exception as e:
        log.error("Dataset history error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# ACTIVITY LOG  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/activity/<email>")
@require_auth
def activity(email):
    user = get_current_user()
    if user["email"] != email:
        return jsonify({"error": "Forbidden"}), 403
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        u = cursor.fetchone()
        if not u:
            return jsonify({"activity": []})
        cursor.execute(
            """SELECT action, detail, ip_address, created_at
               FROM activity_log WHERE user_id=%s
               ORDER BY created_at DESC LIMIT 50""",
            (u["id"],)
        )
        rows = cursor.fetchall()
        for r in rows:
            if r.get("created_at"):
                r["created_at"] = str(r["created_at"])
        return jsonify({"activity": rows})
    except Exception as e:
        log.error("Activity error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# SAVED CHARTS  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/charts/save", methods=["POST"])
@require_auth
def save_chart():
    user       = get_current_user()
    data       = request.json or {}
    chart_name = data.get("chart_name", "Untitled Chart")[:255]
    chart_type = data.get("chart_type", "bar")[:50]
    config     = str(data.get("config", "{}"))
    thumbnail  = data.get("thumbnail", None)
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (user["email"],))
        u = cursor.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404
        cursor.execute(
            """INSERT INTO saved_charts(user_id, chart_name, chart_type, config, thumbnail)
               VALUES(%s,%s,%s,%s,%s)""",
            (u["id"], chart_name, chart_type, config, thumbnail)
        )
        chart_id = cursor.lastrowid
        db.commit()
        log.info("Chart saved: %s for %s", chart_name, user["email"])
        return jsonify({"status": "success", "chart_id": chart_id})
    except Exception as e:
        log.error("Save chart error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        db.close()


@app.route("/charts/<email>")
@require_auth
def get_charts(email):
    user = get_current_user()
    if user["email"] != email:
        return jsonify({"error": "Forbidden"}), 403
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        u = cursor.fetchone()
        if not u:
            return jsonify({"charts": []})
        cursor.execute(
            """SELECT id, chart_name, chart_type, config, thumbnail, created_at
               FROM saved_charts WHERE user_id=%s
               ORDER BY created_at DESC LIMIT 50""",
            (u["id"],)
        )
        rows = cursor.fetchall()
        for r in rows:
            if r.get("created_at"):
                r["created_at"] = str(r["created_at"])
        return jsonify({"charts": rows})
    except Exception as e:
        log.error("Get charts error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        db.close()


@app.route("/charts/delete/<int:chart_id>", methods=["DELETE"])
@require_auth
def delete_chart(chart_id):
    user = get_current_user()
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (user["email"],))
        u = cursor.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404
        cursor.execute(
            "DELETE FROM saved_charts WHERE id=%s AND user_id=%s",
            (chart_id, u["id"])
        )
        db.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        log.error("Delete chart error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# CHAT HISTORY  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/chat/history/<email>")
@require_auth
def chat_history_get(email):
    user = get_current_user()
    if user["email"] != email:
        return jsonify({"error": "Forbidden"}), 403
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        u = cursor.fetchone()
        if not u:
            return jsonify({"history": []})
        cursor.execute(
            """SELECT role, message, dataset_id, created_at
               FROM chat_history WHERE user_id=%s
               ORDER BY created_at ASC LIMIT 200""",
            (u["id"],)
        )
        rows = cursor.fetchall()
        for r in rows:
            if r.get("created_at"):
                r["created_at"] = str(r["created_at"])
        return jsonify({"history": list(reversed(rows))})
    except Exception as e:
        log.error("Chat history error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        db.close()


@app.route("/chat/history/clear", methods=["DELETE"])
@require_auth
def clear_chat_history():
    user = get_current_user()
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (user["email"],))
        u = cursor.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404
        cursor.execute("DELETE FROM chat_history WHERE user_id=%s", (u["id"],))
        db.commit()
        return jsonify({"status": "success", "deleted": cursor.rowcount})
    except Exception as e:
        log.error("Clear chat error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        db.close()


# ─────────────────────────────────────────
# CLEAR ACTIVITY LOG  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/activity/clear", methods=["DELETE"])
@require_auth
def clear_activity():
    user = get_current_user()
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (user["email"],))
        u = cursor.fetchone()
        if not u:
            return jsonify({"error": "User not found"}), 404
        cursor.execute("DELETE FROM activity_log WHERE user_id=%s", (u["id"],))
        db.commit()
        return jsonify({"status": "success", "deleted": cursor.rowcount})
    except Exception as e:
        log.error("Clear activity error: %s", e)
        return jsonify({"error": str(e)}), 500
    finally:
        cursor.close()
        db.close()



# ─────────────────────────────────────────
# ACCOUNT — DELETE  🔒 JWT required
# ─────────────────────────────────────────

@app.route("/account/delete", methods=["DELETE"])
@require_auth
def delete_account():
    user = get_current_user()
    data  = request.json or {}
    email = data.get("email", "").strip().lower()

    # Must match JWT email
    if user["email"] != email:
        return jsonify({"status": "error", "message": "Forbidden"}), 403

    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500
    try:
        cursor.execute("SELECT id FROM users WHERE email=%s", (email,))
        u = cursor.fetchone()
        if not u:
            return jsonify({"status": "error", "message": "User not found"}), 404

        uid = u["id"]
        # Delete all user data in order (FK constraints)
        cursor.execute("DELETE FROM chat_history   WHERE user_id=%s", (uid,))
        cursor.execute("DELETE FROM activity_log   WHERE user_id=%s", (uid,))
        cursor.execute("DELETE FROM saved_charts   WHERE user_id=%s", (uid,))
        cursor.execute("DELETE FROM datasets       WHERE user_id=%s", (uid,))
        try:
            cursor.execute("DELETE FROM sessions   WHERE user_id=%s", (uid,))
        except Exception:
            pass  # sessions table may not exist
        cursor.execute("DELETE FROM users          WHERE id=%s",      (uid,))
        db.commit()
        log.info("Account deleted: %s", email)
        return jsonify({"status": "success", "message": "Account deleted"})

    except Exception as e:
        log.error("Delete account error: %s", e)
        return jsonify({"status": "error", "message": "Delete failed"}), 500
    finally:
        cursor.close()
        db.close()

# ─────────────────────────────────────────
# RUN
# ─────────────────────────────────────────

if __name__ == "__main__":
    log.info("Starting InsightFlow backend on port 5000")
    app.run(debug=True, port=5000)