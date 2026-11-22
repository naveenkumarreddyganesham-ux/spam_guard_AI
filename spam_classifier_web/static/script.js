const $ = (id) => document.getElementById(id);
const pageCopy = {
  scanner: ['Message Scanner', 'Analyze messages with trained machine learning classifiers.'],
  comparison: ['Model Comparison', 'Compare Naive Bayes and SVM predictions for the same message.'],
  dataset: ['Dataset Explorer', 'Explore the labeled records used to train SpamGuard AI.'],
  performance: ['Model Performance', 'Review metrics calculated from held-out testing records.'],
  batch: ['Batch Analysis', 'Classify a CSV of messages and export the results.'],
  history: ['Scan History', 'Search and filter locally saved message scans.']
};
let latestComparison = null;
let batchResults = [];
let historyTimer;
const DATASET_PAGE_SIZE = 10;
let datasetRecords = [];
let datasetPage = 1;
let showAllDatasetRecords = false;
let randomDatasetRecords = null;

document.querySelectorAll('[data-view]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const view = link.dataset.view;
    document.querySelectorAll('.nav').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
    document.querySelectorAll('.view-section').forEach((section) => section.classList.toggle('active', section.id === view));
    $('page-title').textContent = pageCopy[view][0];
    $('page-subtitle').textContent = pageCopy[view][1];
    history.replaceState(null, '', `#${view}`);
    if (view === 'history') refreshHistory();
    if (view === 'comparison' && latestComparison) drawComparisonChart(latestComparison.comparisons);
    if (view === 'dataset') loadDataset();
  });
});

const initialView = location.hash.slice(1);
if (pageCopy[initialView]) {
  document.querySelectorAll('.nav').forEach((item) => item.classList.toggle('active', item.dataset.view === initialView));
  document.querySelectorAll('.view-section').forEach((section) => section.classList.toggle('active', section.id === initialView));
  $('page-title').textContent = pageCopy[initialView][0];
  $('page-subtitle').textContent = pageCopy[initialView][1];
}

const messageBox = $('message');
messageBox.addEventListener('input', () => $('char-count').textContent = `${messageBox.value.length} / 5000`);
document.querySelectorAll('.sample').forEach((button) => button.addEventListener('click', () => {
  messageBox.value = button.dataset.sample;
  messageBox.dispatchEvent(new Event('input'));
  messageBox.focus();
}));

$('analyze').addEventListener('click', async () => {
  const message = messageBox.value.trim();
  if (!message) {
    showError('Please paste a message first.');
    messageBox.focus();
    return;
  }
  const button = $('analyze');
  button.disabled = true;
  button.textContent = 'Analyzing both models…';
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message, model: $('model').value})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not analyze the message.');
    renderResult(data);
    await Promise.all([refreshHistory(), refreshStats()]);
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✧</span> Analyze message <span class="arrow">→</span>';
  }
});

function showError(message) {
  $('empty-result').classList.remove('hidden');
  $('empty-result').innerHTML = `<div class="empty-icon">!</div><b>Could not analyze message</b><p>${escapeHtml(message)}</p>`;
  $('result-content').classList.add('hidden');
}

function renderResult(data) {
  $('empty-result').classList.add('hidden');
  $('result-content').classList.remove('hidden');
  const spam = data.label === 'SPAM';
  const banner = $('result-banner');
  banner.classList.toggle('spam', spam);
  $('result-symbol').textContent = spam ? '!' : '✓';
  $('result-overline').textContent = spam ? 'SPAM CLASSIFICATION' : 'HAM CLASSIFICATION';
  $('result-label').textContent = spam ? 'SPAM DETECTED' : 'HAM MESSAGE';
  $('result-desc').textContent = 'Prediction from the selected trained classifier.';
  $('confidence').textContent = `${data.confidence}%`;
  const bar = $('conf-bar');
  bar.style.width = `${data.confidence}%`;
  bar.classList.toggle('spam', spam);
  $('risk').textContent = data.risk;
  $('risk').className = spam ? 'high' : '';
  $('spam-prob').textContent = `${data.spam_probability}%`;
  $('ham-prob').textContent = `${data.ham_probability}%`;
  $('explanation').textContent = data.explanation;
  $('patterns').innerHTML = data.suspicious_patterns.length
    ? data.suspicious_patterns.map((pattern) => `<div class="pattern"><b>${escapeHtml(pattern.pattern)}</b><span>${escapeHtml(pattern.reason)}</span></div>`).join('')
    : '<span class="no-hints">No suspicious pattern indicators detected.</span>';
  const stats = [
    ['Words', data.stats.word_count],
    ['Characters (no spaces)', data.stats.character_count],
    ['Message length', data.stats.message_length],
    ['Links', data.stats.link_count],
    ['Digits', data.stats.digit_count],
    ['Uppercase letters', `${data.stats.uppercase_percentage}%`],
    ['Suspicious keywords', data.stats.suspicious_keywords.length]
  ];
  $('message-stats').innerHTML = stats.map(([label, value]) => `<div class="mini-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('');
  $('advice').textContent = `Safety suggestion: ${data.advice}`;
}

function renderComparison(data) {
  const models = data.comparisons;
  latestComparison = data;
  const names = ['Naive Bayes', 'SVM'];
  $('comparison-empty').classList.add('hidden');
  $('comparison-content').classList.remove('hidden');
  $('comparison-error').classList.add('hidden');
  $('comparison-cards').innerHTML = names.map((name) => {
    const item = models[name];
    const spam = item.label === 'SPAM';
    return `<article class="comparison-card"><div class="compare-title"><h3>${name}</h3><span class="pill ${spam ? 'spam' : 'safe'}">${spam ? 'SPAM' : 'HAM'}</span></div><div class="compare-prediction">Prediction: <b>${spam ? 'Spam' : 'Ham'}</b></div><div class="compare-confidence">${item.confidence}% <small>confidence</small></div><div class="compare-probs"><span>Spam probability <b>${item.spam_probability}%</b></span><span>Ham probability <b>${item.ham_probability}%</b></span></div></article>`;
  }).join('');
  const same = models['Naive Bayes'].label === models.SVM.label;
  $('comparison-summary').textContent = same
    ? `Both models agree: the message is classified as ${models.SVM.label === 'SPAM' ? 'Spam' : 'Ham'}.`
    : 'The models disagree on this message. Review the content and probabilities before acting.';
  $('comparison-quoted-message').textContent = data.message;
  const stats = [
    ['Words', data.stats.word_count],
    ['Characters (no spaces)', data.stats.character_count],
    ['Message length', data.stats.message_length],
    ['Links', data.stats.link_count],
    ['Digits', data.stats.digit_count],
    ['Uppercase letters', `${data.stats.uppercase_percentage}%`],
    ['Suspicious keywords', data.stats.suspicious_keywords.length]
  ];
  $('comparison-stats').innerHTML = stats.map(([label, value]) => `<div class="mini-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('');
  $('comparison-patterns').innerHTML = data.suspicious_patterns.length
    ? data.suspicious_patterns.map((pattern) => `<div class="pattern"><b>${escapeHtml(pattern.pattern)}</b><span>${escapeHtml(pattern.reason)}</span></div>`).join('')
    : '<span class="no-hints">No suspicious keyword or pattern indicators detected.</span>';
  $('comparison-explanation').textContent = data.explanation;
  drawComparisonChart(models);
}

function drawComparisonChart(comparisons) {
  drawBars($('comparison-chart'), [
    {label: 'NB · Confidence', value: comparisons['Naive Bayes'].confidence, color: '#596fe8'},
    {label: 'NB · Spam', value: comparisons['Naive Bayes'].spam_probability, color: '#e16d62'},
    {label: 'NB · Ham', value: comparisons['Naive Bayes'].ham_probability, color: '#49ac83'},
    {label: 'SVM · Confidence', value: comparisons.SVM.confidence, color: '#596fe8'},
    {label: 'SVM · Spam', value: comparisons.SVM.spam_probability, color: '#e16d62'},
    {label: 'SVM · Ham', value: comparisons.SVM.ham_probability, color: '#49ac83'}
  ], 'Model confidence and class probabilities');
}

$('comparison-message').addEventListener('input', () => {
  $('comparison-char-count').textContent = `${$('comparison-message').value.length} / 5000`;
});
document.querySelectorAll('.compare-sample').forEach((button) => button.addEventListener('click', () => {
  $('comparison-message').value = button.dataset.compareSample;
  $('comparison-message').dispatchEvent(new Event('input'));
  $('comparison-message').focus();
}));
$('comparison-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('comparison-message').value.trim();
  if (!message) {
    $('comparison-error').textContent = 'Please enter a message to compare.';
    $('comparison-error').classList.remove('hidden');
    $('comparison-message').focus();
    return;
  }
  const button = $('compare-models');
  button.disabled = true;
  button.textContent = 'Comparing models…';
  $('comparison-error').classList.add('hidden');
  try {
    const response = await fetch('/api/compare', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not compare the models.');
    renderComparison(data);
  } catch (error) {
    $('comparison-error').textContent = error.message;
    $('comparison-error').classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.innerHTML = 'Compare Models <span class="arrow">→</span>';
  }
});

async function loadDataset() {
  try {
    const response = await fetch('/api/dataset');
    if (!response.ok) throw new Error('Could not load dataset details.');
    const data = await response.json();
    $('dataset-total').textContent = data.total;
    $('dataset-spam').textContent = data.spam;
    $('dataset-ham').textContent = data.ham;
    $('training-size').textContent = data.training_size;
    $('testing-size').textContent = data.testing_size;
    datasetRecords = data.records || data.samples || [];
    renderDatasetRecords();
    drawPieChart($('dataset-chart'), [
      {label: 'Spam', value: data.spam, color: '#e16d62'},
      {label: 'Ham', value: data.ham, color: '#49ac83'}
    ]);
    $('dataset-legend').innerHTML = `<span><i class="legend-dot spam-dot"></i>Spam ${data.spam}</span><span><i class="legend-dot ham-dot"></i>Ham ${data.ham}</span>`;
  } catch (error) {
    $('dataset-rows').innerHTML = `<tr><td colspan="2">${escapeHtml(error.message)}</td></tr>`;
    $('dataset-results-count').textContent = 'Could not load dataset records.';
  }
}

function getFilteredDatasetRecords() {
  const query = $('dataset-search').value.trim().toLowerCase();
  const label = $('dataset-label-filter').value;
  const filtered = datasetRecords.filter((record) =>
    (label === 'all' || record.label === label)
    && (!query || record.text.toLowerCase().includes(query))
  );
  if (label !== 'all') return filtered;

  const ham = filtered.filter((record) => record.label === 'HAM');
  const spam = filtered.filter((record) => record.label === 'SPAM');
  const balanced = [];
  for (let index = 0; index < Math.max(ham.length, spam.length); index += 1) {
    if (ham[index]) balanced.push(ham[index]);
    if (spam[index]) balanced.push(spam[index]);
  }
  return balanced;
}

function renderDatasetRecords() {
  const matches = getFilteredDatasetRecords();
  const records = randomDatasetRecords || matches;
  const pageCount = showAllDatasetRecords || randomDatasetRecords
    ? 1
    : Math.max(1, Math.ceil(records.length / DATASET_PAGE_SIZE));
  datasetPage = Math.min(datasetPage, pageCount);
  const start = showAllDatasetRecords || randomDatasetRecords
    ? 0
    : (datasetPage - 1) * DATASET_PAGE_SIZE;
  const visibleRecords = showAllDatasetRecords || randomDatasetRecords
    ? records
    : records.slice(start, start + DATASET_PAGE_SIZE);

  $('dataset-rows').innerHTML = visibleRecords.length
    ? visibleRecords.map((record) =>
      `<tr><td>${escapeHtml(record.text)}</td><td><span class="pill ${record.label === 'SPAM' ? 'spam' : 'safe'}">${record.label}</span></td></tr>`
    ).join('')
    : '<tr><td colspan="2" class="dataset-no-results">No matching dataset records.</td></tr>';

  if (randomDatasetRecords) {
    $('dataset-results-count').textContent = `Showing ${visibleRecords.length} random record(s) of ${matches.length} matching messages.`;
  } else if (showAllDatasetRecords) {
    $('dataset-results-count').textContent = `Showing all ${records.length} matching record(s).`;
  } else {
    const first = records.length ? start + 1 : 0;
    const last = Math.min(start + visibleRecords.length, records.length);
    $('dataset-results-count').textContent = `Showing ${first}–${last} of ${records.length} matching record(s).`;
  }

  $('dataset-pagination').classList.toggle('hidden', showAllDatasetRecords || Boolean(randomDatasetRecords));
  $('dataset-page-info').textContent = `Page ${datasetPage} of ${pageCount}`;
  $('dataset-previous').disabled = datasetPage <= 1;
  $('dataset-next').disabled = datasetPage >= pageCount;
  $('dataset-show-all').textContent = showAllDatasetRecords ? 'Paginate' : 'Show All';
  document.querySelectorAll('.dataset-stat-card').forEach((card) => {
    const selected = card.dataset.datasetFilter === $('dataset-label-filter').value;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
}

function selectDatasetFilter(label, showAll) {
  $('dataset-label-filter').value = label;
  $('dataset-search').value = '';
  randomDatasetRecords = null;
  showAllDatasetRecords = showAll;
  datasetPage = 1;
  renderDatasetRecords();
}

$('dataset-card-total').addEventListener('click', () => selectDatasetFilter('all', true));
$('dataset-card-spam').addEventListener('click', () => selectDatasetFilter('SPAM', true));
$('dataset-card-ham').addEventListener('click', () => selectDatasetFilter('HAM', true));
$('dataset-clear-filters').addEventListener('click', () => selectDatasetFilter('all', false));
$('dataset-search').addEventListener('input', () => {
  datasetPage = 1;
  randomDatasetRecords = null;
  renderDatasetRecords();
});
$('dataset-label-filter').addEventListener('change', () => {
  datasetPage = 1;
  randomDatasetRecords = null;
  renderDatasetRecords();
});
$('dataset-previous').addEventListener('click', () => {
  if (datasetPage > 1) {
    datasetPage -= 1;
    renderDatasetRecords();
  }
});
$('dataset-next').addEventListener('click', () => {
  const totalPages = Math.ceil(getFilteredDatasetRecords().length / DATASET_PAGE_SIZE);
  if (datasetPage < totalPages) {
    datasetPage += 1;
    renderDatasetRecords();
  }
});
$('dataset-show-all').addEventListener('click', () => {
  showAllDatasetRecords = !showAllDatasetRecords;
  randomDatasetRecords = null;
  datasetPage = 1;
  renderDatasetRecords();
});
$('dataset-random').addEventListener('click', () => {
  const pool = getFilteredDatasetRecords().slice();
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
  }
  randomDatasetRecords = pool.slice(0, Math.min(DATASET_PAGE_SIZE, pool.length));
  showAllDatasetRecords = false;
  datasetPage = 1;
  renderDatasetRecords();
});

let performanceModels = null;
async function fetchPerformance() {
  try {
    const response = await fetch('/api/performance');
    if (!response.ok) throw new Error('Could not load model performance.');
    const data = await response.json();
    performanceModels = data.models;
    $('performance-test-size').textContent = data.test_size;
    renderPerformance(performanceModels[$('performance-model').value]);
  } catch (error) {
    $('confusion-matrix').textContent = error.message;
  }
}

function renderPerformance(model) {
  if (!model) return;
  $('metric-accuracy').textContent = `${model.accuracy}%`;
  $('metric-precision').textContent = `${model.precision}%`;
  $('metric-recall').textContent = `${model.recall}%`;
  $('metric-f1').textContent = `${model.f1}%`;
  const matrix = model.confusion_matrix;
  $('confusion-matrix').innerHTML = `<div class="matrix-corner"></div><b>Pred Spam</b><b>Pred Ham</b><b>Actual Spam</b><strong>${matrix[0][0]}</strong><strong>${matrix[0][1]}</strong><b>Actual Ham</b><strong>${matrix[1][0]}</strong><strong>${matrix[1][1]}</strong>`;
  $('true-positive').textContent = model.true_positive;
  $('true-negative').textContent = model.true_negative;
  $('false-positive').textContent = model.false_positive;
  $('false-negative').textContent = model.false_negative;
}

$('performance-model').addEventListener('change', () => {
  if (performanceModels) renderPerformance(performanceModels[$('performance-model').value]);
});

$('batch-file').addEventListener('change', () => {
  $('file-name').textContent = $('batch-file').files[0]?.name || 'UTF-8 CSV · max 10 MB';
});
$('batch-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('batch-error').classList.add('hidden');
  $('batch-results').classList.add('hidden');
  const button = $('batch-submit');
  button.disabled = true;
  button.textContent = 'Classifying…';
  try {
    const response = await fetch('/api/batch', {method: 'POST', body: new FormData(event.currentTarget)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not classify this CSV.');
    batchResults = data.results;
    $('batch-summary').textContent = `Classified ${data.total} messages · ${data.spam} Spam · ${data.ham} Ham`;
    $('batch-rows').innerHTML = data.results.length
      ? data.results.map((row) => `<tr><td>${row.row}</td><td>${escapeHtml(row.message)}</td><td><span class="pill ${row.label === 'SPAM' ? 'spam' : 'safe'}">${row.label === 'SPAM' ? 'SPAM' : 'HAM'}</span></td><td>${row.confidence}%</td><td>${row.spam_probability}%</td></tr>`).join('')
      : '<tr><td colspan="5">No non-empty message rows found.</td></tr>';
    $('batch-results').classList.remove('hidden');
  } catch (error) {
    $('batch-error').textContent = error.message;
    $('batch-error').classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.innerHTML = 'Classify messages <span class="arrow">→</span>';
  }
});

$('download-results').addEventListener('click', () => {
  const rows = [['row', 'message', 'prediction', 'confidence_percent', 'spam_probability_percent', 'ham_probability_percent']];
  batchResults.forEach((row) => rows.push([row.row, row.message, row.label, row.confidence, row.spam_probability, row.ham_probability]));
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], {type: 'text/csv;charset=utf-8'}));
  link.download = 'spamguard_classified_results.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

$('history-search').addEventListener('input', () => {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(refreshHistory, 250);
});
$('history-filter').addEventListener('change', refreshHistory);

async function refreshHistory() {
  const params = new URLSearchParams();
  if ($('history-search').value.trim()) params.set('q', $('history-search').value.trim());
  if ($('history-filter').value) params.set('label', $('history-filter').value);
  try {
    const response = await fetch(`/api/history?${params}`);
    if (!response.ok) throw new Error('Could not load scan history.');
    const rows = await response.json();
    $('history-list').innerHTML = rows.length ? rows.map((row) => {
      const spam = row.label === 'SPAM';
      return `<div class="history-item"><div><div class="history-text">${escapeHtml(row.message)}</div><div class="history-meta">${escapeHtml(row.created_at)} · ${escapeHtml(row.model)}</div></div><div class="history-result"><span class="pill ${spam ? 'spam' : 'safe'}">${spam ? 'SPAM' : 'HAM'}</span><div class="history-conf">${Math.round(row.confidence * 100)}% confidence</div></div></div>`;
    }).join('') : '<div class="empty-state">No matching scans found.</div>';
  } catch (error) {
    $('history-list').innerHTML = `<div class="error-message">${escapeHtml(error.message)}</div>`;
  }
}

async function refreshStats() {
  try {
    const response = await fetch('/api/stats');
    if (!response.ok) throw new Error('Could not load scan totals.');
    const stats = await response.json();
    $('total-count').textContent = stats.total;
    $('spam-count').textContent = stats.spam;
    $('safe-count').textContent = stats.safe;
  } catch (error) {
    $('total-count').textContent = '—';
  }
}

$('clear-history').addEventListener('click', async () => {
  if (!confirm('Clear all saved scan history?')) return;
  const button = $('clear-history');
  button.disabled = true;
  try {
    const response = await fetch('/api/history/clear', {method: 'POST'});
    if (!response.ok) throw new Error('Could not clear scan history.');
    await Promise.all([refreshHistory(), refreshStats()]);
  } catch (error) {
    $('history-list').innerHTML = `<div class="error-message">${escapeHtml(error.message)}</div>`;
  } finally {
    button.disabled = false;
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function prepareCanvas(canvas, height = 250) {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(canvas.clientWidth, 280);
  canvas.style.height = `${height}px`;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  return {context, width, height};
}

function drawBars(canvas, values, caption) {
  if (!canvas || !canvas.clientWidth) return;
  const chartHeight = Math.max(180, 62 + values.length * 38);
  const {context, width} = prepareCanvas(canvas, chartHeight);
  context.font = '12px system-ui';
  context.fillStyle = '#7b879a';
  context.fillText(caption, 12, 20);
  const left = 132;
  const usable = width - left - 48;
  values.forEach((item, index) => {
    const y = 42 + index * 38;
    context.fillStyle = '#627087';
    context.fillText(item.label, 12, y + 14);
    context.fillStyle = '#edf0f6';
    context.fillRect(left, y, usable, 18);
    context.fillStyle = item.color;
    context.fillRect(left, y, usable * Math.min(item.value, 100) / 100, 18);
    context.fillStyle = '#26354c';
    context.fillText(`${item.value}%`, left + usable + 7, y + 14);
  });
}

function drawPieChart(canvas, values) {
  if (!canvas || !canvas.clientWidth) return;
  const {context, width, height} = prepareCanvas(canvas);
  const total = values.reduce((sum, item) => sum + item.value, 0);
  if (!total) return;
  let start = -Math.PI / 2;
  values.forEach((item) => {
    const end = start + (item.value / total) * Math.PI * 2;
    context.beginPath();
    context.moveTo(width / 2, height / 2);
    context.arc(width / 2, height / 2, 84, start, end);
    context.closePath();
    context.fillStyle = item.color;
    context.fill();
    start = end;
  });
}

refreshHistory();
refreshStats();
loadDataset();
fetchPerformance();

window.addEventListener('resize', () => {
  if (latestComparison && $('comparison').classList.contains('active')) drawComparisonChart(latestComparison.comparisons);
  if ($('dataset').classList.contains('active')) loadDataset();
});
