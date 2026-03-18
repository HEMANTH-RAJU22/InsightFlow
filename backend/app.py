from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import warnings
import os
import requests
from groq import Groq
import re
from dotenv import load_dotenv
import bcrypt

load_dotenv()

warnings.filterwarnings("ignore")
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── Validate required environment variables on startup ──
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise EnvironmentError(
        "GROQ_API_KEY is not set.\n"
        "Add it to your .env file:\n"
        "  GROQ_API_KEY=gsk_your_key_here\n"
        "Or set it in PyCharm: Run > Edit Configurations > Environment Variables"
    )

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)

# ── Max upload size: 15MB ──
app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024

@app.errorhandler(413)
def file_too_large(e):
    return jsonify({"error": "File too large. Maximum allowed size is 15MB."}), 413


# -------------------------
# MySQL Connection (lazy)
# -------------------------

db     = None
cursor = None

def get_db():
    global db, cursor
    try:
        if db is None or not db.is_connected():
            import mysql.connector
            db = mysql.connector.connect(
                host=os.environ.get("DB_HOST", "localhost"),
                user=os.environ.get("DB_USER", "root"),
                password=os.environ.get("DB_PASSWORD", ""),
                database=os.environ.get("DB_NAME", "insightflow")
            )
            cursor = db.cursor(dictionary=True)
    except Exception as e:
        print("DB connection error:", e)
        db = None
        cursor = None
    return db, cursor


# -------------------------
# REGISTER API
# -------------------------

@app.route("/register", methods=["POST"])
def register():
    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500

    data     = request.json
    name     = data.get("name", "").strip()
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not name or not email or not password:
        return jsonify({"status": "error", "message": "All fields are required"})

    cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
    existing_user = cursor.fetchone()

    if existing_user:
        return jsonify({"status": "error", "message": "Email already registered"})

    # Hash password before storing
    hashed_password = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    cursor.execute(
        "INSERT INTO users(name, email, password) VALUES(%s, %s, %s)",
        (name, email, hashed_password)
    )
    db.commit()

    return jsonify({"status": "success", "message": "User registered successfully"})


# -------------------------
# LOGIN API
# -------------------------

@app.route("/login", methods=["POST"])
def login():
    db, cursor = get_db()
    if not db:
        return jsonify({"status": "error", "message": "Database unavailable"}), 500

    data     = request.json
    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
    user = cursor.fetchone()

    if user and bcrypt.checkpw(password.encode("utf-8"), user["password"].encode("utf-8")):
        return jsonify({"status": "success", "name": user["name"], "email": user["email"]})
    else:
        return jsonify({"status": "error", "message": "Invalid email or password"})


# -------------------------
# ACCOUNT API
# -------------------------

@app.route("/account/<email>")
def get_account(email):
    db, cursor = get_db()
    if not db:
        return jsonify({"error": "Database unavailable"}), 500

    cursor.execute("SELECT name, email FROM users WHERE email=%s", (email,))
    user = cursor.fetchone()

    if user:
        return jsonify(user)
    else:
        return jsonify({"error": "User not found"})


# -------------------------
# DATASET UPLOAD API
# -------------------------

@app.route("/upload", methods=["POST", "OPTIONS"])
def upload():
    if request.method == "OPTIONS":
        return "", 200

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]

    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    filename = file.filename.lower()

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(file, low_memory=False)

        elif filename.endswith(".txt"):
            df = pd.read_csv(file, sep=",", low_memory=False)

        elif filename.endswith(".xlsx"):
            try:
                df = pd.read_excel(file, engine="openpyxl")
            except Exception as xlsx_err:
                err_msg = str(xlsx_err).lower()
                if "encrypt" in err_msg or "password" in err_msg or "zip" in err_msg:
                    return jsonify({"error": "This Excel file is password-protected or encrypted. Please remove the password in Excel (File → Info → Protect Workbook → Remove Password) and try again."}), 400
                file.seek(0)
                try:
                    df = pd.read_csv(file)
                except Exception:
                    return jsonify({"error": "Could not read Excel file: " + str(xlsx_err)}), 400

        elif filename.endswith(".sql"):
            text = file.read().decode("utf-8")
            rows = re.findall(r'\((.*?)\)', text)
            if not rows:
                return jsonify({"error": "No data rows found in SQL file"}), 400
            dataset_rows = [r.split(",") for r in rows]
            col_headers  = [f"Column {i+1}" for i in range(len(dataset_rows[0]))]
            df = pd.DataFrame(dataset_rows, columns=col_headers)

        else:
            return jsonify({"error": f"Unsupported file type: {filename.split('.')[-1].upper()}"}), 400

        # Clean
        df = df.dropna(how="all")

        if df.empty:
            return jsonify({"error": "Dataset is empty after cleaning"}), 400

        # KPIs
        total_rows    = len(df)
        total_columns = len(df.columns)
        missing       = int(df.isnull().sum().sum())
        duplicates    = int(df.duplicated().sum())
        numeric       = len(df.select_dtypes(include="number").columns)
        categorical   = len(df.select_dtypes(exclude="number").columns)

        # Preview — send up to 100 rows
        preview = df.head(100).fillna("").values.tolist()

        result = {
            "rows":        total_rows,
            "columns":     total_columns,
            "missing":     missing,
            "duplicates":  duplicates,
            "numeric":     numeric,
            "categorical": categorical,
            "preview":     preview,
            "headers":     list(df.columns)
        }
        print(f"UPLOAD SUCCESS: {total_rows} rows, {total_columns} cols, {len(preview)} preview rows")
        return jsonify(result)

    except Exception as e:
        print("UPLOAD ERROR:", str(e))
        return jsonify({"error": "Upload failed", "details": str(e)}), 500


# -------------------------
# AI CHAT API
# -------------------------

@app.route("/chat", methods=["POST"])
def chat():
    data         = request.json
    user_message = data.get("message", "")
    history      = data.get("history", [])
    dataset_ctx  = data.get("dataset_context", "No dataset uploaded yet.")

    if not user_message:
        return jsonify({"error": "No message provided"}), 400

    messages = history[-4:] + [{"role": "user", "content": user_message}]

    # Build rich dataset context — 50 sample rows
    ctx_lines = dataset_ctx.split("\n")
    # Keep header info (first 6 lines) + up to 50 data rows
    header_lines = ctx_lines[:6]
    data_lines   = ctx_lines[6:][:50]
    short_ctx    = "\n".join(header_lines + data_lines)

    system_prompt = f"""You are an expert data analyst assistant. Analyze the dataset below and answer questions clearly with bullet points, numbers, and insights. Be concise but thorough — max 200 words.

Dataset:
{short_ctx}"""

    try:
        client = Groq(api_key=GROQ_API_KEY)

        groq_messages = [{"role": "system", "content": system_prompt}] + messages

        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=groq_messages,
            max_tokens=1000,
            temperature=0.7
        )

        reply = response.choices[0].message.content
        return jsonify({"reply": reply})

    except Exception as e:
        import traceback
        print("CHAT ERROR:", traceback.format_exc())
        return jsonify({"error": str(e)}), 500


# -------------------------
# GEMINI MODELS LIST
# -------------------------

@app.route("/list-models")
def list_models():
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "GEMINI_API_KEY not set in .env"}), 401
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    resp = requests.get(url, timeout=10, verify=False)
    if resp.status_code != 200:
        return jsonify({"error": resp.text})
    models = [m["name"] for m in resp.json().get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
    return jsonify({"models": models})


# -------------------------
# GEMINI TEST ROUTE
# -------------------------

@app.route("/test-gemini")
def test_gemini():
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "GEMINI_API_KEY not set in .env"}), 401

    models = [
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b",
        "gemini-pro"
    ]

    results = {}
    for model in models:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            resp = requests.post(url, json={
                "contents": [{"role": "user", "parts": [{"text": "say hi"}]}]
            }, timeout=10, verify=False)
            results[model] = resp.status_code
        except Exception as e:
            results[model] = str(e)

    return jsonify(results)


# -------------------------
# RUN SERVER
# -------------------------

if __name__ == "__main__":
    app.run(debug=True, port=5000)