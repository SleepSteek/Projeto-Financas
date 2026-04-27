/**
 * Supabase Integration Module
 */

// Replace these with your actual Supabase project details
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/**
 * Fetch all transactions from Supabase
 */
export async function getTransactions() {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false });

    if (error) {
        console.error('Error fetching transactions:', error);
        return [];
    }
    return data;
}

/**
 * Add a new transaction
 */
export async function addTransaction(transaction) {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('transactions')
        .insert([transaction])
        .select();

    if (error) {
        console.error('Error adding transaction:', error);
        return null;
    }
    return data[0];
}

/**
 * Delete a transaction
 */
export async function deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) console.error('Error deleting:', error);
    return !error;
}

/**
 * Delete multiple transactions
 */
export async function deleteTransactions(ids) {
    const { error } = await supabase.from('transactions').delete().in('id', ids);
    if (error) console.error('Error deleting multiple:', error);
    return !error;
}

/**
 * Update a transaction
 */
export async function updateTransaction(id, updates) {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('transactions')
        .update(updates)
        .eq('id', id)
        .select();

    if (error) {
        console.error('Error updating transaction:', error);
        return null;
    }
    return data[0];
}

/**
 * Wallets Logic
 */
export async function getWallets() {
    const { data } = await supabase.from('wallets').select('*');
    return data || [];
}

export async function addWallet(name) {
    const { data } = await supabase.from('wallets').insert([{ name }]).select();
    return data ? data[0] : null;
}

export async function deleteWallet(id) {
    const { error } = await supabase.from('wallets').delete().eq('id', id);
    return !error;
}


/**
 * Sync Config Logic
 */
export async function getSyncConfig() {
    const { data } = await supabase.from('sync_configs').select('*').limit(1);
    return data ? data[0] : null;
}

/**
 * Sync Rules Logic (Learning)
 */
export async function getRules() {
    const { data } = await supabase.from('transaction_rules').select('*');
    return data || [];
}

export async function saveRule(rule) {
    const { data, error } = await supabase.from('transaction_rules').upsert(rule, { onConflict: 'subject' }).select();
    if (error) console.error('Erro ao salvar regra:', error);
    return data ? data[0] : null;
}
