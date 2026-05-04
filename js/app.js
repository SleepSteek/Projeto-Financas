import { supabase, getTransactions, addTransaction, updateTransaction, deleteTransaction, deleteTransactions, updateTransactionsByDescription, getWallets, addWallet, deleteWallet, getRules, saveRule, getRecurringExpenses, addRecurringExpense, updateRecurringExpense, deleteRecurringExpense, signUp, signIn, signOut, getSession } from './supabase.js?v=1.0.6';
import { initGoogleAuth, connectGmail, fetchTransactionEmails, isGmailTokenValid } from './gmail.js';

// State
let allWallets = [];
let walletMap = {};
let learnRules = [];

function getSelectedMonthYear() {
    const filter = document.getElementById('global-month-filter');
    if (filter && filter.value) {
        const [y, m] = filter.value.split('-');
        return { month: parseInt(m) - 1, year: parseInt(y) };
    }
    const d = new Date();
    return { month: d.getMonth(), year: d.getFullYear() };
}

// =============================================
// Categories Management System
// =============================================
const DEFAULT_CATEGORIES = [
    'Geral', 'Reparos', 'Marido de Aluguel', 'Faxina',
    'Alimentação', 'Moradia', 'Lazer', 'Transporte', 'Renda'
];

function getCustomCategories() {
    try {
        return JSON.parse(localStorage.getItem('custom-categories') || '[]');
    } catch { return []; }
}

function getAllCategories() {
    const custom = getCustomCategories();
    // Merge defaults + custom, deduplicated, and sort alphabetically
    const all = [...DEFAULT_CATEGORIES];
    custom.forEach(c => { if (!all.includes(c)) all.push(c); });
    return all.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function addCustomCategory(name) {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const custom = getCustomCategories();
    if (DEFAULT_CATEGORIES.includes(trimmed) || custom.includes(trimmed)) return false;
    custom.push(trimmed);
    localStorage.setItem('custom-categories', JSON.stringify(custom));
    return true;
}

function removeCustomCategory(name) {
    let custom = getCustomCategories();
    custom = custom.filter(c => c !== name);
    localStorage.setItem('custom-categories', JSON.stringify(custom));
}

function getCategoryOptionsHtml(selected = 'Geral') {
    return getAllCategories().map(cat =>
        `<option value="${cat}" ${cat === selected ? 'selected' : ''}>${cat}</option>`
    ).join('');
}

// Name Normalization Rules (old_description -> new_description)
function getNameRules() {
    try {
        return JSON.parse(localStorage.getItem('name-rules') || '{}');
    } catch { return {}; }
}

function saveNameRule(oldName, newName) {
    const rules = getNameRules();
    if (oldName === newName) {
        delete rules[oldName];
    } else {
        rules[oldName] = newName;
    }
    localStorage.setItem('name-rules', JSON.stringify(rules));
}

function applyNameRules(description) {
    const rules = getNameRules();
    return rules[description] || description;
}

// Navigation
const navItems = {
    'dashboard': document.getElementById('nav-dashboard'),
    'transactions': document.getElementById('nav-transactions'),
    'wallets': document.getElementById('nav-wallets'),
    'recurring': document.getElementById('nav-recurring'),
    'sync': document.getElementById('nav-sync'),
    'settings': document.getElementById('nav-settings')
};
const views = {
    'dashboard': document.getElementById('view-dashboard'),
    'transactions': document.getElementById('view-transactions'),
    'wallets': document.getElementById('view-wallets'),
    'recurring': document.getElementById('view-recurring'),
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
    if (viewName === 'recurring') loadRecurringExpenses();
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
    let lastDate = null;
    txs.forEach(tx => {
        const amt = parseFloat(tx.amount);
        const isInc = amt > 0;
        const row = document.createElement('tr');
        const catSelectHtml = `<select class="tx-category-edit" data-id="${tx.id}" style="background:var(--surface);border:1px solid var(--glass-border);color:white;padding:0.25rem;border-radius:0.25rem;width:100%;">
            ${getCategoryOptionsHtml(tx.category || 'Geral')}
        </select>`;

        const descriptionHtml = showActions
            ? `<td class="td-description-editable" data-id="${tx.id}" data-original="${tx.description}">
                <div class="desc-display" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;" title="Clique para editar">
                    <span class="desc-text">${tx.description}</span>
                    <span class="material-symbols-rounded desc-edit-icon" style="font-size:0.9rem;color:var(--text-muted);opacity:0;transition:opacity 0.2s;">edit</span>
                </div>
                <input type="text" class="desc-input" value="${tx.description}" style="display:none;width:100%;padding:0.25rem 0.5rem;background:var(--surface);border:1px solid var(--primary);color:white;border-radius:0.25rem;outline:none;font-size:0.875rem;" />
               </td>`
            : `<td>${tx.description}</td>`;

        const dateParts = tx.date.split('-');
        const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : new Date(tx.date).toLocaleDateString('pt-BR');

        if (formattedDate !== lastDate) {
            const separatorRow = document.createElement('tr');
            const colSpan = showActions ? 7 : 4;
            separatorRow.innerHTML = `<td colspan="${colSpan}" style="padding: 1rem 0.5rem 0.25rem; font-size: 0.75rem; font-weight: 600; color: var(--primary); border-bottom: 1px solid var(--glass-border); text-transform: uppercase; letter-spacing: 0.05em; background: transparent;">${formattedDate}</td>`;
            list.appendChild(separatorRow);
            lastDate = formattedDate;
        }

        row.innerHTML = `${showActions ? `<td><input type="checkbox" class="tx-checkbox" data-id="${tx.id}"></td>` : ''}<td>${formattedDate}</td>${descriptionHtml}${showActions ? `<td>${catSelectHtml}</td>` : `<td>${tx.category || 'Geral'}</td>`}<td><span style="background:var(--surface-light);padding:0.25rem 0.5rem;border-radius:0.5rem;font-size:0.75rem;">${walletMap[tx.wallet_id] || '---'}</span></td><td class="amount ${isInc?'income':'expense'}">${isInc?'+':'-'} R$ ${Math.abs(amt).toFixed(2)}</td>${showActions ? `<td><button class="btn-delete" data-id="${tx.id}" style="color:var(--danger);background:none;border:none;cursor:pointer;"><span class="material-symbols-rounded">delete</span></button></td>` : ''}`;
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
                loadTransactions(); 
            };
        });

        // =============================================
        // Inline Description Editing + Normalization
        // =============================================
        document.querySelectorAll('.td-description-editable').forEach(td => {
            const display = td.querySelector('.desc-display');
            const input = td.querySelector('.desc-input');
            const textSpan = td.querySelector('.desc-text');
            const txId = td.dataset.id;
            const originalDesc = td.dataset.original;

            // Show edit icon on hover
            td.addEventListener('mouseenter', () => {
                const icon = td.querySelector('.desc-edit-icon');
                if (icon) icon.style.opacity = '1';
            });
            td.addEventListener('mouseleave', () => {
                const icon = td.querySelector('.desc-edit-icon');
                if (icon) icon.style.opacity = '0';
            });

            // Click to enter edit mode
            display.addEventListener('click', () => {
                display.style.display = 'none';
                input.style.display = 'block';
                input.focus();
                input.select();
            });

            // Save on Enter, cancel on Escape
            input.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    await commitDescriptionEdit(txId, originalDesc, input.value.trim(), textSpan, display, input);
                } else if (e.key === 'Escape') {
                    input.value = originalDesc;
                    input.style.display = 'none';
                    display.style.display = 'flex';
                }
            });

            // Save on blur
            input.addEventListener('blur', async () => {
                // Small delay to prevent conflicts with keydown events
                setTimeout(async () => {
                    if (input.style.display !== 'none') {
                        await commitDescriptionEdit(txId, originalDesc, input.value.trim(), textSpan, display, input);
                    }
                }, 100);
            });
        });
    }
}

async function commitDescriptionEdit(txId, originalDesc, newDesc, textSpan, display, input) {
    if (!newDesc || newDesc === originalDesc) {
        // No change, just close edit mode
        input.style.display = 'none';
        display.style.display = 'flex';
        return;
    }

    // Update the current transaction
    await updateTransaction(txId, { description: newDesc });
    textSpan.textContent = newDesc;
    input.style.display = 'none';
    display.style.display = 'flex';

    // Ask if user wants to normalize all matching transactions
    const allTxs = await getTransactions();
    const matchingCount = allTxs.filter(t => t.description === originalDesc && t.id !== parseInt(txId)).length;

    if (matchingCount > 0) {
        const normalize = confirm(
            `Existem mais ${matchingCount} transação(ões) com o nome "${originalDesc}".\n\n` +
            `Deseja renomear todas para "${newDesc}"?`
        );
        if (normalize) {
            await updateTransactionsByDescription(originalDesc, { description: newDesc });
        }
    }

    // Save normalization rule for future imports
    saveNameRule(originalDesc, newDesc);

    // Reload to reflect changes
    loadFullTransactions();
    loadTransactions();
}

function updateDashboardStats(txs) {
    let bal = 0, inc = 0, exp = 0;
    const catTotals = {};
    const incTotals = {};
    const walletTotals = {};
    const walletMonthInc = {};
    const walletMonthExp = {};
    const today = new Date();
    const { month: currentMonth, year: currentYear } = getSelectedMonthYear();

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
                incTotals[tx.category || 'Geral'] = (incTotals[tx.category || 'Geral'] || 0) + amt;
                if (tx.wallet_id) walletMonthInc[tx.wallet_id] = (walletMonthInc[tx.wallet_id] || 0) + amt;
            } else {
                exp += Math.abs(amt);
                catTotals[tx.category || 'Geral'] = (catTotals[tx.category || 'Geral'] || 0) + Math.abs(amt);
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

    updateCharts(catTotals, incTotals, txs);
}

function updateCharts(catTotals, incTotals, txs) {
    const ctxMain = document.getElementById('mainChart')?.getContext('2d');
    const ctxCat = document.getElementById('categoryChart')?.getContext('2d');
    const ctxInc = document.getElementById('incomeChart')?.getContext('2d');
    if (!ctxMain || !ctxCat) return;

    // Limpar gráficos existentes para evitar bugs de hover
    if (window.chartLine) window.chartLine.destroy();
    if (window.chartPie) window.chartPie.destroy();
    if (window.chartIncome) window.chartIncome.destroy();

    // --- Lógica do Gráfico de Fluxo de Caixa (Mensal acumulado por Carteira) ---
    const today = new Date();
    const { month: currentMonth, year: currentYear } = getSelectedMonthYear();
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    
    // Ordenar transações por data (ascendente)
    const sortedTxs = [...txs].sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const daysInMonth = (currentMonth === today.getMonth() && currentYear === today.getFullYear()) 
        ? today.getDate() 
        : new Date(currentYear, currentMonth + 1, 0).getDate();

    const labels = [];
    for (let day = 1; day <= daysInMonth; day++) {
        labels.push(`${day}/${currentMonth + 1}`);
    }

    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#f97316'];
    const datasets = allWallets.map((wallet, index) => {
        let runningBalance = 0;
        const dailyBalances = [];
        
        // Saldo inicial da carteira antes do mês atual
        const preMonthTxs = sortedTxs.filter(tx => tx.wallet_id === wallet.id && new Date(tx.date) < firstDayOfMonth);
        runningBalance = preMonthTxs.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
        
        for (let day = 1; day <= daysInMonth; day++) {
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

    const totalInc = Object.values(incTotals).reduce((a, b) => a + b, 0);

    if (ctxInc) {
        window.chartIncome = new Chart(ctxInc, { 
            type: 'doughnut', 
            data: { 
                labels: Object.keys(incTotals), 
                datasets: [{ 
                    data: Object.values(incTotals), 
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
                                const percentage = totalInc > 0 ? ((value / totalInc) * 100).toFixed(1) : 0;
                                return ` ${context.label}: ${percentage}% (R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`;
                            }
                        }
                    }
                }
            }
        });
    }

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
                    // Apply name normalization rules
                    let autoDesc = email.entityName || (email.senderName ? `${email.senderName}: ${email.subject}` : email.subject);
                    autoDesc = applyNameRules(autoDesc);

                    let finalCategory = rule.category;
                    const pastTx = existingTxs.slice().reverse().find(tx => tx.description === autoDesc);
                    if (pastTx && pastTx.category) {
                        finalCategory = pastTx.category;
                    }

                    const tx = {
                        date: email.date,
                        description: autoDesc,
                        amount: rule.amount_type === 'income' ? Math.abs(email.amount) : -Math.abs(email.amount),
                        category: finalCategory,
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
            
            let finalDesc = applyNameRules(displayDesc);
            let suggestedCategory = 'Geral';
            const pastTxForTriage = existingTxs.slice().reverse().find(tx => tx.description === finalDesc);
            if (pastTxForTriage && pastTxForTriage.category) {
                suggestedCategory = pastTxForTriage.category;
            }

            const dateParts = email.date.split('-');
            const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : new Date(email.date).toLocaleDateString('pt-BR');

            row.innerHTML = `
                <td>${formattedDate}</td>
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
                        ${getCategoryOptionsHtml(suggestedCategory)}
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

                // Apply name normalization rules
                let desc = entity || (sender ? `${sender}: ${subj}` : subj);
                desc = applyNameRules(desc);

                const tx = {
                    date: btn.dataset.date,
                    description: desc,
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

btnConnectGmail.onclick = async () => {
    try {
        await connectGmail(true);
    } catch (e) {
        console.error('Falha ou cancelamento ao conectar Gmail:', e);
    }
};

btnSyncNow.onclick = async () => {
    if (!isGmailTokenValid()) {
        try {
            await connectGmail(false); // Silent reconnect
        } catch (e) {
            alert('A sessão com o Gmail expirou. Por favor, clique em "Conectar Gmail".');
            return;
        }
    }
    runTriage();
};

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
    const icon = document.getElementById('auth-status-icon');
    const text = document.getElementById('auth-status-text');
    if (icon) {
        icon.textContent = 'check_circle';
        icon.style.color = 'var(--success)';
    }
    if (text) {
        text.textContent = 'Conectado';
    }
});

document.addEventListener('gmail-disconnected', () => {
    const icon = document.getElementById('auth-status-icon');
    const text = document.getElementById('auth-status-text');
    if (icon) {
        icon.textContent = 'cancel';
        icon.style.color = 'var(--danger)';
    }
    if (text) {
        text.textContent = 'Desconectado';
    }
});

// Auth UI Logic
let isRegistering = false;
const authToggleLink = document.getElementById('auth-toggle-link');
const authToggleText = document.getElementById('auth-toggle-text');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const authTitle = document.getElementById('auth-title');
const authError = document.getElementById('auth-error');

if (authToggleLink) {
    authToggleLink.onclick = (e) => {
        e.preventDefault();
        isRegistering = !isRegistering;
        authError.style.display = 'none';
        if (isRegistering) {
            authTitle.innerText = 'Criar Conta';
            btnAuthSubmit.innerText = 'Cadastrar';
            authToggleText.innerText = 'Já tem uma conta?';
            authToggleLink.innerText = 'Entrar';
        } else {
            authTitle.innerText = 'Acessar Conta';
            btnAuthSubmit.innerText = 'Entrar';
            authToggleText.innerText = 'Não tem uma conta?';
            authToggleLink.innerText = 'Cadastre-se';
        }
    };
}

const formAuth = document.getElementById('form-auth');
if (formAuth) {
    formAuth.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        authError.style.display = 'none';
        btnAuthSubmit.disabled = true;
        btnAuthSubmit.innerText = 'Aguarde...';

        let res;
        if (isRegistering) {
            const name = email.split('@')[0];
            res = await signUp(email, password, name);
        } else {
            res = await signIn(email, password);
        }

        btnAuthSubmit.disabled = false;
        btnAuthSubmit.innerText = isRegistering ? 'Cadastrar' : 'Entrar';

        if (res.error) {
            authError.innerText = res.error.message || 'Erro ao autenticar.';
            authError.style.display = 'block';
        } else {
            checkAuthAndLoad();
        }
    };
}

const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
    btnLogout.onclick = async () => {
        await signOut();
        document.getElementById('auth-view').style.display = 'flex';
        document.querySelector('.app-container').style.display = 'none';
    };
}

async function checkAuthAndLoad() {
    const { data } = await getSession();
    if (data && data.session) {
        document.getElementById('auth-view').style.display = 'none';
        document.querySelector('.app-container').style.display = 'flex';
        
        // Atualiza o nome no painel
        const userName = data.session.user.user_metadata?.full_name || data.session.user.email.split('@')[0];
        const nameEl = document.getElementById('user-display-name');
        if (nameEl) nameEl.innerText = userName;

        initGoogleAuth();
        loadSettings();
        renderCategoryManager();
        populateModalCategories();
        await loadWallets();
        loadTransactions();
    } else {
        document.getElementById('auth-view').style.display = 'flex';
        document.querySelector('.app-container').style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const filter = document.getElementById('global-month-filter');
    if (filter) {
        const d = new Date();
        filter.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        filter.addEventListener('change', () => {
            loadTransactions();
            loadFullTransactions();
            if (document.getElementById('view-recurring')?.style.display === 'block') {
                loadRecurringExpenses();
            }
        });
    }

    checkAuthAndLoad();
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
document.getElementById('btn-new-transaction').onclick = () => {
    populateModalCategories();
    document.getElementById('modal-transaction').style.display='flex';
};
document.getElementById('btn-cancel').onclick = () => document.getElementById('modal-transaction').style.display='none';

// Auto-categorize based on description input
document.getElementById('desc').addEventListener('blur', async (e) => {
    const desc = e.target.value.trim();
    if (!desc) return;
    
    const txs = await getTransactions();
    const pastTx = txs.slice().reverse().find(t => t.description.toLowerCase() === desc.toLowerCase());
    
    if (pastTx && pastTx.category) {
        const catSelect = document.getElementById('category');
        if (catSelect) catSelect.value = pastTx.category;
    }
});

document.getElementById('form-transaction').onsubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(document.getElementById('amount').value);
    const cat = document.getElementById('category').value;
    const type = document.getElementById('type-select').value;
    const d = new Date();
    const localDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const tx = { 
        date: localDateStr, 
        description: document.getElementById('desc').value, 
        amount: type === 'income' ? Math.abs(amt) : -Math.abs(amt), 
        category: cat, 
        wallet_id: document.getElementById('wallet-select').value, 
        source: 'manual' 
    };
    if (await addTransaction(tx)) { document.getElementById('modal-transaction').style.display='none'; loadTransactions(); }
};

// =============================================
// Dynamic Category Dropdown Population
// =============================================
function populateModalCategories() {
    const select = document.getElementById('category');
    if (select) {
        const current = select.value;
        select.innerHTML = getCategoryOptionsHtml(current || 'Geral');
    }
}

// =============================================
// Category Manager UI (Settings section)
// =============================================
function renderCategoryManager() {
    const container = document.getElementById('category-manager');
    if (!container) return;

    const allCats = getAllCategories();
    const customCats = getCustomCategories();

    container.innerHTML = `
        <div style="display:flex;gap:0.75rem;margin-bottom:1.5rem;">
            <input type="text" id="new-category-input" placeholder="Nome da nova categoria"
                style="flex:1;padding:0.75rem;border-radius:0.5rem;border:1px solid var(--glass-border);background:var(--surface);color:white;" />
            <button type="button" class="btn btn-primary" id="btn-add-category" style="padding:0.5rem 1rem;white-space:nowrap;">
                <span class="material-symbols-rounded">add</span> Adicionar
            </button>
        </div>
        <div class="category-chips" style="display:flex;flex-wrap:wrap;gap:0.5rem;">
            ${allCats.map(cat => {
                const isCustom = customCats.includes(cat);
                return `<span class="category-chip ${isCustom ? 'custom' : 'default'}" style="
                    display:inline-flex;align-items:center;gap:0.4rem;
                    padding:0.4rem 0.75rem;border-radius:2rem;
                    background:${isCustom ? 'var(--primary)' : 'var(--surface-light)'};
                    color:white;font-size:0.8rem;font-weight:500;
                    transition:all 0.2s ease;
                ">
                    ${cat}
                    ${isCustom ? `<button class="btn-remove-cat" data-cat="${cat}" style="
                        background:none;border:none;color:rgba(255,255,255,0.7);cursor:pointer;
                        display:flex;align-items:center;padding:0;margin:0;
                        font-size:0.85rem;line-height:1;
                    " title="Remover categoria">&times;</button>` : ''}
                </span>`;
            }).join('')}
        </div>
    `;

    // Add category event
    document.getElementById('btn-add-category').onclick = () => {
        const input = document.getElementById('new-category-input');
        const name = input.value.trim();
        if (!name) return;
        if (addCustomCategory(name)) {
            renderCategoryManager();
            populateModalCategories();
            input.value = '';
        } else {
            alert('Categoria já existe ou nome inválido.');
        }
    };

    // Enter key support
    document.getElementById('new-category-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btn-add-category').click();
        }
    });

    // Remove category events
    document.querySelectorAll('.btn-remove-cat').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const cat = btn.dataset.cat;
            if (confirm(`Remover a categoria "${cat}"?\n\nTransações existentes com essa categoria não serão afetadas.`)) {
                removeCustomCategory(cat);
                renderCategoryManager();
                populateModalCategories();
            }
        };
    });
}

// =============================================
// Recurring Expenses Logic
// =============================================
async function loadRecurringExpenses() {
    const list = document.getElementById('recurring-expenses-list');
    if (!list) return;

    list.innerHTML = '<tr><td colspan="6" style="text-align:center;">Carregando...</td></tr>';

    const expenses = await getRecurringExpenses();
    const txs = await getTransactions();
    
    // Obter transações do mês atual (saídas)
    const today = new Date();
    const { month: currentMonth, year: currentYear } = getSelectedMonthYear();
    
    const currentMonthExpenses = txs.filter(tx => {
        const txDate = new Date(tx.date + 'T12:00:00');
        const amt = parseFloat(tx.amount);
        return txDate.getMonth() === currentMonth && 
               txDate.getFullYear() === currentYear && 
               amt <= 0;
    });

    list.innerHTML = '';
    
    if (expenses.length === 0) {
        list.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem;">Nenhum gasto recorrente cadastrado.</td></tr>';
        return;
    }

    expenses.forEach(exp => {
        const row = document.createElement('tr');
        
        // Verificar se foi pago no mês atual
        const matchedDescriptions = exp.matched_descriptions || [];
        const isPaid = currentMonthExpenses.some(tx => matchedDescriptions.includes(tx.description));
        
        // Verificar atraso
        const isPastMonth = (currentYear < today.getFullYear()) || (currentYear === today.getFullYear() && currentMonth < today.getMonth());
        const isCurrentMonth = currentYear === today.getFullYear() && currentMonth === today.getMonth();
        const isLate = !isPaid && (isPastMonth || (isCurrentMonth && today.getDate() > exp.due_day));
        
        let statusHtml = '';
        if (isPaid) {
            statusHtml = `<span style="color:var(--success); display:flex; align-items:center; gap:0.25rem;"><span class="material-symbols-rounded" style="font-size:1rem;">check_circle</span> Pago</span>`;
        } else if (isLate) {
            statusHtml = `<button class="btn-link-tx" data-id="${exp.id}" data-desc="${exp.description}" style="background:var(--danger-light);color:var(--danger);border:1px solid var(--danger);padding:0.25rem 0.5rem;border-radius:0.25rem;cursor:pointer;font-size:0.75rem;display:flex;align-items:center;gap:0.25rem;"><span class="material-symbols-rounded" style="font-size:1rem;">warning</span> Atrasado (Vincular)</button>`;
        } else {
            statusHtml = `<button class="btn-link-tx" data-id="${exp.id}" data-desc="${exp.description}" style="background:none;color:var(--text-muted);border:1px dashed var(--glass-border);padding:0.25rem 0.5rem;border-radius:0.25rem;cursor:pointer;font-size:0.75rem;">Aguardando Pagamento...</button>`;
        }

        row.innerHTML = `
            <td>${statusHtml}</td>
            <td style="font-weight:500;">${exp.description}</td>
            <td>Dia ${exp.due_day}</td>
            <td class="amount expense">R$ ${parseFloat(exp.amount).toFixed(2)}</td>
            <td>${exp.category || 'Geral'}</td>
            <td>
                <button class="btn-edit-recurring" data-id="${exp.id}" style="background:none;border:none;color:var(--primary);cursor:pointer;margin-right:0.5rem;"><span class="material-symbols-rounded">edit</span></button>
                <button class="btn-del-recurring" data-id="${exp.id}" style="background:none;border:none;color:var(--danger);cursor:pointer;"><span class="material-symbols-rounded">delete</span></button>
            </td>
        `;
        list.appendChild(row);
    });

    // Event Listeners for actions
    document.querySelectorAll('.btn-del-recurring').forEach(btn => {
        btn.onclick = async () => {
            if (confirm('Excluir este gasto recorrente?')) {
                await deleteRecurringExpense(btn.dataset.id);
                loadRecurringExpenses();
            }
        };
    });

    document.querySelectorAll('.btn-edit-recurring').forEach(btn => {
        btn.onclick = async () => {
            const exp = expenses.find(e => e.id == btn.dataset.id);
            if (exp) {
                document.getElementById('modal-recurring-title').innerText = 'Editar Gasto Recorrente';
                document.getElementById('recurring-id').value = exp.id;
                document.getElementById('recurring-desc').value = exp.description;
                document.getElementById('recurring-amount').value = Math.abs(parseFloat(exp.amount));
                document.getElementById('recurring-due-day').value = exp.due_day;
                
                const catSelect = document.getElementById('recurring-category');
                catSelect.innerHTML = getCategoryOptionsHtml(exp.category);
                
                document.getElementById('modal-recurring').style.display = 'flex';
            }
        };
    });

    document.querySelectorAll('.btn-link-tx').forEach(btn => {
        btn.onclick = () => openLinkModal(btn.dataset.id, btn.dataset.desc, currentMonthExpenses);
    });
}

// Modal Novo Gasto Recorrente
const btnAddRecurring = document.getElementById('btn-add-recurring');
if (btnAddRecurring) {
    btnAddRecurring.onclick = () => {
        document.getElementById('modal-recurring-title').innerText = 'Novo Gasto Recorrente';
        document.getElementById('recurring-id').value = '';
        document.getElementById('form-recurring').reset();
        
        const catSelect = document.getElementById('recurring-category');
        catSelect.innerHTML = getCategoryOptionsHtml('Geral');
        
        document.getElementById('modal-recurring').style.display = 'flex';
    };
}

document.getElementById('btn-cancel-recurring').onclick = () => {
    document.getElementById('modal-recurring').style.display = 'none';
};

document.getElementById('form-recurring').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('recurring-id').value;
    const desc = document.getElementById('recurring-desc').value.trim();
    const amount = parseFloat(document.getElementById('recurring-amount').value);
    const dueDay = parseInt(document.getElementById('recurring-due-day').value);
    const category = document.getElementById('recurring-category').value;

    const payload = {
        description: desc,
        amount: amount,
        due_day: dueDay,
        category: category
    };

    if (id) {
        await updateRecurringExpense(id, payload);
    } else {
        await addRecurringExpense(payload);
    }

    document.getElementById('modal-recurring').style.display = 'none';
    loadRecurringExpenses();
};

// Modal Link Transaction
function openLinkModal(recurringId, recurringDesc, currentMonthExpenses) {
    document.getElementById('link-transaction-desc').innerText = recurringDesc;
    document.getElementById('link-recurring-id').value = recurringId;
    
    const list = document.getElementById('unlinked-transactions-list');
    list.innerHTML = '';
    
    if (currentMonthExpenses.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;">Não há transações de saída neste mês.</p>';
    } else {
        currentMonthExpenses.forEach(tx => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:0.75rem; background:var(--surface-light); border-radius:0.5rem; margin-bottom:0.5rem; cursor:pointer;';
            row.innerHTML = `
                <div>
                    <div style="font-weight:500;">${tx.description}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${new Date(tx.date).toLocaleDateString('pt-BR')}</div>
                </div>
                <div style="font-weight:bold; color:var(--danger);">R$ ${Math.abs(parseFloat(tx.amount)).toFixed(2)}</div>
            `;
            // Hover effect
            row.onmouseover = () => row.style.border = '1px solid var(--primary)';
            row.onmouseout = () => row.style.border = 'none';
            
            row.onclick = async () => {
                if (confirm(`Vincular o pagamento "${tx.description}" a este gasto recorrente?\n\nO sistema aprenderá para os próximos meses.`)) {
                    const exp = (await getRecurringExpenses()).find(e => e.id == recurringId);
                    if (exp) {
                        const matched = exp.matched_descriptions || [];
                        if (!matched.includes(tx.description)) {
                            matched.push(tx.description);
                            await updateRecurringExpense(recurringId, { matched_descriptions: matched });
                            document.getElementById('modal-link-transaction').style.display = 'none';
                            loadRecurringExpenses();
                        }
                    }
                }
            };
            
            list.appendChild(row);
        });
    }
    
    document.getElementById('modal-link-transaction').style.display = 'flex';
}

document.getElementById('btn-cancel-link').onclick = () => {
    document.getElementById('modal-link-transaction').style.display = 'none';
};

document.getElementById('btn-mark-unpaid').onclick = async () => {
    document.getElementById('modal-link-transaction').style.display = 'none';
};
