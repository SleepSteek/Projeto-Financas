import { supabase, getTransactions, addTransaction, updateTransaction, deleteTransaction, deleteTransactions, getWallets, addWallet, deleteWallet, getRules, saveRule } from './supabase.js?v=1.0.3';
import { initGoogleAuth, connectGmail, fetchTransactionEmails } from './gmail.js';

// State
let allWallets = [];
let walletMap = {};
let learnRules = [];

// Navigation
const navItems = {
    'dashboard': document.getElementById('nav-dashboard'),
    'transactions': document.getElementById('nav-transactions'),
    'wallets': document.getElementById('nav-wallets'),
    'sync': document.getElementById('nav-sync'),
    'settings': document.getElementById('nav-settings')
};
const views = {
    'dashboard': document.getElementById('view-dashboard'),
    'transactions': document.getElementById('view-transactions'),
    'wallets': document.getElementById('view-wallets'),
    'sync': document.getElementById('view-sync'),
    'settings': document.getElementById('view-settings')
};

function showView(viewName) {
    Object.values(views).forEach(v => { if (v) v.style.display = 'none'; });
    Object.values(navItems).forEach(item => { if (item) item.classList.remove('active'); });
    if (views[viewName]) views[viewName].style.display = 'block';
    if (navItems[viewName]) navItems[viewName].classList.add('active');
    if (viewName === 'dashboard') loadTransactions();
    if (viewName === 'transactions') loadFullTransactions();
    if (viewName === 'wallets') loadWallets();
    if (viewName === 'settings') loadSettings();
}

Object.keys(navItems).forEach(key => {
    if (navItems[key]) { navItems[key].onclick = (e) => { e.preventDefault(); showView(key); }; }
});

// Wallets
async function loadWallets() {
    allWallets = await getWallets();
    walletMap = {};
    const grid = document.getElementById('wallets-grid');
    if (grid) grid.innerHTML = '';
    
    const filterWallet = document.getElementById('filter-wallet');
    const walletSelect = document.getElementById('wallet-select');
    if (filterWallet) filterWallet.innerHTML = '<option value="all">Todas as Carteiras</option>';
    if (walletSelect) walletSelect.innerHTML = '';

    allWallets.forEach(w => {
        walletMap[w.id] = w.name;
        if (filterWallet) filterWallet.innerHTML += `<option value="${w.id}">${w.name}</option>`;
        if (walletSelect) walletSelect.innerHTML += `<option value="${w.id}">${w.name}</option>`;
        
        if (grid) {
            const card = document.createElement('div');
            card.className = 'card stat-card';
            card.innerHTML = `<div style="display:flex;justify-content:space-between;"><span class="stat-label">${w.name}</span><button class="btn-del-wallet" data-id="${w.id}" style="background:none;border:none;color:var(--danger);cursor:pointer;"><span class="material-symbols-rounded">delete</span></button></div><span class="stat-value" id="wallet-bal-${w.id}">R$ ---</span>`;
            grid.appendChild(card);
        }
    });
    document.querySelectorAll('.btn-del-wallet').forEach(btn => {
        btn.onclick = async () => { if (confirm('Excluir carteira?')) { await deleteWallet(btn.dataset.id); loadWallets(); } };
    });
    calculateWalletBalances();
}

async function calculateWalletBalances() {
    const txs = await getTransactions();
    const bals = {};
    txs.forEach(tx => { if (tx.wallet_id) bals[tx.wallet_id] = (bals[tx.wallet_id] || 0) + parseFloat(tx.amount); });
    Object.keys(bals).forEach(id => {
        const el = document.getElementById(`wallet-bal-${id}`);
        if (el) el.innerText = `R$ ${bals[id].toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    });
}

// Transactions
async function loadTransactions() {
    const txs = await getTransactions();
    updateDashboardStats(txs);
    renderTransactionTable(txs.slice(0, 5), 'recent-transactions-list');
}

async function loadFullTransactions() {
    let txs = await getTransactions();
    
    const filterWallet = document.getElementById('filter-wallet')?.value;
    const filterType = document.getElementById('filter-type')?.value;

    if (filterWallet && filterWallet !== 'all') {
        txs = txs.filter(tx => String(tx.wallet_id) === String(filterWallet));
    }
    
    if (filterType && filterType !== 'all') {
        txs = txs.filter(tx => {
            const amt = parseFloat(tx.amount);
            if (filterType === 'income') return amt > 0;
            if (filterType === 'expense') return amt <= 0;
            return true;
        });
    }

    renderTransactionTable(txs, 'full-transactions-list', true);
}

// Add event listeners for filters
document.getElementById('filter-wallet')?.addEventListener('change', loadFullTransactions);
document.getElementById('filter-type')?.addEventListener('change', loadFullTransactions);

function renderTransactionTable(txs, elementId, showActions = false) {
    const list = document.getElementById(elementId);
    if (!list) return;
    list.innerHTML = '';
    txs.forEach(tx => {
        const amt = parseFloat(tx.amount);
        const isInc = amt > 0;
        const row = document.createElement('tr');
        const catSelectHtml = `<select class="tx-category-edit" data-id="${tx.id}" style="background:var(--surface);border:1px solid var(--glass-border);color:white;padding:0.25rem;border-radius:0.25rem;width:100%;">
            <option value="Geral" ${tx.category === 'Geral' ? 'selected' : ''}>Geral</option>
            <option value="Reparos" ${tx.category === 'Reparos' ? 'selected' : ''}>Reparos</option>
            <option value="Marido de Aluguel" ${tx.category === 'Marido de Aluguel' ? 'selected' : ''}>Marido de Aluguel</option>
            <option value="Faxina" ${tx.category === 'Faxina' ? 'selected' : ''}>Faxina</option>
            <option value="Alimentação" ${tx.category === 'Alimentação' ? 'selected' : ''}>Alimentação</option>
            <option value="Moradia" ${tx.category === 'Moradia' ? 'selected' : ''}>Moradia</option>
            <option value="Lazer" ${tx.category === 'Lazer' ? 'selected' : ''}>Lazer</option>
            <option value="Transporte" ${tx.category === 'Transporte' ? 'selected' : ''}>Transporte</option>
            <option value="Renda" ${tx.category === 'Renda' ? 'selected' : ''}>Renda</option>
        </select>`;

        row.innerHTML = `${showActions ? `<td><input type="checkbox" class="tx-checkbox" data-id="${tx.id}"></td>` : ''}<td>${new Date(tx.date).toLocaleDateString('pt-BR')}</td><td>${tx.description}</td>${showActions ? `<td>${catSelectHtml}</td>` : `<td>${tx.category || 'Geral'}</td>`}<td><span style="background:var(--surface-light);padding:0.25rem 0.5rem;border-radius:0.5rem;font-size:0.75rem;">${walletMap[tx.wallet_id] || '---'}</span></td><td class="amount ${isInc?'income':'expense'}">${isInc?'+':'-'} R$ ${Math.abs(amt).toFixed(2)}</td>${showActions ? `<td><button class="btn-delete" data-id="${tx.id}" style="color:var(--danger);background:none;border:none;cursor:pointer;"><span class="material-symbols-rounded">delete</span></button></td>` : ''}`;
        list.appendChild(row);
    });
    if (showActions) {
        // Individual delete
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.onclick = async () => { if (confirm('Excluir?')) { await deleteTransaction(btn.dataset.id); loadFullTransactions(); loadTransactions(); } };
        });

        // Checkbox logic
        const checkboxes = document.querySelectorAll('.tx-checkbox');
        const selectAll = document.getElementById('select-all-txs');
        const btnBulkDelete = document.getElementById('btn-delete-selected');

        const updateBulkDeleteVisibility = () => {
            const selected = Array.from(checkboxes).filter(cb => cb.checked);
            btnBulkDelete.style.display = selected.length > 0 ? 'flex' : 'none';
        };

        checkboxes.forEach(cb => {
            cb.onchange = updateBulkDeleteVisibility;
        });

        if (selectAll) {
            selectAll.checked = false;
            selectAll.onchange = () => {
                checkboxes.forEach(cb => cb.checked = selectAll.checked);
                updateBulkDeleteVisibility();
            };
        }

        // Category update logic
        document.querySelectorAll('.tx-category-edit').forEach(select => {
            select.onchange = async (e) => {
                const newCategory = e.target.value;
                const id = e.target.dataset.id;
                await updateTransaction(id, { category: newCategory });
                // Note: we don't reload full transactions to avoid losing filter state / scroll,
                // but we might want to update the dashboard stats if they are visible.
                // Since this view is only transactions, just reloading the dashboard data in background is fine:
                loadTransactions(); 
            };
        });
    }
}

function updateDashboardStats(txs) {
    let bal = 0, inc = 0, exp = 0;
    const catTotals = {};
    const walletTotals = {};
    const walletMonthInc = {};
    const walletMonthExp = {};
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    txs.forEach(tx => {
        const amt = parseFloat(tx.amount);
        bal += amt;
        
        // Saldo acumulado total por carteira
        if (tx.wallet_id) {
            walletTotals[tx.wallet_id] = (walletTotals[tx.wallet_id] || 0) + amt;
        }

        const txDate = new Date(tx.date + 'T12:00:00');
        if (txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear) {
            if (amt > 0) {
                inc += amt;
                if (tx.wallet_id) walletMonthInc[tx.wallet_id] = (walletMonthInc[tx.wallet_id] || 0) + amt;
            } else {
                exp += Math.abs(amt);
                catTotals[tx.category] = (catTotals[tx.category] || 0) + Math.abs(amt);
                if (tx.wallet_id) walletMonthExp[tx.wallet_id] = (walletMonthExp[tx.wallet_id] || 0) + Math.abs(amt);
            }
        }
    });

    const s1 = document.querySelector('.stat-card:nth-child(1) .stat-value'); if (s1) s1.innerText = `R$ ${bal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const s2 = document.querySelector('.stat-card:nth-child(2) .stat-value'); if (s2) s2.innerText = `R$ ${inc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const s3 = document.querySelector('.stat-card:nth-child(3) .stat-value'); if (s3) s3.innerText = `R$ ${exp.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

    // Renderizar mini balões das carteiras no Dashboard
    const walletGrid = document.getElementById('dashboard-wallets-grid');
    if (walletGrid) {
        walletGrid.innerHTML = '';
        allWallets.forEach(w => {
            const wBal = walletTotals[w.id] || 0;
            const wInc = walletMonthInc[w.id] || 0;
            const wExp = walletMonthExp[w.id] || 0;

            const card = document.createElement('div');
            card.className = 'card animate-fade-in';
            card.style.padding = '0.75rem 1rem';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.borderLeft = `4px solid ${wBal >= 0 ? 'var(--success)' : 'var(--danger)'}`;
            card.innerHTML = `
                <span style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">${w.name}</span>
                <span style="font-size: 1rem; font-weight: 700; color: white; margin-top: 2px;">R$ ${wBal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                <div style="display: flex; gap: 0.75rem; margin-top: 6px; font-size: 0.65rem; font-weight: 500;">
                    <span style="color: var(--success); display: flex; align-items: center; gap: 2px;">
                        <span class="material-symbols-rounded" style="font-size: 0.8rem;">arrow_upward</span>
                        R$ ${wInc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                    <span style="color: var(--danger); display: flex; align-items: center; gap: 2px;">
                        <span class="material-symbols-rounded" style="font-size: 0.8rem;">arrow_downward</span>
                        R$ ${wExp.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                </div>
            `;
            walletGrid.appendChild(card);
        });
    }

    updateCharts(catTotals, txs);
}

function updateCharts(catTotals, txs) {
    const ctxMain = document.getElementById('mainChart')?.getContext('2d');
    const ctxCat = document.getElementById('categoryChart')?.getContext('2d');
    if (!ctxMain || !ctxCat) return;

    // Limpar gráficos existentes para evitar bugs de hover
    if (window.chartLine) window.chartLine.destroy();
    if (window.chartPie) window.chartPie.destroy();

    // --- Lógica do Gráfico de Fluxo de Caixa (Mensal acumulado por Carteira) ---
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    
    // Ordenar transações por data (ascendente)
    const sortedTxs = [...txs].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const labels = [];
    for (let day = 1; day <= today.getDate(); day++) {
        labels.push(`${day}/${currentMonth + 1}`);
    }

    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#f97316'];
    const datasets = allWallets.map((wallet, index) => {
        let runningBalance = 0;
        const dailyBalances = [];
        
        // Saldo inicial da carteira antes do mês atual
        const preMonthTxs = sortedTxs.filter(tx => tx.wallet_id === wallet.id && new Date(tx.date) < firstDayOfMonth);
        runningBalance = preMonthTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
        
        for (let day = 1; day <= today.getDate(); day++) {
            const dayTxs = sortedTxs.filter(tx => {
                const txDate = new Date(tx.date + 'T12:00:00');
                return tx.wallet_id === wallet.id && 
                       txDate.getFullYear() === currentYear && 
                       txDate.getMonth() === currentMonth && 
                       txDate.getDate() === day;
            });
            const daySum = dayTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
            runningBalance += daySum;
            dailyBalances.push(runningBalance);
        }

        return {
            label: wallet.name,
            data: dailyBalances,
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '11', // Transparência bem leve
            fill: false,
            tension: 0.4,
            pointRadius: today.getDate() > 20 ? 0 : 2,
            pointBackgroundColor: colors[index % colors.length],
            borderWidth: 2.5
        };
    });

    const totalExp = Object.values(catTotals).reduce((a, b) => a + b, 0);

    window.chartPie = new Chart(ctxCat, { 
        type: 'doughnut', 
        data: { 
            labels: Object.keys(catTotals), 
            datasets: [{ 
                data: Object.values(catTotals), 
                backgroundColor: colors, 
                borderWidth: 0,
                hoverOffset: 10
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', usePointStyle: true, padding: 20 } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const percentage = totalExp > 0 ? ((value / totalExp) * 100).toFixed(1) : 0;
                            return ` ${context.label}: ${percentage}% (R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`;
                        }
                    }
                }
            }
        }
    });

    window.chartLine = new Chart(ctxMain, { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: datasets
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
                y: { grid: { color: 'rgba(148, 163, 184, 0.1)' }, ticks: { color: '#94a3b8', callback: (v) => `R$ ${v.toLocaleString('pt-BR')}` } }
            },
            plugins: { 
                legend: { 
                    display: true, 
                    position: 'top', 
                    align: 'end',
                    labels: { color: '#94a3b8', boxWidth: 10, usePointStyle: true, font: { size: 11 } }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: (context) => ` ${context.dataset.label}: R$ ${context.raw.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                    }
                }
            }
        }
    });
}

// Triage Logic (The "Pilot" Brain)
async function runTriage() {
    const sender = document.getElementById('sync-sender').value;
    const period = document.getElementById('sync-period').value;
    const resultsList = document.getElementById('sync-results-list');
    resultsList.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;">Analisando e-mails com Piloto Automático...</td></tr>';

    try {
        const emails = await fetchTransactionEmails({ sender, period });
        const existingTxs = await getTransactions();
        learnRules = await getRules();
        resultsList.innerHTML = '';

        // Filtrar e-mails que já foram adicionados (verificando o campo 'source')
        const uniqueEmails = emails.filter(email => {
            const idToMatch = `gmail:${email.id}`;
            return !existingTxs.some(tx => tx.source === idToMatch);
        });

        if (uniqueEmails.length === 0) {
            resultsList.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;">Nenhum e-mail novo (ou todos já foram processados).</td></tr>';
            return;
        }

        const bankWallet = allWallets.find(w => w.name.includes('Bancária')) || allWallets[0];
        let autoAddedCount = 0;

        for (const email of uniqueEmails) {
            const rule = learnRules.find(r => r.subject === email.subject);

            // 1. Regra de IGNORAR
            if (rule?.amount_type === 'ignore') {
                console.log('Ignorando e-mail por regra:', email.subject);
                continue;
            }

            // 2. Regra de ADICIONAR AUTOMÁTICO
            if (rule && rule.amount_type !== 'ignore') {
                // Só adiciona automático se conseguiu extrair um valor válido (> 0)
                if (email.amount > 0) {
                    const tx = {
                        date: email.date,
                        description: email.entityName || (email.senderName ? `${email.senderName}: ${email.subject}` : email.subject),
                        amount: rule.amount_type === 'income' ? Math.abs(email.amount) : -Math.abs(email.amount),
                        category: rule.category,
                        wallet_id: bankWallet?.id,
                        source: `gmail:${email.id}`
                    };
                    await addTransaction(tx);
                    autoAddedCount++;
                    continue;
                }
            }

            // 3. E-mail Desconhecido -> Vai para Triagem
            const row = document.createElement('tr');
            const displayDesc = email.entityName || (email.senderName ? `${email.senderName}: ${email.subject}` : email.subject);
            
            row.innerHTML = `
                <td>${new Date(email.date).toLocaleDateString('pt-BR')}</td>
                <td title="${email.snippet}">${displayDesc}</td>
                <td><input type="number" step="0.01" value="${email.amount}" class="triage-amount" style="width:80px;background:var(--surface);border:1px solid var(--glass-border);color:white;padding:0.25rem;"></td>
                <td>
                    <select class="triage-type" style="background:var(--surface);border:1px solid var(--glass-border);color:white;padding:0.25rem;">
                        <option value="income" ${email.amount > 0 ? 'selected' : ''}>Entrada</option>
                        <option value="expense" ${email.amount <= 0 ? 'selected' : ''}>Saída</option>
                    </select>
                </td>
                <td>
                    <select class="triage-category" style="background:var(--surface);border:1px solid var(--glass-border);color:white;padding:0.25rem;">
                        <option value="Geral">Geral</option>
                        <option value="Reparos">Reparos</option>
                        <option value="Marido de Aluguel">Marido de Aluguel</option>
                        <option value="Faxina">Faxina</option>
                        <option value="Alimentação">Alimentação</option>
                        <option value="Transporte">Transporte</option>
                        <option value="Lazer">Lazer</option>
                        <option value="Renda">Renda</option>
                    </select>
                </td>
                <td>
                    <div style="display:flex; gap:0.5rem;">
                        <button class="btn btn-save-triage" 
                            data-id="${email.id}"
                            data-subject="${email.subject}" 
                            data-date="${email.date}" 
                            data-sender="${email.senderName || ''}" 
                            data-entity="${email.entityName || ''}"
                            style="padding:0.25rem 0.5rem;font-size:0.75rem;">Salvar</button>
                        <button class="btn-ignore-triage" data-subject="${email.subject}" style="background:none;border:1px solid var(--danger);color:var(--danger);padding:0.25rem;border-radius:0.5rem;cursor:pointer;">Ignorar</button>
                    </div>
                </td>
            `;
            resultsList.appendChild(row);
        }

        if (autoAddedCount > 0) {
            alert(`${autoAddedCount} transações conhecidas foram adicionadas automaticamente!`);
            loadTransactions();
        }
        
        if (resultsList.innerHTML === '') {
            resultsList.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;">Tudo limpo! Todas as transações foram processadas automaticamente.</td></tr>';
        }

        // Eventos de Salvar na Triagem
        document.querySelectorAll('.btn-save-triage').forEach(btn => {
            btn.onclick = async (e) => {
                const row = e.target.closest('tr');
                const amt = parseFloat(row.querySelector('.triage-amount').value);
                const type = row.querySelector('.triage-type').value;
                const cat = row.querySelector('.triage-category').value;
                const subj = btn.dataset.subject;
                const sender = btn.dataset.sender;
                const entity = btn.dataset.entity;

                const tx = {
                    date: btn.dataset.date,
                    description: entity || (sender ? `${sender}: ${subj}` : subj),
                    amount: type === 'income' ? Math.abs(amt) : -Math.abs(amt),
                    category: cat,
                    wallet_id: bankWallet?.id,
                    source: `gmail:${btn.dataset.id}`
                };

                if (await addTransaction(tx)) {
                    await saveRule({ subject: subj, amount_type: type, category: cat, wallet_id: bankWallet?.id });
                    row.remove();
                    loadTransactions();
                }
            };
        });

        // Eventos de Ignorar na Triagem
        document.querySelectorAll('.btn-ignore-triage').forEach(btn => {
            btn.onclick = async () => {
                if (confirm('Deseja ignorar este tipo de e-mail para sempre?')) {
                    await saveRule({ subject: btn.dataset.subject, amount_type: 'ignore' });
                    btn.closest('tr').remove();
                }
            };
        });

    } catch (e) { console.error(e); }
}

// Init
const btnSyncNow = document.getElementById('btn-sync-now');
const btnConnectGmail = document.getElementById('btn-connect-gmail');
const btnDeleteSelected = document.getElementById('btn-delete-selected');

btnConnectGmail.onclick = () => connectGmail();
btnSyncNow.onclick = () => runTriage();

if (btnDeleteSelected) {
    btnDeleteSelected.onclick = async () => {
        const selected = Array.from(document.querySelectorAll('.tx-checkbox'))
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.id);

        if (selected.length > 0 && confirm(`Excluir ${selected.length} transações?`)) {
            if (await deleteTransactions(selected)) {
                loadFullTransactions();
                loadTransactions();
                btnDeleteSelected.style.display = 'none';
            }
        }
    };
}

document.addEventListener('gmail-connected', () => {
    btnConnectGmail.style.display = 'none';
    btnSyncNow.style.display = 'block';
    // Só roda a triagem automaticamente se estivermos na view de sync
    if (views.sync.style.display === 'block') {
        runTriage();
    }
});

document.addEventListener('gmail-disconnected', () => {
    btnConnectGmail.style.display = 'block';
    btnSyncNow.style.display = 'none';
});

document.addEventListener('DOMContentLoaded', async () => {
    initGoogleAuth();
    loadSettings();
    await loadWallets();
    loadTransactions();
});

// Settings Logic
function loadSettings() {
    const appTitle = localStorage.getItem('app-title') || 'FinTrack';
    const userName = localStorage.getItem('user-name') || 'Vini';
    const userEmail = localStorage.getItem('user-email') || '';

    const titleEl = document.getElementById('app-title-text');
    const nameEl = document.getElementById('user-display-name');
    
    if (titleEl) titleEl.innerText = appTitle;
    if (nameEl) nameEl.innerText = userName;
    
    // Fill form fields if they exist
    const fieldTitle = document.getElementById('settings-app-title');
    const fieldName = document.getElementById('settings-user-name');
    const fieldEmail = document.getElementById('settings-user-email');
    
    if (fieldTitle) fieldTitle.value = appTitle;
    if (fieldName) fieldName.value = userName;
    if (fieldEmail) fieldEmail.value = userEmail;
}

const formSettings = document.getElementById('form-settings');
if (formSettings) {
    formSettings.onsubmit = (e) => {
        e.preventDefault();
        const newTitle = document.getElementById('settings-app-title').value;
        const newName = document.getElementById('settings-user-name').value;
        const newEmail = document.getElementById('settings-user-email').value;
        const newPass = document.getElementById('settings-user-password').value;

        if (newTitle) localStorage.setItem('app-title', newTitle);
        if (newName) localStorage.setItem('user-name', newName);
        if (newEmail) localStorage.setItem('user-email', newEmail);
        if (newPass) localStorage.setItem('user-password', newPass);

        loadSettings();
        alert('Configurações salvas com sucesso!');
    };
}

// Modal Logic
document.getElementById('btn-new-transaction').onclick = () => document.getElementById('modal-transaction').style.display='flex';
document.getElementById('btn-cancel').onclick = () => document.getElementById('modal-transaction').style.display='none';
document.getElementById('form-transaction').onsubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(document.getElementById('amount').value);
    const cat = document.getElementById('category').value;
    const type = document.getElementById('type-select').value;
    const tx = { 
        date: new Date().toISOString().split('T')[0], 
        description: document.getElementById('desc').value, 
        amount: type === 'income' ? Math.abs(amt) : -Math.abs(amt), 
        category: cat, 
        wallet_id: document.getElementById('wallet-select').value, 
        source: 'manual' 
    };
    if (await addTransaction(tx)) { document.getElementById('modal-transaction').style.display='none'; loadTransactions(); }
};
