// State dùng chung, đồng bộ với Google Sheets qua api.js
let members = [];
let tasks = [];
let expenses = [];
let taskFilterAssignee = '';
const UNASSIGNED_FILTER_VALUE = '__unassigned__';
const UNASSIGNED_LABEL = 'Chưa phân công';

// Quỹ nhóm đã góp trước (VD: mỗi người góp sẵn 1 khoản trước chuyến đi). Chỉ nhập trên màn
// hình và tính bằng JS — không qua api.js/Google Sheet — nên chỉ hiện trên máy đã nhập,
// không đồng bộ cho người khác trong nhóm.
const FUND_STORAGE_KEY = 'campingFundAmount';
let fundAmount = Math.max(0, Number(localStorage.getItem(FUND_STORAGE_KEY)) || 0);

// Poll version (rẻ, chỉ 1 số) thường xuyên hơn hẳn; chỉ tải lại toàn bộ data khi version đổi.
const VERSION_POLL_INTERVAL_MS = 4000;
let lastVersion = null;

function fmtMoney(n) {
  return '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');
}

function setStatus(text) {
  document.getElementById('status-indicator').textContent = text;
}

let pollTimer = null;
let isCheckingVersion = false;

async function checkVersion() {
  if (isCheckingVersion || isLoading) return;
  isCheckingVersion = true;
  try {
    const v = await api.version();
    if (lastVersion !== null && v !== lastVersion) {
      await loadAll();
    }
    lastVersion = v;
  } catch (err) {
    // Lỗi mạng tạm thời — bỏ qua, vòng poll version sau sẽ thử lại.
    console.error(err);
  } finally {
    isCheckingVersion = false;
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(checkVersion, VERSION_POLL_INTERVAL_MS);
}

async function init() {
  await loadAll();
  try {
    lastVersion = await api.version();
  } catch (err) {
    console.error(err);
  }
  startPolling();
}

// Sau khi tự mình thêm/sửa/xoá, cập nhật lastVersion từ version Apps Script vừa trả về
// (nếu có) để vòng checkVersion tiếp theo không tải lại data một lần thừa.
function syncVersionFrom_(result) {
  if (result && typeof result.version === 'number') {
    lastVersion = result.version;
  }
}

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---------- Load ----------
let isLoading = false;

async function loadAll() {
  if (isLoading) return; // tránh chồng lấp khi vòng poll trước chưa xong
  isLoading = true;
  setStatus('Đang tải...');
  try {
    // Gọi tuần tự (không Promise.all) để giảm số request đồng thời tới Apps Script,
    // nguồn gây lỗi 404 echo khi nhiều request cùng lúc đè lên 1 deployment.
    members = await api.list('Members');
    tasks = await api.list('Tasks');
    expenses = await api.list('Expenses');
    renderMembers();
    renderTaskAssigneeOptions();
    renderTaskFilterOptions();
    renderTasks();
    renderTaskProgress();
    renderExpensePayerOptions();
    renderExpenseParticipantOptions();
    renderExpenses();
    renderExpenseBreakdown();
    renderBalances();
    setStatus('Đã cập nhật ' + new Date().toLocaleTimeString('vi-VN'));
  } catch (err) {
    console.error(err);
    setStatus('Lỗi tải dữ liệu — kiểm tra config.js');
  } finally {
    isLoading = false;
  }
}

document.getElementById('refresh-btn').addEventListener('click', loadAll);

// ---------- Members ----------
function renderMembers() {
  const list = document.getElementById('member-list');
  const empty = document.getElementById('member-empty');
  list.innerHTML = '';
  empty.hidden = members.length > 0;
  members.forEach(m => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'member-name';
    nameSpan.textContent = m.name;
    li.appendChild(nameSpan);

    const sizeLabel = document.createElement('label');
    sizeLabel.className = 'family-size-field';
    sizeLabel.appendChild(document.createTextNode('Số người: '));
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.min = '1';
    sizeInput.step = '1';
    sizeInput.className = 'family-size-input';
    sizeInput.title = 'Số người trong gia đình mà thành viên này đại diện (dùng khi chia tiền theo tỉ lệ)';
    sizeInput.value = familySizeOf(m.name);
    sizeInput.addEventListener('change', async () => {
      const val = Math.max(1, parseInt(sizeInput.value, 10) || 1);
      sizeInput.value = val;
      syncVersionFrom_(await api.update('Members', m.id, { familySize: val }));
      await loadAll();
    });
    sizeLabel.appendChild(sizeInput);
    li.appendChild(sizeLabel);

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Xoá';
    delBtn.className = 'row-delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Xoá thành viên "${m.name}"?`)) return;
      syncVersionFrom_(await api.remove('Members', m.id));
      await loadAll();
    });
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

document.getElementById('member-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('member-name');
  const familySizeInput = document.getElementById('member-family-size');
  const name = nameInput.value.trim();
  if (!name) return;
  const familySize = Math.max(1, parseInt(familySizeInput.value, 10) || 1);
  syncVersionFrom_(await api.add('Members', { name, familySize }));
  nameInput.value = '';
  familySizeInput.value = '';
  await loadAll();
});

function memberOptionsHtml() {
  return members.map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');
}

// Số người mỗi thành viên đại diện (gia đình 2 người, 3 người, ...). Mặc định 1 nếu chưa khai báo.
function familySizeOf(name) {
  const m = members.find(mm => mm.name === name);
  const n = m ? parseInt(m.familySize, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// ---------- Tasks ----------
function renderTaskAssigneeOptions() {
  document.getElementById('task-assignee').innerHTML =
    '<option value="">-- Ai phụ trách? --</option>' + memberOptionsHtml();
}

function renderTaskFilterOptions() {
  const select = document.getElementById('task-filter-assignee');
  select.innerHTML =
    '<option value="">-- Tất cả --</option>' +
    memberOptionsHtml() +
    `<option value="${UNASSIGNED_FILTER_VALUE}">Chưa phân công</option>`;
  select.value = taskFilterAssignee;
}

document.getElementById('task-filter-assignee').addEventListener('change', (e) => {
  taskFilterAssignee = e.target.value;
  renderTasks();
});

// ---------- Tiến độ theo người ----------
function renderTaskProgress() {
  const container = document.getElementById('progress-list');
  const empty = document.getElementById('progress-empty');
  container.innerHTML = '';

  const stats = new Map(); // tên -> { total, done, doing, todo }
  members.forEach(m => stats.set(m.name, { total: 0, done: 0, doing: 0, todo: 0 }));
  tasks.forEach(t => {
    const key = t.assignee || UNASSIGNED_LABEL;
    if (!stats.has(key)) stats.set(key, { total: 0, done: 0, doing: 0, todo: 0 });
    const s = stats.get(key);
    s.total++;
    s[t.status || 'todo']++;
  });

  const order = [...members.map(m => m.name), UNASSIGNED_LABEL];
  const rows = order
    .filter(name => stats.has(name) && stats.get(name).total > 0)
    .map(name => ({ name, ...stats.get(name) }));

  empty.hidden = rows.length > 0;

  rows.forEach(row => {
    const percent = Math.round((row.done / row.total) * 100);
    const div = document.createElement('div');
    div.className = 'progress-item';
    div.innerHTML = `
      <div class="progress-item-header">
        <span class="progress-name">${escapeHtml(row.name)}</span>
        <span class="progress-count">${row.done}/${row.total} xong${row.doing ? ` · ${row.doing} đang làm` : ''}</span>
      </div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:${percent}%"></div>
      </div>
    `;
    container.appendChild(div);
  });
}

function renderTasks() {
  const tbody = document.getElementById('task-tbody');
  const empty = document.getElementById('task-empty');
  tbody.innerHTML = '';

  const filtered = tasks.filter(t => {
    if (!taskFilterAssignee) return true;
    if (taskFilterAssignee === UNASSIGNED_FILTER_VALUE) return !t.assignee;
    return t.assignee === taskFilterAssignee;
  });

  empty.hidden = filtered.length > 0;
  empty.textContent = tasks.length === 0
    ? 'Chưa có công việc nào. Thêm việc đầu tiên ở trên nhé!'
    : 'Không có công việc nào của người này.';

  filtered.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Nhóm">${escapeHtml(t.group || 'Khác')}</td>
      <td data-label="Hạng mục">${escapeHtml(t.task)}</td>
      <td data-label="Người phụ trách">${escapeHtml(t.assignee || '—')}</td>
      <td data-label="Số lượng">${escapeHtml(t.quantity || '')}</td>
      <td data-label="Trạng thái"></td>
      <td data-label="Ghi chú">${escapeHtml(t.note || '')}</td>
      <td></td>
    `;
    const statusSelect = document.createElement('select');
    statusSelect.className = 'status-select status-' + (t.status || 'todo');
    ['todo', 'doing', 'done'].forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = { todo: 'Chưa làm', doing: 'Đang làm', done: 'Xong' }[s];
      if ((t.status || 'todo') === s) opt.selected = true;
      statusSelect.appendChild(opt);
    });
    statusSelect.addEventListener('change', async () => {
      syncVersionFrom_(await api.update('Tasks', t.id, { status: statusSelect.value }));
      await loadAll();
    });
    tr.children[4].appendChild(statusSelect);

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Xoá';
    delBtn.className = 'row-delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Xoá hạng mục "${t.task}"?`)) return;
      syncVersionFrom_(await api.remove('Tasks', t.id));
      await loadAll();
    });
    tr.children[6].appendChild(delBtn);

    tbody.appendChild(tr);
  });
}

document.getElementById('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const group = document.getElementById('task-group').value.trim();
  const task = document.getElementById('task-name').value.trim();
  const assignee = document.getElementById('task-assignee').value;
  const quantity = document.getElementById('task-quantity').value.trim();
  const note = document.getElementById('task-note').value.trim();
  if (!task) return;
  syncVersionFrom_(await api.add('Tasks', { group, task, assignee, quantity, note, status: 'todo' }));
  e.target.reset();
  await loadAll();
});

// ---------- Expenses ----------
function renderExpensePayerOptions() {
  document.getElementById('exp-payer').innerHTML =
    '<option value="">-- Ai đã trả? --</option>' + memberOptionsHtml();
}

function renderExpenseParticipantOptions() {
  const container = document.getElementById('exp-participants');
  container.innerHTML = '';
  members.forEach(m => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = m.name;
    cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(`${m.name} (${familySizeOf(m.name)} người)`));
    container.appendChild(label);
  });
}

// Khoản chi mới nhập được lưu ở cuối danh sách -> id (mốc thời gian) lớn hơn.
// Hiển thị mới nhất lên trên cho dễ theo dõi.
function expensesNewestFirst() {
  return [...expenses].sort((a, b) => Number(b.id) - Number(a.id));
}

function participantsOf(x) {
  return String(x.participants || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Chia cho ĐỦ hết thành viên -> chia theo tỉ lệ gia đình (chia đều cả nhóm theo đầu người).
// Chỉ chọn một phần thành viên -> khoản chi riêng, chia đều cho những người được chọn.
function isFullGroupExpense(x) {
  const participants = participantsOf(x);
  return members.length > 0 &&
    participants.length === members.length &&
    members.every(m => participants.includes(m.name));
}

// Tỉ lệ còn lại của các khoản chi CHUNG cả nhóm sau khi trừ thẳng quỹ đã góp trước
// (quỹ chỉ áp dụng lên phần chia đều cả nhóm, không đụng tới các khoản chia riêng).
// Nhân mỗi khoản chi chung với tỉ lệ này trước khi chia theo tỉ lệ gia đình, để tổng owed
// luôn khớp đúng (tổng chi chung − quỹ) dù có 1 hay nhiều khoản chi chung.
function fullGroupRatio() {
  const raw = expenses.filter(isFullGroupExpense).reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  if (raw <= 0) return 1;
  return Math.max(0, raw - fundAmount) / raw;
}

const fundInput = document.getElementById('fund-amount');
fundInput.value = fundAmount || '';
fundInput.addEventListener('input', () => {
  fundAmount = Math.max(0, Number(fundInput.value) || 0);
  localStorage.setItem(FUND_STORAGE_KEY, String(fundAmount));
  renderExpenseBreakdown();
  renderBalances();
});

const SELF_PAID_KEY = '__self__';

// Các khoản chia riêng mà một người tham gia, gộp theo tên người đã trả — để biết cụ thể
// nợ của AI, không chỉ là tên khoản chi. Khoản mà chính người này tự trả (payer === name)
// vẫn phải tính vào (đánh dấu SELF_PAID_KEY) để tổng cộng khớp với số hiển thị ở dòng chính
// — phần đó không nợ ai, chỉ là tự chi cho phần của mình.
function partialSharesOf(name) {
  const totals = {};
  expensesNewestFirst()
    .filter(x => !isFullGroupExpense(x))
    .filter(x => participantsOf(x).includes(name))
    .forEach(x => {
      const share = (Number(x.amount) || 0) / participantsOf(x).length;
      const key = x.payer === name ? SELF_PAID_KEY : x.payer;
      totals[key] = (totals[key] || 0) + share;
    });
  return Object.entries(totals).map(([payer, share]) => ({ payer, share }));
}

function renderExpenses() {
  const tbody = document.getElementById('expense-tbody');
  const empty = document.getElementById('expense-empty');
  tbody.innerHTML = '';
  empty.hidden = expenses.length > 0;
  expensesNewestFirst().forEach(x => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Khoản chi">${escapeHtml(x.description)}</td>
      <td data-label="Số tiền">${fmtMoney(x.amount)}</td>
      <td data-label="Người trả">${escapeHtml(x.payer)}</td>
      <td data-label="Chia cho">${escapeHtml(x.participants)}</td>
      <td data-label="Ghi chú">${escapeHtml(x.note)}</td>
      <td></td>
    `;
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Xoá';
    delBtn.className = 'row-delete';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Xoá khoản chi "${x.description}"?`)) return;
      syncVersionFrom_(await api.remove('Expenses', x.id));
      await loadAll();
    });
    tr.children[5].appendChild(delBtn);
    tbody.appendChild(tr);
  });
}

document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const description = document.getElementById('exp-desc').value.trim();
  const amount = Number(document.getElementById('exp-amount').value);
  const payer = document.getElementById('exp-payer').value;
  const participants = Array.from(document.querySelectorAll('#exp-participants input:checked')).map(cb => cb.value);
  const note = document.getElementById('exp-note').value.trim();
  if (!description || !amount || !payer || participants.length === 0) {
    alert('Vui lòng điền đủ thông tin và chọn ít nhất 1 người chia tiền.');
    return;
  }
  syncVersionFrom_(await api.add('Expenses', {
    description,
    amount,
    payer,
    participants: participants.join(', '),
    note,
    date: new Date().toISOString().slice(0, 10),
  }));
  e.target.reset();
  await loadAll();
});

// Chia một tổng số tiền nguyên yên cho các "trọng số" (VD: số người mỗi gia đình), đảm bảo
// tổng các phần chia ra luôn khớp đúng tổng ban đầu — dùng phương pháp phần dư lớn nhất
// (largest remainder) để không ai bị lệch 1 yên do làm tròn khi hiển thị.
function splitFairly(total, weights) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return weights.map(() => 0);
  const totalInt = Math.round(total);
  const raw = weights.map(w => totalInt * w / totalWeight);
  const base = raw.map(r => Math.floor(r));
  const remainder = totalInt - base.reduce((sum, b) => sum + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - base[i] }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...base];
  for (let k = 0; k < remainder; k++) result[order[k].i] += 1;
  return result;
}

// Tổng số tiền các khoản chia ĐỦ cả nhóm + mức chia trung bình mỗi đầu người (theo tỉ lệ gia đình).
// Dùng chung cho cả phần tổng kết và phần liệt kê số dư (renderBalanceBreakdown).
// totalFullGroupAmount đã trừ thẳng quỹ nhóm (fundAmount) — chỉ phần còn lại mới đem chia;
// rawFullGroupAmount là tổng CHƯA trừ quỹ, dùng để hiển thị số tiền thực đã chi.
function fullGroupStats() {
  const fullGroupExpenses = expenses.filter(isFullGroupExpense);
  const rawFullGroupAmount = fullGroupExpenses.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  const totalFullGroupAmount = Math.max(0, rawFullGroupAmount - fundAmount);
  const totalIndividuals = members.reduce((sum, m) => sum + familySizeOf(m.name), 0);
  const avgPerPerson = totalIndividuals > 0 ? totalFullGroupAmount / totalIndividuals : 0;

  // Phần chia đều cả nhóm của từng người, làm tròn nguyên yên và bù phần dư để tổng luôn
  // khớp totalFullGroupAmount — tránh trường hợp avgPerPerson × familySize lẻ yên khiến
  // tổng hiển thị của mọi người lệch 1 yên so với tổng thực.
  const fullGroupOwedByName = {};
  const shares = splitFairly(totalFullGroupAmount, members.map(m => familySizeOf(m.name)));
  members.forEach((m, i) => { fullGroupOwedByName[m.name] = shares[i] || 0; });

  return { fullGroupExpenses, rawFullGroupAmount, totalFullGroupAmount, totalIndividuals, avgPerPerson, fullGroupOwedByName };
}

// ---------- Tổng kết chia tiền (chia đều cả nhóm vs. chia riêng) ----------
function renderExpenseBreakdown() {
  const totalAmount = expenses.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  document.getElementById('expense-total').textContent = fmtMoney(totalAmount);

  const { fullGroupExpenses, rawFullGroupAmount, totalFullGroupAmount, totalIndividuals, avgPerPerson } = fullGroupStats();
  const partialExpenses = expensesNewestFirst().filter(x => !isFullGroupExpense(x));
  const totalPartialAmount = partialExpenses.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  document.getElementById('expense-total-full').textContent = fmtMoney(rawFullGroupAmount);
  document.getElementById('expense-total-partial').textContent = fmtMoney(totalPartialAmount);

  const fundNetLine = document.getElementById('fund-net-line');
  fundNetLine.hidden = fundAmount <= 0;
  document.getElementById('fund-net-amount').textContent = fmtMoney(totalFullGroupAmount);

  const avgLine = document.getElementById('full-group-avg-tile');
  avgLine.hidden = fullGroupExpenses.length === 0 || totalIndividuals === 0;
  document.getElementById('full-group-people-count').textContent = totalIndividuals;
  document.getElementById('full-group-avg').textContent = fmtMoney(avgPerPerson);

  const tbody = document.getElementById('partial-expense-tbody');
  const empty = document.getElementById('partial-expense-empty');
  tbody.innerHTML = '';
  empty.hidden = partialExpenses.length > 0;
  partialExpenses.forEach(x => {
    const participants = participantsOf(x);
    const share = participants.length > 0 ? (Number(x.amount) || 0) / participants.length : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Khoản chi">${escapeHtml(x.description)}</td>
      <td data-label="Số tiền">${fmtMoney(x.amount)}</td>
      <td data-label="Người trả">${escapeHtml(x.payer)}</td>
      <td data-label="Chia cho">${escapeHtml(x.participants)}</td>
      <td data-label="Mỗi người">${fmtMoney(share)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- Balances & Settlement ----------
function renderBalances() {
  const paid = {};
  const paidFullGroup = {};
  const paidPartial = {};
  const owed = {};
  members.forEach(m => { paid[m.name] = 0; paidFullGroup[m.name] = 0; paidPartial[m.name] = 0; owed[m.name] = 0; });

  const fundRatio = fullGroupRatio();

  expenses.forEach(x => {
    const amount = Number(x.amount) || 0;
    const participants = participantsOf(x);
    if (paid[x.payer] === undefined) paid[x.payer] = 0;
    paid[x.payer] += amount;
    if (isFullGroupExpense(x)) {
      paidFullGroup[x.payer] = (paidFullGroup[x.payer] || 0) + amount;
    } else {
      paidPartial[x.payer] = (paidPartial[x.payer] || 0) + amount;
    }
    if (participants.length === 0) return;

    // Chỉ chia theo tỉ lệ số người trong gia đình khi khoản chi được check CHO ĐỦ
    // tất cả thành viên (chia đều cả nhóm). Nếu chỉ check một phần thành viên, chia đều
    // cho riêng những người đó (xem thêm bảng "Khoản chia riêng").
    if (isFullGroupExpense(x)) {
      // Quỹ nhóm trừ thẳng vào tổng chi chung: nhân khoản chi với fundRatio trước khi chia
      // theo tỉ lệ gia đình, để tổng owed luôn khớp đúng (tổng chi chung − quỹ).
      const effectiveAmount = amount * fundRatio;
      const totalPeople = participants.reduce((sum, p) => sum + familySizeOf(p), 0);
      participants.forEach(p => {
        if (owed[p] === undefined) owed[p] = 0;
        owed[p] += totalPeople > 0 ? effectiveAmount * familySizeOf(p) / totalPeople : effectiveAmount / participants.length;
      });
    } else {
      const share = amount / participants.length;
      participants.forEach(p => {
        if (owed[p] === undefined) owed[p] = 0;
        owed[p] += share;
      });
    }
  });

  const names = Array.from(new Set([...members.map(m => m.name), ...Object.keys(paid), ...Object.keys(owed)]));
  const balances = names.map(name => ({
    name,
    paid: paid[name] || 0,
    paidFullGroup: paidFullGroup[name] || 0,
    paidPartial: paidPartial[name] || 0,
    owed: owed[name] || 0,
    balance: (paid[name] || 0) - (owed[name] || 0),
  }));

  renderPaidPerMember(balances);
  renderBalanceBreakdown(balances);
  renderSettlements(balances);
}

// Nợ "thô" giữa từng cặp người, tính trực tiếp từ mỗi khoản chi: ai nợ ai và bao nhiêu,
// CHƯA gộp/tối giản qua nhiều người (khác với computeSettlements ở dưới).
// Cố ý KHÔNG trừ quỹ ở đây (dùng số amount gốc): quỹ là một khoản giảm trừ chung, không
// gắn với một người trả cụ thể nào, nên không thể quy thẳng vào từng cặp người — pairwiseFormula()
// sẽ co giãn tỉ lệ các khoản hiển thị bên dưới để vẫn cộng đúng ra tổng đã trừ quỹ.
function computePairwiseDebts() {
  const owedTo = {}; // owedTo[người nợ][người được trả] = số tiền
  expenses.forEach(x => {
    const amount = Number(x.amount) || 0;
    const participants = participantsOf(x);
    if (participants.length === 0) return;
    const isFull = isFullGroupExpense(x);
    const totalPeople = isFull ? participants.reduce((sum, p) => sum + familySizeOf(p), 0) : 0;
    participants.forEach(p => {
      if (p === x.payer) return;
      const share = isFull
        ? (totalPeople > 0 ? amount * familySizeOf(p) / totalPeople : amount / participants.length)
        : amount / participants.length;
      if (!owedTo[p]) owedTo[p] = {};
      owedTo[p][x.payer] = (owedTo[p][x.payer] || 0) + share;
    });
  });

  const pairs = [];
  const seenPairs = new Set();
  Object.keys(owedTo).forEach(a => {
    Object.keys(owedTo[a]).forEach(b => {
      const key = [a, b].sort().join('|');
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      const aOwesB = owedTo[a][b] || 0;
      const bOwesA = (owedTo[b] && owedTo[b][a]) || 0;
      const net = aOwesB - bOwesA;
      if (net > 0.5) pairs.push({ from: a, to: b, amount: net, rawFrom: aOwesB, rawTo: bOwesA });
      else if (net < -0.5) pairs.push({ from: b, to: a, amount: -net, rawFrom: bOwesA, rawTo: aOwesB });
    });
  });
  return pairs.sort((x, y) => y.amount - x.amount);
}

// Lưới nổi bật: mỗi người đã trả bao nhiêu (sắp xếp từ trả nhiều nhất đến ít nhất).
function renderPaidPerMember(balances) {
  const container = document.getElementById('paid-per-member');
  container.innerHTML = '';
  const sorted = [...balances].sort((a, b) => b.paid - a.paid);
  sorted.forEach(b => {
    const card = document.createElement('div');
    card.className = 'paid-card' + (b.paid > 0 ? ' paid-card-active' : '');
    card.innerHTML = `
      <span class="paid-name">${escapeHtml(b.name)}</span>
      <span class="paid-amount">${fmtMoney(b.paid)}</span>
      <span class="paid-split">
        <span class="paid-split-item">chung ${fmtMoney(b.paidFullGroup)}</span>
        <span class="paid-split-item">riêng ${fmtMoney(b.paidPartial)}</span>
      </span>
    `;
    container.appendChild(card);
  });
}

// Thuật toán tham lam: người nợ nhiều nhất trả cho người được nợ nhiều nhất, lặp lại.
// Mỗi giao dịch = min(số dư ròng còn lại của người trả, số dư ròng còn lại của người nhận);
// fromRemaining/toRemaining được giữ lại (số dư TRƯỚC giao dịch này) để hiển thị công thức
// kiểm chứng ở renderSettlements — không phải là số dư ròng ban đầu nếu người đó đã
// xuất hiện ở dòng trước.
function computeSettlements(balances) {
  const debtors = balances.filter(b => b.balance < -0.5).map(b => ({ name: b.name, amount: -b.balance })).sort((a, b) => b.amount - a.amount);
  const creditors = balances.filter(b => b.balance > 0.5).map(b => ({ name: b.name, amount: b.balance })).sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const fromRemaining = debtors[i].amount;
    const toRemaining = creditors[j].amount;
    const pay = Math.min(fromRemaining, toRemaining);
    settlements.push({ from: debtors[i].name, to: creditors[j].name, amount: pay, fromRemaining, toRemaining });
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount < 0.5) i++;
    if (creditors[j].amount < 0.5) j++;
  }
  return settlements;
}

// Mỗi người: dòng chính là công thức chia đều cả nhóm (mức chia x số người trong gia đình - đã trả);
// nếu người đó còn có khoản chia riêng, thêm 1 dòng phụ bên dưới cộng/trừ khoản đó vào ra tổng cuối.
// Số tiền đã trả mỗi người đã hiển thị riêng ở lưới "paid-per-member" phía trên.
function renderBalanceBreakdown(balances) {
  const container = document.getElementById('balance-breakdown');
  const { totalFullGroupAmount, avgPerPerson, fullGroupOwedByName } = fullGroupStats();
  const pairwiseDebts = computePairwiseDebts();
  const html = [];

  // netToPay = owed - paid: dương = còn phải trả (nợ), âm = đã trả dư (được nhận lại).
  const resultOf = (netToPay) => ({
    cls: netToPay > 0.5 ? 'balance-negative' : (netToPay < -0.5 ? 'balance-positive' : 'balance-even'),
    label: netToPay > 0.5 ? 'còn phải trả' : (netToPay < -0.5 ? 'được nhận lại' : 'đã huề'),
  });

  // Khi số dư của một người là tổng của nhiều khoản nợ với nhiều người khác nhau,
  // ghi rõ phép cộng từng khoản ra tổng (VD: 1.000 (An) + 3.000 (Bình) = 4.000)
  // để biết số tiền đó đến từ đâu, không chỉ là một con số duy nhất.
  const pairwiseFormula = (name, netToPay) => {
    const pairs = netToPay > 0.5 ? pairwiseDebts.filter(p => p.from === name)
      : netToPay < -0.5 ? pairwiseDebts.filter(p => p.to === name)
      : [];
    if (pairs.length < 2) return '';
    // pairwiseDebts tính trên số tiền GỐC (chưa trừ quỹ) vì quỹ không gắn với người trả cụ
    // thể nào. Co giãn đều các khoản theo cùng 1 tỉ lệ để tổng luôn khớp đúng netToPay
    // (đã trừ quỹ) — vẫn giữ đúng tỉ trọng nợ giữa từng người, chỉ khác về độ lớn.
    const rawTotal = pairs.reduce((sum, p) => sum + p.amount, 0);
    const scale = rawTotal > 0 ? Math.abs(netToPay) / rawTotal : 1;
    const otherKey = netToPay > 0.5 ? 'to' : 'from';
    const terms = pairs.map(p => `${fmtMoney(p.amount * scale)} (${escapeHtml(p[otherKey])})`).join(' + ');
    return `
      <div class="balance-row balance-row-pairwise">
        <span class="balance-row-name"></span>
        <span class="balance-row-formula"><span class="balance-row-source">${terms}</span> = ${fmtMoney(Math.abs(netToPay))}</span>
      </div>
    `;
  };

  balances.forEach(b => {
    const familySize = familySizeOf(b.name);
    const fullGroupOwed = fullGroupOwedByName[b.name] ?? (avgPerPerson * familySize);
    const partialOwed = b.owed - fullGroupOwed;
    const netToPay = b.owed - b.paid;

    if (totalFullGroupAmount > 0) {
      // Dòng chính: chỉ tính theo phần chia đều cả nhóm, CHƯA gồm khoản chia riêng.
      const baseNetToPay = fullGroupOwed - b.paid;
      const base = resultOf(baseNetToPay);
      html.push(`
        <div class="balance-row">
          <span class="balance-row-name">${escapeHtml(b.name)}</span>
          <span class="balance-row-formula">${fmtMoney(avgPerPerson)} × ${familySize} người − đã trả ${fmtMoney(b.paid)}</span>
          <span class="balance-row-result ${base.cls}">${base.label} ${fmtMoney(Math.abs(baseNetToPay))}</span>
        </div>
      `);

      // Dòng phụ: khoản chia riêng cộng/trừ thêm vào số dư ở trên, ra tổng cuối cùng.
      // Mô tả rõ bằng chữ (thay vì chỉ dấu +/-) và liệt kê tên khoản chi riêng liên quan,
      // để biết khoản đó là của khoản chi nào, không chỉ là một số tiền trừu tượng.
      if (Math.abs(partialOwed) > 0.5) {
        const total = resultOf(netToPay);
        const partialLabel = partialOwed > 0 ? 'chịu thêm khoản chia riêng' : 'được giảm nhờ khoản chia riêng';
        const owedWord = partialOwed > 0 ? 'nợ' : 'được giảm';
        const breakdown = partialSharesOf(b.name)
          .map(s => s.payer === SELF_PAID_KEY
            ? `tự chi ${fmtMoney(s.share)}`
            : `${owedWord} ${escapeHtml(s.payer)} ${fmtMoney(s.share)}`)
          .join(' + ');
        html.push(`
          <div class="balance-row balance-row-adjust">
            <span class="balance-row-name"></span>
            <span class="balance-row-formula">
              ${partialLabel} ${fmtMoney(Math.abs(partialOwed))}
              ${breakdown ? `<span class="balance-row-source">(${breakdown})</span>` : ''}
            </span>
            <span class="balance-row-result ${total.cls}">tổng ${total.label} ${fmtMoney(Math.abs(netToPay))}</span>
          </div>
        `);
      }
      html.push(pairwiseFormula(b.name, netToPay));
    } else {
      // Không có khoản nào chia đều cả nhóm — tất cả đều là chia riêng.
      const total = resultOf(netToPay);
      html.push(`
        <div class="balance-row">
          <span class="balance-row-name">${escapeHtml(b.name)}</span>
          <span class="balance-row-formula">chia riêng ${fmtMoney(b.owed)} − đã trả ${fmtMoney(b.paid)}</span>
          <span class="balance-row-result ${total.cls}">${total.label} ${fmtMoney(Math.abs(netToPay))}</span>
        </div>
      `);
      html.push(pairwiseFormula(b.name, netToPay));
    }
  });

  container.innerHTML = html.join('');
}

function renderSettlements(balances) {
  const settlements = computeSettlements(balances);
  const list = document.getElementById('settlement-list');
  const empty = document.getElementById('settlement-empty');
  list.innerHTML = '';
  empty.hidden = settlements.length > 0;
  settlements.forEach(s => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="settle-main">
        <span class="settle-name settle-from">${escapeHtml(s.from)}</span>
        <span class="settle-arrow">➜</span>
        <span class="settle-amount">${fmtMoney(s.amount)}</span>
        <span class="settle-arrow">➜</span>
        <span class="settle-name settle-to">${escapeHtml(s.to)}</span>
      </div>
      <div class="settle-formula">Trả ${fmtMoney(s.amount)} = số nhỏ hơn giữa phần ${escapeHtml(s.from)} còn nợ (${fmtMoney(s.fromRemaining)}) và phần ${escapeHtml(s.to)} còn được nhận (${fmtMoney(s.toRemaining)})</div>
    `;
    list.appendChild(li);
  });
}

// ---------- Utils ----------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

init();
