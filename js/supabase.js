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
    // Verifica se a URL foi injetada (não é vazia e começa com http)
    const isConfigured = CONFIG.url && 
                        CONFIG.url.length > 10 &&
                        CONFIG.url.startsWith('http');

    if (!isConfigured) {
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
 * Authentication Logic
 */
export async function signUp(email, password, name) {
    if (!supabase) return { error: new Error('Supabase não inicializado') };
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name }
            }
        });
        return { data, error };
    } catch (e) {
        return { error: e };
    }
}

export async function signIn(email, password) {
    if (!supabase) return { error: new Error('Supabase não inicializado') };
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        return { data, error };
    } catch (e) {
        return { error: e };
    }
}

export async function signOut() {
    if (!supabase) return { error: new Error('Supabase não inicializado') };
    try {
        const { error } = await supabase.auth.signOut();
        return { error };
    } catch (e) {
        return { error: e };
    }
}

export async function getSession() {
    if (!supabase) return { data: { session: null } };
    return await supabase.auth.getSession();
}

/**
 * Helper to get current user ID
 */
async function getUserId() {
    const { data } = await getSession();
    return data?.session?.user?.id || null;
}

/**
 * Fetch all transactions from Supabase
 */
export async function getTransactions() {
    if (!supabase) return [];
    const userId = await getUserId();
    if (!userId) return [];
    
    try {
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('date', { ascending: false })
            .order('created_at', { ascending: false });

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
    const userId = await getUserId();
    if (!userId) return null;

    try {
        transaction.user_id = userId;
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
 * Delete a single transaction
 */
export async function deleteTransaction(id) {
    if (!supabase) return false;
    const userId = await getUserId();
    if (!userId) return false;

    try {
        const { error } = await supabase
            .from('transactions')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);
        return !error;
    } catch (error) {
        console.error('Error deleting transaction:', error);
        return false;
    }
}

/**
 * Delete one or more transactions
 */
export async function deleteTransactions(ids) {
    if (!supabase) return false;
    const userId = await getUserId();
    if (!userId) return false;

    try {
        const { error } = await supabase
            .from('transactions')
            .delete()
            .in('id', ids)
            .eq('user_id', userId);
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
    const userId = await getUserId();
    if (!userId) return null;

    try {
        const { data, error } = await supabase
            .from('transactions')
            .update(updates)
            .eq('id', id)
            .eq('user_id', userId)
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
    const userId = await getUserId();
    if (!userId) return [];

    try {
        const { data, error } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', userId);
            
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching wallets:', error);
        return [];
    }
}

export async function addWallet(name) {
    if (!supabase) return null;
    const userId = await getUserId();
    if (!userId) return null;

    try {
        const { data, error } = await supabase
            .from('wallets')
            .insert([{ name, user_id: userId }])
            .select();
            
        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('Error adding wallet:', error);
        return null;
    }
}

export async function deleteWallet(id) {
    if (!supabase) return false;
    const userId = await getUserId();
    if (!userId) return false;

    try {
        const { error } = await supabase
            .from('wallets')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);
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
    const userId = await getUserId();
    if (!userId) return [];

    try {
        const { data, error } = await supabase
            .from('transaction_rules')
            .select('*')
            .eq('user_id', userId);
            
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching rules:', error);
        return [];
    }
}

export async function saveRule(rule) {
    if (!supabase) return null;
    const userId = await getUserId();
    if (!userId) return null;

    try {
        rule.user_id = userId;
        // Se a tabela tem user_id, o upsert deve considerar o conflito de subject E user_id
        // Para isso o Supabase precisaria de um índice único (subject, user_id).
        // Caso o usuário não tenha criado, o comportamento pode falhar. Assumiremos que ele fará isso.
        const { data, error } = await supabase
            .from('transaction_rules')
            .upsert(rule, { onConflict: 'subject,user_id' })
            .select();
            
        if (error) {
            // Fallback caso o índice composto não exista e a onConflict falhe
            // Vamos tentar buscar a regra primeiro e dar update/insert
            console.warn("Falha no upsert com índice composto, tentando abordagem manual...", error);
            const { data: existing } = await supabase
                .from('transaction_rules')
                .select('id')
                .eq('subject', rule.subject)
                .eq('user_id', userId)
                .single();
                
            if (existing) {
                const { data: updated, error: updError } = await supabase
                    .from('transaction_rules')
                    .update(rule)
                    .eq('id', existing.id)
                    .select();
                if (updError) throw updError;
                return updated ? updated[0] : null;
            } else {
                const { data: inserted, error: insError } = await supabase
                    .from('transaction_rules')
                    .insert([rule])
                    .select();
                if (insError) throw insError;
                return inserted ? inserted[0] : null;
            }
        }
        return data ? data[0] : null;
    } catch (error) {
        console.error('Error saving rule:', error);
        return null;
    }
}

/**
 * Bulk update transactions matching a specific description
 */
export async function updateTransactionsByDescription(oldDescription, updates) {
    if (!supabase) return false;
    const userId = await getUserId();
    if (!userId) return false;

    try {
        const { error } = await supabase
            .from('transactions')
            .update(updates)
            .eq('description', oldDescription)
            .eq('user_id', userId);
        return !error;
    } catch (error) {
        console.error('Error bulk updating transactions:', error);
        return false;
    }
}

/**
 * Recurring Expenses Logic
 */
export async function getRecurringExpenses() {
    if (!supabase) return [];
    const userId = await getUserId();
    if (!userId) return [];

    try {
        const { data, error } = await supabase
            .from('recurring_expenses')
            .select('*')
            .eq('user_id', userId)
            .order('due_day', { ascending: true });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching recurring expenses:', error);
        return [];
    }
}

export async function addRecurringExpense(expense) {
    if (!supabase) return null;
    const userId = await getUserId();
    if (!userId) return null;

    try {
        expense.user_id = userId;
        const { data, error } = await supabase
            .from('recurring_expenses')
            .insert([expense])
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('Error adding recurring expense:', error);
        return null;
    }
}

export async function updateRecurringExpense(id, updates) {
    if (!supabase) return null;
    const userId = await getUserId();
    if (!userId) return null;

    try {
        const { data, error } = await supabase
            .from('recurring_expenses')
            .update(updates)
            .eq('id', id)
            .eq('user_id', userId)
            .select();

        if (error) throw error;
        return data ? data[0] : null;
    } catch (error) {
        console.error('Error updating recurring expense:', error);
        return null;
    }
}

export async function deleteRecurringExpense(id) {
    if (!supabase) return false;
    const userId = await getUserId();
    if (!userId) return false;

    try {
        const { error } = await supabase
            .from('recurring_expenses')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);
        return !error;
    } catch (error) {
        console.error('Error deleting recurring expense:', error);
        return false;
    }
}
