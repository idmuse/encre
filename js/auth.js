// ── Authentification ──────────────────────────────────────
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
export let sbUser = null;
export let pseudoProfil = '';

export async function initAuth(onConnecte, onDeconnecte) {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    sbUser = session.user;
    await _chargerPseudo();
    onConnecte();
  } else {
    onDeconnecte();
  }
  sb.auth.onAuthStateChange((_event, session) => {
    sbUser = session?.user || null;
    if (sbUser) { _chargerPseudo().then(onConnecte); }
    else onDeconnecte();
  });
}

async function _chargerPseudo() {
  const { data } = await sb.from('profils').select('pseudo').eq('user_id', sbUser.id).maybeSingle();
  pseudoProfil = data?.pseudo || sbUser?.email?.split('@')[0] || '';
}

export async function seConnecter(email, pwd) {
  const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
  if (error) throw error;
  const { data: { user } } = await sb.auth.getUser();
  sbUser = user;
}

export async function seDeconnecter() {
  await sb.auth.signOut();
  sbUser = null;
  pseudoProfil = '';
}

export function setSaveStatus(s) {
  const el = document.getElementById('save-status');
  if (!el) return;
  const map = { ok: '#4a8050', err: 'var(--accent)', pending: '#8b6914' };
  el.style.color = map[s] || '#6b5a4e';
}
