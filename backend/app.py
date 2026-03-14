from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import warnings
import os
import requests
from groq import Groq
import re

warnings.filterwarnings("ignore")
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── API Keys ──
if not os.environ.get("GROQ_API_KEY"):
    os.environ["GROQ_API_KEY"] = os.environ.get("GROQ_API_KEY", "")  # ← paste your key here

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)


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
                host="localhost",
                user="root",
                password="1234",
                database="insightflow"
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
    name     = data["name"]
    email    = data["email"]
    password = data["password"]

    cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
    existing_user = cursor.fetchone()

    if existing_user:
        return jsonify({"status": "error", "message": "Email already registered"})

    cursor.execute(
        "INSERT INTO users(name,email,password) VALUES(%s,%s,%s)",
        (name, email, password)
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
    email    = data["email"]
    password = data["password"]

    cursor.execute(
        "SELECT * FROM users WHERE email=%s AND password=%s",
        (email, password)
    )
    user = cursor.fetchone()

    if user:
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

    cursor.execute("SELECT name,email FROM users WHERE email=%s", (email,))
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

        # Preview — send all rows for pagination (up to 500)
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

    # Trim dataset context to reduce token usage
    ctx_lines = dataset_ctx.split("\n")
    short_ctx = "\n".join(ctx_lines[:20])  # max 20 lines of context

    system_prompt = f"""You are a data analyst. Dataset: {short_ctx}. Be concise, use bullet points, max 150 words."""

    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        return jsonify({"error": "GROQ_API_KEY not set.\n\nAdd it in PyCharm:\nEdit Configurations → Environment Variables → GROQ_API_KEY=gsk_..."}), 401

    try:
        client = Groq(api_key=api_key)

        # Build messages with system prompt
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
        return jsonify({"error": "GEMINI_API_KEY not set"})

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
                "contents": [{"role":"user","parts":[{"text":"say hi"}]}]
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