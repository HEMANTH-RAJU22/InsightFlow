from flask import Flask, request, jsonify
import pandas as pd

@app.route("/upload", methods=["POST"])
def upload():

    file = request.files["file"]

    filename = file.filename.lower()

    if filename.endswith(".csv"):
        df = pd.read_csv(file)

    elif filename.endswith(".xlsx"):
        df = pd.read_excel(file)

    else:
        return jsonify({"error": "Unsupported file type"})

    total_rows = len(df)
    total_columns = len(df.columns)

    missing = int(df.isnull().sum().sum())
    duplicates = int(df.duplicated().sum())

    numeric = len(df.select_dtypes(include="number").columns)
    categorical = len(df.select_dtypes(exclude="number").columns)

    preview = df.head(50).values.tolist()

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