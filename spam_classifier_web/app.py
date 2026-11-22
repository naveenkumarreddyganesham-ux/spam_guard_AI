from datetime import datetime
import csv
import io
import re
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import SVC

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "history.db"
DATA_PATH = BASE_DIR / "data" / "messages.csv"
app = Flask(__name__)
app.config["SECRET_KEY"] = "local-demo-key-change-if-deploying"
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024


def read_training_data():
    texts, labels = [], []
    with DATA_PATH.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames or not {"text", "label"}.issubset(reader.fieldnames):
            raise ValueError("The training CSV must contain text and label columns.")
        for row in reader:
            text = (row.get("text") or "").strip()
            label = (row.get("label") or "").strip().lower()
            if text and label in {"spam", "ham"}:
                texts.append(text)
                labels.append(label)
    if not texts or set(labels) != {"spam", "ham"}:
        raise ValueError("The training CSV must contain labeled spam and ham messages.")
    return texts, labels


def build_model(name):
    classifier = (
        MultinomialNB()
        if name == "Naive Bayes"
        else SVC(probability=True, kernel="linear", class_weight="balanced", random_state=42)
    )
    return Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    lowercase=True, stop_words="english", ngram_range=(1, 2)
                ),
            ),
            ("classifier", classifier),
        ]
    )


texts, labels = read_training_data()
X_train, X_test, y_train, y_test = train_test_split(
    texts, labels, test_size=0.2, random_state=42, stratify=labels
)
nb_model = build_model("Naive Bayes").fit(texts, labels)
svm_model = build_model("SVM").fit(texts, labels)


def evaluate_model(model):
    predictions = model.predict(X_test)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_test, predictions, pos_label="spam", average="binary", zero_division=0
    )
    matrix = confusion_matrix(y_test, predictions, labels=["spam", "ham"])
    return {
        "accuracy": round(float(accuracy_score(y_test, predictions)) * 100, 2),
        "precision": round(float(precision) * 100, 2),
        "recall": round(float(recall) * 100, 2),
        "f1": round(float(f1) * 100, 2),
        "confusion_matrix": matrix.tolist(),
        "true_positive": int(matrix[0][0]),
        "false_negative": int(matrix[0][1]),
        "false_positive": int(matrix[1][0]),
        "true_negative": int(matrix[1][1]),
    }


model_performance = {
    "Naive Bayes": evaluate_model(build_model("Naive Bayes").fit(X_train, y_train)),
    "SVM": evaluate_model(build_model("SVM").fit(X_train, y_train)),
}


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL,
                label TEXT NOT NULL,
                confidence REAL NOT NULL,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )


init_db()

SPAM_HINTS = [
    "win",
    "winner",
    "won",
    "prize",
    "claim",
    "free",
    "urgent",
    "click",
    "verify",
    "loan",
    "cash",
    "reward",
    "offer",
    "limited",
    "bonus",
    "money",
    "subscribe",
    "expires",
    "buy now",
    "account will be blocked",
    "guaranteed",
]
URL_RE = re.compile(r"(?:https?://|www\.)[^\s]+", re.IGNORECASE)
WORD_RE = re.compile(r"\b[\w']+\b", re.UNICODE)


def get_model(name):
    return svm_model if name == "SVM" else nb_model


def classify(model, message):
    prediction = model.predict([message])[0]
    probabilities = model.predict_proba([message])[0]
    classes = list(model.classes_)
    confidence = float(probabilities[classes.index(prediction)])
    return {
        "prediction": prediction,
        "confidence": round(confidence * 100, 1),
        "spam_probability": round(float(probabilities[classes.index("spam")]) * 100, 1),
        "ham_probability": round(float(probabilities[classes.index("ham")]) * 100, 1),
    }


def inspect_message(message):
    lowered = message.lower()
    keywords = [word for word in SPAM_HINTS if word in lowered]
    links = URL_RE.findall(message)
    digit_count = sum(character.isdigit() for character in message)
    letters = [character for character in message if character.isalpha()]
    uppercase_count = sum(character.isupper() for character in letters)
    uppercase_percentage = (
        round(uppercase_count / len(letters) * 100, 1) if letters else 0
    )
    patterns = [
        {"pattern": keyword, "reason": "Common promotional or account-pressure wording."}
        for keyword in keywords
    ]
    if links:
        patterns.append(
            {"pattern": f"{len(links)} link(s)", "reason": "Links can lead to unsafe or deceptive sites."}
        )
    if uppercase_percentage >= 50 and len(letters) >= 5:
        patterns.append(
            {"pattern": "High uppercase usage", "reason": "Excessive capitalization can be used to attract attention."}
        )
    if digit_count >= 5:
        patterns.append(
            {"pattern": f"{digit_count} digits", "reason": "A high number of digits may indicate codes, phone numbers, or offers."}
        )
    return {
        "word_count": len(WORD_RE.findall(message)),
        "character_count": sum(not character.isspace() for character in message),
        "message_length": len(message),
        "link_count": len(links),
        "digit_count": digit_count,
        "uppercase_percentage": uppercase_percentage,
        "suspicious_keywords": keywords,
        "patterns": patterns[:10],
    }


def legacy_label(label):
    return "SPAM" if label == "spam" else "SAFE"


def compare_models(message):
    results = {}
    for name in ("Naive Bayes", "SVM"):
        prediction = classify(get_model(name), message)
        results[name] = {
            "label": legacy_label(prediction["prediction"]),
            "confidence": prediction["confidence"],
            "spam_probability": prediction["spam_probability"],
            "ham_probability": prediction["ham_probability"],
        }
    return results


@app.route("/")
def home():
    return render_template("index.html")


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "The CSV exceeds the 10 MB upload limit."}), 413


@app.post("/api/analyze")
def analyze():
    payload = request.get_json(silent=True) or request.form
    message = (payload.get("message") or "").strip()
    model_name = (payload.get("model") or "Naive Bayes").strip()
    if not message:
        return jsonify({"error": "Please enter a message to analyze."}), 400
    if len(message) > 5000:
        return jsonify({"error": "Please keep the message under 5,000 characters."}), 400
    if model_name not in ("Naive Bayes", "SVM"):
        model_name = "Naive Bayes"

    selected = classify(get_model(model_name), message)
    comparisons = compare_models(message)
    stats = inspect_message(message)
    result = legacy_label(selected["prediction"])
    risk = "High" if result == "SPAM" and selected["confidence"] >= 75 else (
        "Medium" if result == "SPAM" else "Low"
    )
    advice = (
        "Avoid opening links or sharing personal or banking information."
        if result == "SPAM"
        else "Still check the sender and links before responding."
    )
    detected = ", ".join(pattern["pattern"] for pattern in stats["patterns"])
    explanation = (
        f"{model_name} classified this message as "
        f"{'Spam' if result == 'SPAM' else 'Ham'} with {selected['confidence']}% confidence."
    )
    if detected:
        explanation += f" Detected indicators: {detected}."
    else:
        explanation += " No listed suspicious wording or patterns were detected."
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO checks(message,label,confidence,model,created_at) VALUES(?,?,?,?,?)",
            (
                message,
                result,
                selected["confidence"] / 100,
                model_name,
                datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )
    return jsonify(
        {
            "label": result,
            "confidence": selected["confidence"],
            "risk": risk,
            "model": model_name,
            "hints": stats["suspicious_keywords"][:6],
            "advice": advice,
            "spam_probability": selected["spam_probability"],
            "safe_probability": selected["ham_probability"],
            "ham_probability": selected["ham_probability"],
            "stats": stats,
            "suspicious_patterns": stats["patterns"],
            "explanation": explanation,
            "comparisons": comparisons,
        }
    )


@app.post("/api/compare")
def compare():
    payload = request.get_json(silent=True) or request.form
    message = (payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Please enter a message to compare."}), 400
    if len(message) > 5000:
        return jsonify({"error": "Please keep the message under 5,000 characters."}), 400

    comparisons = compare_models(message)
    stats = inspect_message(message)
    labels = [result["label"] for result in comparisons.values()]
    prediction = "Both models agree." if labels[0] == labels[1] else "The models disagree."
    detected = ", ".join(pattern["pattern"] for pattern in stats["patterns"])
    explanation = prediction
    if detected:
        explanation += f" Message indicators detected: {detected}."
    else:
        explanation += " No listed suspicious wording or patterns were detected."
    return jsonify(
        {
            "message": message,
            "comparisons": comparisons,
            "stats": stats,
            "suspicious_patterns": stats["patterns"],
            "explanation": explanation,
        }
    )


@app.get("/api/dataset")
def dataset():
    spam_count = labels.count("spam")
    ham_count = labels.count("ham")
    return jsonify(
        {
            "total": len(texts),
            "spam": spam_count,
            "ham": ham_count,
            "training_size": len(X_train),
            "testing_size": len(X_test),
            "records": [
                {"text": text, "label": label.upper()}
                for text, label in zip(texts, labels)
            ],
            "samples": [
                {"text": text, "label": label.upper()}
                for text, label in list(zip(texts, labels))[:20]
            ],
        }
    )


@app.get("/api/performance")
def performance():
    return jsonify(
        {
            "test_size": len(X_test),
            "positive_class": "spam",
            "confusion_matrix_labels": ["Spam", "Ham"],
            "models": model_performance,
        }
    )


@app.post("/api/batch")
def batch_analyze():
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return jsonify({"error": "Choose a CSV file to analyze."}), 400
    try:
        content = uploaded.stream.read().decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(content))
        if not reader.fieldnames:
            return jsonify({"error": "The CSV must include a header row."}), 400
        columns = {column.strip().lower(): column for column in reader.fieldnames if column}
        message_column = columns.get("message") or columns.get("text")
        if not message_column:
            return jsonify({"error": "The CSV needs a 'message' or 'text' column."}), 400
        rows = list(reader)
    except (UnicodeDecodeError, csv.Error):
        return jsonify({"error": "Could not read the file as a UTF-8 CSV."}), 400
    if len(rows) > 5000:
        return jsonify({"error": "Please upload no more than 5,000 messages at a time."}), 400

    results = []
    for row_number, row in enumerate(rows, start=2):
        message = (row.get(message_column) or "").strip()
        if not message:
            continue
        prediction = classify(nb_model, message)
        results.append(
            {
                "row": row_number,
                "message": message,
                "label": legacy_label(prediction["prediction"]),
                "confidence": prediction["confidence"],
                "spam_probability": prediction["spam_probability"],
                "ham_probability": prediction["ham_probability"],
            }
        )
    return jsonify(
        {
            "results": results,
            "total": len(results),
            "spam": sum(row["label"] == "SPAM" for row in results),
            "ham": sum(row["label"] == "SAFE" for row in results),
        }
    )


@app.get("/api/history")
def history():
    search = request.args.get("q", "").strip()
    label = request.args.get("label", "").strip().lower()
    clauses, values = [], []
    if search:
        clauses.append("message LIKE ?")
        values.append(f"%{search}%")
    if label == "spam":
        clauses.append("label = 'SPAM'")
    elif label == "ham":
        clauses.append("label = 'SAFE'")
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT message,label,confidence,model,created_at FROM checks"
            + where
            + " ORDER BY id DESC LIMIT 500",
            values,
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/history/clear")
def clear_history():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM checks")
    return jsonify({"ok": True})


@app.get("/api/stats")
def stats():
    with sqlite3.connect(DB_PATH) as conn:
        total, spam, safe = conn.execute(
            "SELECT COUNT(*), SUM(label='SPAM'), SUM(label='SAFE') FROM checks"
        ).fetchone()
    return jsonify({"total": total or 0, "spam": spam or 0, "safe": safe or 0})


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
