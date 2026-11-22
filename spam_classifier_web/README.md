# SpamGuard AI — Message Recognition and Classification System

A local Flask dashboard for the **Artificial Intelligence-Based Automated Spam Message Recognition and Classification System**. It uses the project's labeled `data/messages.csv` dataset and trained TF-IDF pipelines with Multinomial Naive Bayes and SVM.

## Requirements

- Windows 10/11
- Python 3.10 or newer
- Internet access on first setup if pip needs to download dependencies

## Run in VS Code (Windows)

1. Open the `spam_classifier_web` folder in VS Code.
2. Select **Terminal → New Terminal**.
3. Run `.\run.bat` (or double-click `run.bat` in File Explorer).
   - The script creates `.venv` if needed, installs `requirements.txt`, and starts Flask.
4. Open **http://127.0.0.1:5000** in your browser.
5. Press **Ctrl+C** in the terminal to stop the server.

## Manual start (PowerShell)

From the `spam_classifier_web` project folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python app.py
```

Then visit **http://127.0.0.1:5000**. If PowerShell blocks activation, use the `run.bat` steps above or execute `.venv\Scripts\python.exe app.py` after installing the requirements.

## Dashboard features

- **Message Scanner:** Select a primary result model, get predictions and Spam/Ham probabilities from both models, confidence, message statistics, suspicious pattern hints, and a model-based explanation.
- **Model Comparison:** Compare Naive Bayes and SVM outputs for the same message with a probability chart.
- **Dataset Explorer:** Review Spam/Ham counts, the dataset distribution, the deterministic stratified training/testing split, and sample records.
- **Model Performance:** View Accuracy, Precision, Recall, F1-score, and a confusion matrix for each model, computed from the held-out testing records. Spam is treated as the positive class.
- **Batch Analysis:** Upload a UTF-8 CSV with a `message` or `text` column (up to 5,000 messages / 10 MB), inspect the Naive Bayes results, and download them as CSV.
- **Scan History:** Search, filter by Spam/Ham, view timestamps, and clear locally stored history.

Interactive and batch predictions use models trained on the full bundled dataset. Performance figures are calculated separately: an 80/20 stratified split with a fixed random seed is used to train evaluation-only models and score the held-out test data. The bundled CSV is a small, hand-curated teaching/demo dataset; its metrics and predictions are not a production benchmark or a guarantee.

Scan history is stored in the local `history.db` SQLite file. The project keeps the existing `/api/analyze`, `/api/history`, `/api/history/clear`, and `/api/stats` endpoints and adds dataset, performance, and batch endpoints.
