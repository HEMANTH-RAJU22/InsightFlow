from flask import Flask, request, jsonify
import mysql.connector
from flask_cors import CORS
import pandas as pd
import warnings

warnings.filterwarnings("ignore")

app = Flask(__name__)
CORS(app)


# -------------------------
# MySQL Connection
# -------------------------

db = mysql.connector.connect(
    host="localhost",
    user="root",
    password="1234",
    database="insightflow"
)

cursor = db.cursor(dictionary=True)


# -------------------------
# REGISTER API
# -------------------------

@app.route("/register", methods=["POST"])
def register():

    data = request.json

    name = data["name"]
    email = data["email"]
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

    return jsonify({
        "status": "success",
        "message": "User registered successfully"
    })


# -------------------------
# LOGIN API
# -------------------------

@app.route("/login", methods=["POST"])
def login():

    data = request.json

    email = data["email"]
    password = data["password"]

    cursor.execute(
        "SELECT * FROM users WHERE email=%s AND password=%s",
        (email, password)
    )

    user = cursor.fetchone()

    if user:
        return jsonify({
            "status": "success",
            "name": user["name"],
            "email": user["email"]
        })
    else:
        return jsonify({
            "status": "error",
            "message": "Invalid email or password"
        })


# -------------------------
# ACCOUNT API
# -------------------------

@app.route("/account/<email>")
def get_account(email):

    cursor.execute(
        "SELECT name,email FROM users WHERE email=%s",
        (email,)
    )

    user = cursor.fetchone()

    if user:
        return jsonify(user)
    else:
        return jsonify({"error": "User not found"})


# -------------------------
# DATASET UPLOAD API
# -------------------------

@app.route("/upload", methods=["POST"])
def upload():

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]

    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    filename = file.filename.lower()

    try:

        # -------------------------
        # CSV
        # -------------------------
        if filename.endswith(".csv"):
            df = pd.read_csv(file, low_memory=False)

        # -------------------------
        # TXT
        # -------------------------
        elif filename.endswith(".txt"):
            df = pd.read_csv(file, sep=",", low_memory=False)

        # -------------------------
        # XLSX
        # -------------------------
        elif filename.endswith(".xlsx"):

            try:
                df = pd.read_excel(file, engine="openpyxl")

            except Exception:
                file.seek(0)

                try:
                    df = pd.read_csv(file)
                except Exception:
                    return jsonify({"error": "Invalid Excel file"}), 400

        # -------------------------
        # SQL
        # -------------------------
        elif filename.endswith(".sql"):

            text = file.read().decode("utf-8")

            import re

            rows = re.findall(r'\((.*?)\)', text)

            if not rows:
                return jsonify({"error": "No data rows found in SQL file"}), 400

            dataset = [r.split(",") for r in rows]

            headers = [f"Column {i+1}" for i in range(len(dataset[0]))]

            df = pd.DataFrame(dataset, columns=headers)

        else:
            return jsonify({"error": "Unsupported file type"}), 400


        # -------------------------
        # Clean dataset
        # -------------------------
        df = df.dropna(how="all")

        if df.empty:
            return jsonify({"error": "Dataset is empty"}), 400


        # -------------------------
        # KPI Calculation
        # -------------------------
        total_rows = len(df)
        total_columns = len(df.columns)

        missing = int(df.isnull().sum().sum())
        duplicates = int(df.duplicated().sum())

        numeric = len(df.select_dtypes(include="number").columns)
        categorical = len(df.select_dtypes(exclude="number").columns)


        # -------------------------
        # Preview rows
        # -------------------------
        preview = df.head(50).fillna("").values.tolist()


        return jsonify({
            "rows": total_rows,
            "columns": total_columns,
            "missing": missing,
            "duplicates": duplicates,
            "numeric": numeric,
            "categorical": categorical,
            "preview": preview,
            "headers": list(df.columns)
        })


    except Exception as e:

        print("UPLOAD ERROR:", str(e))

        return jsonify({
            "error": "Dataset processing failed",
            "details": str(e)
        }), 500

# -------------------------
# RUN SERVER
# -------------------------

if __name__ == "__main__":
    app.run(debug=True)