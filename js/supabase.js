/**
 * Supabase Integration Module
 */

// Placeholders para o GitHub Actions
const CONFIG = {
    url: '__SUPABASE_URL__',
    key: '__SUPABASE_ANON_KEY__'
};

/**
 * Inicializa o cliente Supabase com segurança
 */
function initSupabase() {
    const isConfigured = CONFIG.url && 
                        CONFIG.url !== '__SUPABASE_URL__' && 
                        CONFIG.url !== '' &&
                        CONFIG.url.startsWith('http');

    if (!isConfigured) {
        console.warn('[FinTrack] Supabase não configurado. Verifique os Secrets no GitHub.');
        return null;
    }

    if (!window.supabase) {
        console.error('[FinTrack] Biblioteca Supabase-js não carregada.');
        return null;
    }

    return window.supabase.createClient(CONFIG.url, CONFIG.key);
}

export const supabase = initSupabase();

/**
 * Fetch all transactions from Supabase
 */
export async function getTransactions() {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .order('date', { ascending: false });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error fetching transactions:', error);
        return [];
    }
}

/**
 * Add a new transaction
 */
export async function addTransaction(transaction) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('transactions')
            .insert([transaction])
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('Error adding transaction:', error);
        return null;
    }
}

/**
 * Delete one or more transactions
 */
export async function deleteTransactions(ids) {
    if (!supabase) return false;
    try {
        const { error } = await supabase
            .from('transactions')
            .delete()
            .in('id', ids);
        return !error;
    } catch (error) {
        console.error('Error deleting transactions:', error);
        return false;
    }
}

/**
 * Update a transaction
 */
export async function updateTransaction(id, updates) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('transactions')
            .update(updates)
            .eq('id', id)
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('Error updating transaction:', error);
        return null;
    }
}

/**
 * Wallets Logic
 */
export async function getWallets() {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase.from('wallets').select('*');
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching wallets:', error);
        return [];
    }
}

export async function addWallet(name) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.from('wallets').insert([{ name }]).select();
        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('Error adding wallet:', error);
        return null;
    }
}

export async function deleteWallet(id) {
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('wallets').delete().eq('id', id);
        return !error;
    } catch (error) {
        console.error('Error deleting wallet:', error);
        return false;
    }
}

/**
 * Sync Rules Logic
 */
export async function getRules() {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase.from('transaction_rules').select('*');
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching rules:', error);
        return [];
    }
}

export async function saveRule(rule) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('transaction_rules')
            .upsert(rule, { onConflict: 'subject' })
            .select();
        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('Error saving rule:', error);
        return null;
    }
}
